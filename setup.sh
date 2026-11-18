#!/usr/bin/env bash
# PhoneDesk installer for macOS: downloads the latest release, checks it, installs it and starts it.
#
#   curl -fsSL https://raw.githubusercontent.com/howznguyen/phonedesk/main/setup.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/howznguyen/phonedesk/main/setup.sh | bash -s -- --no-autostart
#
# Run it as yourself, not with sudo: nothing here needs administrator rights.
# Running it again updates PhoneDesk; your layout, paired phones and settings in ~/.phonedesk are kept.
#
# Options:
#   --yes               answer every question with its default (unattended)
#   --version <x.y.z>   install this release instead of the latest
#   --port <n>          the port the agent listens on (default 7420)
#   --no-autostart      do not start PhoneDesk at login (no launchd service)
#   --no-start          install only; do not start the agent
#   --no-open           do not open the management page in the browser
#   --dry-run           download and verify, show what would happen, change nothing
#   -h, --help          this text
#
# Test knobs (not for normal use):
#   PHONEDESK_RELEASE_BASE   a directory or URL that holds phonedesk-darwin-<arch> and SHA256SUMS
#   PHONEDESK_INSTALL_HOME   install under this directory instead of $HOME
set -euo pipefail

repo="howznguyen/phonedesk"
yes=0; version=""; port=7420; autostart=1; start=1; open_page=1; dry=0
tmp=""

if [ -t 1 ]; then c_step=$'\033[36m'; c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_off=$'\033[0m'
else c_step=""; c_ok=""; c_warn=""; c_err=""; c_off=""; fi
step() { printf '\n%s==> %s%s\n' "$c_step" "$1" "$c_off"; }
info() { printf '    %s\n' "$1"; }
ok() { printf '    %sOK  %s%s\n' "$c_ok" "$1" "$c_off"; }
caution() { printf '    %s!   %s%s\n' "$c_warn" "$1" "$c_off"; }
die() {
  printf '\n%sSetup stopped: %s%s\n' "$c_err" "$1" "$c_off" >&2
  printf '%sHelp: https://github.com/%s#quick-start  -  issues: https://github.com/%s/issues%s\n' "$c_err" "$repo" "$repo" "$c_off" >&2
  exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }
cleanup() { if [ -n "$tmp" ] && [ -d "$tmp" ]; then rm -rf "$tmp"; fi; }
trap cleanup EXIT

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) yes=1 ;;
    --dry-run) dry=1 ;;
    --no-autostart) autostart=0 ;;
    --no-start) start=0 ;;
    --no-open) open_page=0 ;;
    --version) shift; [ $# -gt 0 ] || die "--version needs a value"; version="${1#v}" ;;
    --version=*) version="${1#--version=}"; version="${version#v}" ;;
    --port) shift; [ $# -gt 0 ] || die "--port needs a value"; port="$1" ;;
    --port=*) port="${1#--port=}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

case "$port" in ''|*[!0-9]*) die "--port must be a number" ;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then die "--port must be between 1 and 65535"; fi
if [ "$(id -u)" = 0 ] && [ -z "${PHONEDESK_INSTALL_HOME:-}" ]; then die "do not run this with sudo; run it as your own user"; fi

# Questions go to the terminal even when the script itself arrives through a pipe (curl ... | bash).
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

sha256_of() {
  if have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  elif have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  else die "neither shasum nor sha256sum is available to check the download"; fi
}

check_sum() { # check_sum file sums-file
  local name expected actual
  name="$(basename "$1")"
  expected="$(awk -v n="$name" '{ f = $2; sub(/^\*/, "", f); if (f == n) { print tolower($1); exit } }' "$2")"
  [ -n "$expected" ] || die "$name is not listed in SHA256SUMS; refusing to install it"
  actual="$(sha256_of "$1" | tr 'A-F' 'a-f')"
  [ "$actual" = "$expected" ] || die "$name does not match its SHA256SUMS entry (expected $expected, got $actual). Nothing was installed."
  ok "$name matches SHA256SUMS ($actual)"
}

