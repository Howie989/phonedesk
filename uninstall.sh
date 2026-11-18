#!/usr/bin/env bash
# PhoneDesk uninstaller for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/howznguyen/phonedesk/main/uninstall.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/howznguyen/phonedesk/main/uninstall.sh | bash -s -- --purge
#
# Stops and removes the background service, removes PhoneDesk's hooks from Claude Code and Codex (only the entries
# PhoneDesk added; a backup <file>.phonedesk.bak is written first) and deletes the program (~/.phonedesk/bin).
# Your data in ~/.phonedesk (layout, paired phones, settings) is kept unless you pass --purge.
#
# Options:
#   --purge     also delete ~/.phonedesk (layout, paired phones, uploaded icons and sounds, settings)
#   --yes       do not ask
#   --dry-run   show what would be removed, change nothing
#   -h, --help  this text
#
# Test knob: PHONEDESK_INSTALL_HOME removes from this directory instead of $HOME.
set -euo pipefail

purge=0; yes=0; dry=0

if [ -t 1 ]; then c_step=$'\033[36m'; c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_off=$'\033[0m'
else c_step=""; c_ok=""; c_warn=""; c_err=""; c_off=""; fi
step() { printf '\n%s==> %s%s\n' "$c_step" "$1" "$c_off"; }
info() { printf '    %s\n' "$1"; }
ok() { printf '    %sOK  %s%s\n' "$c_ok" "$1" "$c_off"; }
caution() { printf '    %s!   %s%s\n' "$c_warn" "$1" "$c_off"; }
die() { printf '\n%sUninstall stopped: %s%s\n' "$c_err" "$1" "$c_off" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --purge) purge=1 ;;
    --yes|-y) yes=1 ;;
    --dry-run) dry=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

tty_ok=0
if (: </dev/tty) 2>/dev/null; then tty_ok=1; fi
ask() { # ask "question" y|n -> 0 for yes
  local question="$1" default="$2" hint answer
  if [ "$default" = y ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  if [ "$yes" = 1 ] || [ "$tty_ok" = 0 ]; then
    if [ "$default" = y ]; then info "$question $hint -> yes (default)"; return 0; fi
    info "$question $hint -> no (default)"; return 1
  fi
  while :; do
    printf '    %s %s ' "$question" "$hint" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
    case "$answer" in
      "") if [ "$default" = y ]; then return 0; else return 1; fi ;;
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo]) return 1 ;;
    esac
  done
}

home_dir="${PHONEDESK_INSTALL_HOME:-$HOME}"
data_dir="$home_dir/.phonedesk"
bin_dir="$data_dir/bin"
bin="$bin_dir/phonedesk"
child_env=(PHONEDESK_HOME="$data_dir")
agents_dir="${PHONEDESK_LAUNCH_AGENTS_DIR:-$home_dir/Library/LaunchAgents}"
if [ -n "${PHONEDESK_INSTALL_HOME:-}" ]; then
  child_env+=(PHONEDESK_LAUNCH_AGENTS_DIR="$agents_dir" PHONEDESK_CLAUDE_DIR="${PHONEDESK_CLAUDE_DIR:-$home_dir/.claude}" PHONEDESK_CODEX_DIR="${PHONEDESK_CODEX_DIR:-$home_dir/.codex}")
fi
plist="$agents_dir/dev.phonedesk.agent.plist"

# never delete anything outside a directory that is clearly PhoneDesk's
case "$data_dir" in */.phonedesk) ;; *) die "refusing to work on $data_dir" ;; esac

step "PhoneDesk will remove"
info "the background service (dev.phonedesk.agent)"
info "PhoneDesk's hooks in Claude Code and Codex (backups: <file>.phonedesk.bak)"
info "the program: $bin_dir"
if [ "$purge" = 1 ]; then info "ALL your data: $data_dir (layout, paired phones, icons, sounds, settings)"; else info "(your data in $data_dir stays; use --purge to delete it too)"; fi
if [ "$dry" = 1 ]; then caution "dry run: nothing was changed"; exit 0; fi
ask "Continue?" y || die "cancelled; nothing was removed"
if [ "$purge" = 1 ] && [ "$yes" = 0 ]; then ask "Really delete $data_dir? This cannot be undone." n || die "cancelled; nothing was removed"; fi

step "Stopping the service"
if [ -x "$bin" ]; then
  env "${child_env[@]}" "$bin" service uninstall || caution "the service command failed"
elif [ -f "$plist" ]; then
  # the program is already gone: boot it out by hand
  ${PHONEDESK_LAUNCHCTL:-launchctl} bootout "gui/$(id -u)/dev.phonedesk.agent" >/dev/null 2>&1 || true
  rm -f "$plist"; ok "removed $plist"
else
  info "no service installed"
fi
pidfile="$data_dir/agent.pid"
if [ -f "$pidfile" ]; then
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) ;; *) kill "$pid" 2>/dev/null && ok "stopped the agent (pid $pid)" || true ;; esac
  rm -f "$pidfile"
fi

step "Removing the hooks"
if [ -x "$bin" ]; then
  env "${child_env[@]}" "$bin" hooks remove || caution "could not remove the hooks; remove entries ending in '# phonedesk hook' from ~/.claude/settings.json and ~/.codex/hooks.json by hand"
else
  caution "the program is missing, so the hooks cannot be removed automatically: delete entries ending in '# phonedesk hook' from ~/.claude/settings.json and ~/.codex/hooks.json"
fi

step "Removing the program"
if [ -d "$bin_dir" ]; then rm -rf "$bin_dir"; ok "removed $bin_dir"; else info "$bin_dir not found"; fi
if [ "$purge" = 1 ]; then
  rm -rf "$data_dir"; ok "removed $data_dir"
  # the Home Assistant token may live in the Keychain
  if have security && [ -z "${PHONEDESK_INSTALL_HOME:-}" ]; then security delete-generic-password -s PhoneDesk-HASS >/dev/null 2>&1 && ok "removed the Home Assistant token from the Keychain" || true; fi
fi
step "Done"
info "PhoneDesk is removed."
