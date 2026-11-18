# PhoneDesk uninstaller for Windows (experimental).
#
#   irm https://raw.githubusercontent.com/howznguyen/phonedesk/main/uninstall.ps1 | iex
#
# Stops and removes the scheduled task, removes PhoneDesk's hooks from Claude Code and Codex (only the entries
# PhoneDesk added; a backup <file>.phonedesk.bak is written first), removes the Windows Firewall rule PhoneDesk added
# (one UAC prompt, only if the rule exists) and deletes the program. Your data in %USERPROFILE%\.phonedesk (layout,
# paired phones, settings) is kept unless you set $env:PHONEDESK_PURGE=1.
#
# Options (environment variables): PHONEDESK_PURGE=1 (also delete the data folder), PHONEDESK_YES=1 (do not ask),
# PHONEDESK_DRY_RUN=1 (show what would be removed). Test knob: PHONEDESK_INSTALL_HOME (same as setup.ps1).

function Uninstall-PhoneDesk {
  [CmdletBinding()]
  param([switch]$Purge, [switch]$Yes, [switch]$DryRun)
  $ErrorActionPreference = 'Stop'
  function Step($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
  function Info($m) { Write-Host "    $m" }
  function Ok($m) { Write-Host "    OK  $m" -ForegroundColor Green }
  function Caution($m) { Write-Host "    !   $m" -ForegroundColor Yellow }
  function Ask([string]$question, [bool]$default) {
    $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
    if ($Yes -or -not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { Info "$question $hint -> $(if ($default) { 'yes' } else { 'no' }) (default)"; return $default }
    while ($true) {
      $a = (Read-Host "    $question $hint").Trim()
      if ($a -eq '') { return $default }
      if ($a -match '^(y|yes)$') { return $true }
      if ($a -match '^(n|no)$') { return $false }
    }
  }

  $relocated = [bool]$env:PHONEDESK_INSTALL_HOME
  if ($relocated) {
    $binDir = Join-Path $env:PHONEDESK_INSTALL_HOME 'bin'
    $dataDir = Join-Path $env:PHONEDESK_INSTALL_HOME '.phonedesk'
  } else {
    $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
    $binDir = Join-Path $local 'PhoneDesk\bin'
    $dataDir = if ($env:PHONEDESK_HOME) { $env:PHONEDESK_HOME } else { Join-Path $env:USERPROFILE '.phonedesk' }
  }
  $exe = Join-Path $binDir 'phonedesk.exe'
  $childEnv = @{ PHONEDESK_HOME = $dataDir }
  if ($relocated) {
    $childEnv['PHONEDESK_WIN_DIR'] = Join-Path $env:PHONEDESK_INSTALL_HOME 'service'
    $childEnv['PHONEDESK_CLAUDE_DIR'] = if ($env:PHONEDESK_CLAUDE_DIR) { $env:PHONEDESK_CLAUDE_DIR } else { Join-Path $env:PHONEDESK_INSTALL_HOME '.claude' }
    $childEnv['PHONEDESK_CODEX_DIR'] = if ($env:PHONEDESK_CODEX_DIR) { $env:PHONEDESK_CODEX_DIR } else { Join-Path $env:PHONEDESK_INSTALL_HOME '.codex' }
  }
  function Run-Bin([string[]]$arguments) {
    $saved = @{}
    foreach ($k in $childEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $childEnv[$k], 'Process') }
    $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $null = & $exe @arguments 2>&1; return $LASTEXITCODE } finally { $ErrorActionPreference = $ea; foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') } }
  }

  Step 'PhoneDesk will remove'
  Info "the scheduled task and the program ($exe)"
  Info 'PhoneDesk hooks in Claude Code / Codex (a backup is written first)'
  Info 'the Windows Firewall rule PhoneDesk added, if any (asks Windows for permission)'
  if ($Purge) { Info "ALL your data in $dataDir (layout, paired phones, uploaded icons and sounds)" } else { Info "(your data in $dataDir is kept)" }
  if ($DryRun) { Caution 'dry run: nothing was removed'; return }
  if (-not (Ask 'Continue?' $true)) { Write-Host 'Cancelled; nothing was removed.'; return }

  Step 'Stopping and removing the service'
  if (Test-Path -LiteralPath $exe) {
    [void](Run-Bin @('service', 'uninstall'))
    Ok 'scheduled task removed'
    Step 'Removing hooks'
    [void](Run-Bin @('hooks', 'remove'))
    Ok 'hooks removed'
  } else {
    Caution "no program at $exe (already removed?)"
  }
  Get-Process -Name phonedesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700

  Step 'Firewall rule'
  $rule = $false
  try { $rule = [bool](Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' }) } catch { }
  if ($rule) {
    try {
      $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "netsh advfirewall firewall delete rule name=all program=`"$exe`"") -Verb RunAs -Wait -PassThru -WindowStyle Hidden
      if ($p.ExitCode -eq 0) { Ok 'firewall rule removed' } else { Caution "netsh returned $($p.ExitCode); remove the rule named PhoneDesk in Windows Security > Firewall > Advanced settings" }
    } catch { Caution 'the permission prompt was declined; the rule named PhoneDesk is still there (Windows Security > Firewall > Advanced settings)' }
  } else {
    Info 'no PhoneDesk firewall rule found'
  }

  Step 'Removing the program'
  if (Test-Path -LiteralPath $binDir) { Remove-Item -LiteralPath $binDir -Recurse -Force -ErrorAction SilentlyContinue; Ok "removed $binDir" }
  if (-not $relocated) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($userPath -split ';' | Where-Object { $_ })
    if ($parts -contains $binDir) { [Environment]::SetEnvironmentVariable('Path', (($parts | Where-Object { $_ -ne $binDir }) -join ';'), 'User'); Ok 'removed from your PATH' }
    $parent = Split-Path $binDir -Parent
    if ((Test-Path -LiteralPath $parent) -and -not (Get-ChildItem -LiteralPath $parent -Force)) { Remove-Item -LiteralPath $parent -Force -ErrorAction SilentlyContinue }
  }
  if ($Purge) {
    if (Ask "Really delete $dataDir (this cannot be undone)?" $Yes.IsPresent) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue; Ok "deleted $dataDir" }
  } else {
    Info "Your data is still in $dataDir. Delete that folder to remove everything."
  }
  Step 'Done'
}

if ($env:PHONEDESK_SETUP_NORUN -ne '1') {
  Uninstall-PhoneDesk -Purge:($env:PHONEDESK_PURGE -eq '1') -Yes:($env:PHONEDESK_YES -eq '1') -DryRun:($env:PHONEDESK_DRY_RUN -eq '1')
}