# fetch <url-or-path> <file>: https downloads only, except an explicit test base
base_is_custom=0
fetch() {
  local src="$1" dest="$2"
  case "$src" in
    http://*|https://*)
      have curl || die "curl is required"
      if [ "$base_is_custom" = 1 ]; then curl -fsSL --retry 2 --proto '=http,https' -A phonedesk-setup -o "$dest" "$src" || return 1
      else curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' -A phonedesk-setup -o "$dest" "$src" || return 1; fi ;;
    *) [ -f "$src" ] || return 1; cp "$src" "$dest" ;;
  esac
}

# ---------- where things go ----------
home_dir="${PHONEDESK_INSTALL_HOME:-$HOME}"
data_dir="$home_dir/.phonedesk"
bin_dir="$data_dir/bin"
bin="$bin_dir/phonedesk"
log_dir="$data_dir/logs"
pidfile="$data_dir/agent.pid"
# with a relocated install (tests), keep every file the binary touches inside it
child_env=(PHONEDESK_HOME="$data_dir")
if [ -n "${PHONEDESK_INSTALL_HOME:-}" ]; then
  child_env+=(PHONEDESK_LAUNCH_AGENTS_DIR="${PHONEDESK_LAUNCH_AGENTS_DIR:-$home_dir/Library/LaunchAgents}" PHONEDESK_CLAUDE_DIR="${PHONEDESK_CLAUDE_DIR:-$home_dir/.claude}" PHONEDESK_CODEX_DIR="${PHONEDESK_CODEX_DIR:-$home_dir/.codex}")
fi
run_bin() { env "${child_env[@]}" "$@"; }

# ---------- 1. this computer ----------
step "Checking this computer"
[ "$(uname -s)" = "Darwin" ] || die "PhoneDesk's installer supports macOS only for now (this is $(uname -s))."
arch="$(uname -m)"
case "$arch" in
  arm64) asset_arch=arm64 ;;
  x86_64)
    asset_arch=x64
    # a shell running under Rosetta on an Apple silicon Mac still wants the native build
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then asset_arch=arm64; fi ;;
  *) die "unsupported processor: $arch" ;;
esac
asset="phonedesk-darwin-$asset_arch"
ok "macOS on $arch, using $asset"

# ---------- 2. which release ----------
step "Finding the release"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/phonedesk-setup.XXXXXX")"
if [ -n "${PHONEDESK_RELEASE_BASE:-}" ]; then
  base="${PHONEDESK_RELEASE_BASE%/}"; base_is_custom=1
  info "using PHONEDESK_RELEASE_BASE=$base"
else
  if [ -z "$version" ]; then
    have curl || die "curl is required"
    tag="$(curl -fsSLI --proto '=https' --proto-redir '=https' -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest" 2>/dev/null | sed -n 's#.*/tag/##p')" || tag=""
    [ -n "$tag" ] || die "could not find the latest release of $repo (is there a release yet, and are you online?)"
  else
    tag="v$version"
  fi
  base="https://github.com/$repo/releases/download/$tag"
  info "release $tag"
fi

# ---------- 3. download and check ----------
step "Downloading $asset"
fetch "$base/$asset" "$tmp/$asset" || die "could not download $base/$asset"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "could not download $base/SHA256SUMS"
check_sum "$tmp/$asset" "$tmp/SHA256SUMS"
chmod 755 "$tmp/$asset"
if have xattr; then xattr -d com.apple.quarantine "$tmp/$asset" 2>/dev/null || true; fi
# release binaries are ad-hoc signed in CI; sign again here so the signature is valid for this exact file on this Mac
if have codesign; then
  codesign --force -s - "$tmp/$asset" >/dev/null 2>&1 && ok "ad-hoc signed" || caution "could not sign the binary (codesign failed); it may not start"
fi
new_version="$("$tmp/$asset" --version 2>/dev/null | head -n1)" || new_version=""
[ -n "$new_version" ] || die "the downloaded binary does not run on this Mac (it printed no version)"
ok "$new_version"

old_version=""
if [ -x "$bin" ]; then old_version="$(run_bin "$bin" --version 2>/dev/null | head -n1 || true)"; fi

# ---------- 4. install ----------
step "Installing"
info "program:  $bin"
info "your data stays in $data_dir"
[ -z "$old_version" ] || info "replacing $old_version"
if [ "$dry" = 1 ]; then
  caution "dry run: nothing was installed, started or changed"
  [ "$autostart" = 1 ] && info "would install the launchd service dev.phonedesk.agent (start at login)"
  info "would start PhoneDesk on port $port and open http://localhost:$port/manage/"
  exit 0
fi
ask "Install PhoneDesk to $bin?" y || die "cancelled; nothing was installed"
if [ "$autostart" = 1 ]; then
  ask "Start PhoneDesk automatically when you log in?" y || autostart=0
fi

# stop what is running so the file can be replaced: the service first, then a manually started agent
if [ -x "$bin" ]; then run_bin "$bin" service uninstall >/dev/null 2>&1 || true; fi
if [ -f "$pidfile" ]; then
  old_pid="$(cat "$pidfile" 2>/dev/null || true)"
  case "$old_pid" in ''|*[!0-9]*) ;; *) kill "$old_pid" 2>/dev/null || true; sleep 1 ;; esac
  rm -f "$pidfile"
fi

mkdir -p "$bin_dir" "$log_dir"
chmod 700 "$data_dir" 2>/dev/null || true
cp "$tmp/$asset" "$bin_dir/.phonedesk.new"
chmod 755 "$bin_dir/.phonedesk.new"
mv -f "$bin_dir/.phonedesk.new" "$bin"  # atomic replace on the same volume
ok "installed $new_version"

# ---------- 5. start ----------
if [ "$autostart" = 1 ] && [ "$start" = 1 ]; then
  step "Setting up the background service"
  if run_bin "$bin" service install --port "$port"; then
    ok "PhoneDesk will start at login and restart if it crashes (logs: $log_dir)"
  else
    caution "could not install the service; starting PhoneDesk without it"
    autostart=0
  fi
elif [ "$autostart" = 1 ]; then
  run_bin "$bin" service install --port "$port" >/dev/null 2>&1 || caution "could not install the service"
fi
# make sure installed Claude/Codex hooks (if any) point at this binary
run_bin "$bin" hooks repoint --port "$port" >/dev/null 2>&1 || true

if [ "$start" = 1 ] && [ "$autostart" = 0 ]; then
  step "Starting PhoneDesk"
  # exec keeps one process, so the pid written below is the agent's own and a later update can stop it
  ( cd "$data_dir" && exec env "${child_env[@]}" nohup "$bin" --port "$port" >>"$log_dir/agent.out.log" 2>>"$log_dir/agent.err.log" </dev/null ) &
  echo $! >"$pidfile"
fi

if [ "$start" = 1 ]; then
  step "Waiting for PhoneDesk"
  info_json=""
  for _ in $(seq 1 40); do
    if info_json="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/pairing" 2>/dev/null)"; then break; fi
    info_json=""; sleep 0.5
  done
  [ -n "$info_json" ] || die "PhoneDesk did not answer on port $port. Look at $log_dir/agent.err.log"
  pin="$(printf '%s' "$info_json" | sed -n 's/.*"pin"[[:space:]]*:[[:space:]]*"\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p')"
  url="$(printf '%s' "$info_json" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  url_local="$(printf '%s' "$info_json" | sed -n 's/.*"urlLocal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  ok "running on port $port"
  printf '\n  Phone URL:  %s\n  Pairing PIN: %s\n  Manage:     http://localhost:%s/manage/\n\n' "${url:-http://<this-computer>:$port}" "${pin:-see the terminal / logs}" "$port"
  if [ -t 1 ] && [ -n "$pin" ] && [ -n "$url" ]; then "$bin" qr "${url_local:-$url}" 2>/dev/null || true; fi
  info "Open the phone URL on a phone on the same Wi-Fi and enter the PIN."
  if [ "$open_page" = 1 ] && have open && [ -z "${PHONEDESK_INSTALL_HOME:-}" ]; then
    if ask "Open the management page now?" y; then open "http://localhost:$port/manage/" >/dev/null 2>&1 || true; fi
  fi
else
  info "Installed. Start it with: $bin"
fi
step "Done"
info "Update: run the same install command again.  Remove: uninstall.sh (see the README)."
