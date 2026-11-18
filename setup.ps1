# PhoneDesk installer for Windows 10/11 (experimental): downloads the latest release, checks it, installs it and starts it.
#
#   irm https://raw.githubusercontent.com/howznguyen/phonedesk/main/setup.ps1 | iex
#
# Run it as yourself in a normal PowerShell window (not "as administrator"): the only step that needs administrator
# rights is the optional firewall rule, and Windows asks for that one separately (UAC).
# Running it again updates PhoneDesk; your layout, paired phones and settings in %USERPROFILE%\.phonedesk are kept.
#
# Options (through environment variables, because `irm | iex` cannot pass parameters):
#   $env:PHONEDESK_YES=1            answer every question with its default (unattended)
#   $env:PHONEDESK_VERSION=0.2.0    install this release instead of the latest
#   $env:PHONEDESK_PORT=7420        the port the agent listens on
#   $env:PHONEDESK_NO_AUTOSTART=1   do not start PhoneDesk at logon (no scheduled task)
#   $env:PHONEDESK_NO_START=1       install only; do not start the agent
#   $env:PHONEDESK_NO_OPEN=1        do not open the management page in the browser
#   $env:PHONEDESK_NO_FIREWALL=1    do not offer the Windows Firewall rule
#   $env:PHONEDESK_NO_PATH=1        do not add PhoneDesk to your PATH
#   $env:PHONEDESK_DRY_RUN=1        download and verify, show what would happen, change nothing
# Or save the file, dot-source it with $env:PHONEDESK_SETUP_NORUN=1 and call Install-PhoneDesk -Yes -Port 7421 ...
#
# Test knobs (not for normal use):
#   PHONEDESK_RELEASE_BASE   a folder or URL that holds phonedesk-windows-x64.exe and SHA256SUMS
#   PHONEDESK_INSTALL_HOME   install under this folder instead of %LOCALAPPDATA% / %USERPROFILE%

function Install-PhoneDesk {
  [CmdletBinding()]
  param(
    [switch]$Yes, [string]$Version = '', [int]$Port = 7420, [switch]$NoAutostart, [switch]$NoStart,
    [switch]$NoOpen, [switch]$NoFirewall, [switch]$NoPath, [switch]$DryRun
  )
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow in Windows PowerShell 5.1
  $repo = 'howznguyen/phonedesk'
  $asset = 'phonedesk-windows-x64.exe'
  $tmp = $null

  function Step($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
  function Info($m) { Write-Host "    $m" }
  function Ok($m) { Write-Host "    OK  $m" -ForegroundColor Green }
  function Caution($m) { Write-Host "    !   $m" -ForegroundColor Yellow }
  function Die($m) {
    Write-Host ''
    Write-Host "Setup stopped: $m" -ForegroundColor Red
    Write-Host "Help: https://github.com/$repo#quick-start  -  issues: https://github.com/$repo/issues" -ForegroundColor Red
    throw "PhoneDesk setup stopped: $m"
  }
  function Ask([string]$question, [bool]$default) {
    $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
    if ($Yes -or -not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
      Info "$question $hint -> $(if ($default) { 'yes' } else { 'no' }) (default)"
      return $default
    }
    while ($true) {
      $a = (Read-Host "    $question $hint").Trim()
      if ($a -eq '') { return $default }
      if ($a -match '^(y|yes)$') { return $true }
      if ($a -match '^(n|no)$') { return $false }
    }
  }

  try {
    # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    if ($Port -lt 1 -or $Port -gt 65535) { Die '-Port must be between 1 and 65535' }

    # ---------- where things go ----------
    $relocated = [bool]$env:PHONEDESK_INSTALL_HOME
    if ($relocated) {
      $installHome = $env:PHONEDESK_INSTALL_HOME
      $binDir = Join-Path $installHome 'bin'
      $dataDir = Join-Path $installHome '.phonedesk'
    } else {
      $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
      $binDir = Join-Path $local 'PhoneDesk\bin'
      $dataDir = Join-Path $env:USERPROFILE '.phonedesk'
    }
    $exe = Join-Path $binDir 'phonedesk.exe'
    $logDir = Join-Path $dataDir 'logs'
    # with a relocated install (tests) keep every file the program touches inside it
    $childEnv = @{ PHONEDESK_HOME = $dataDir }
    if ($relocated) {
      $childEnv['PHONEDESK_WIN_DIR'] = Join-Path $installHome 'service'
      $childEnv['PHONEDESK_CLAUDE_DIR'] = if ($env:PHONEDESK_CLAUDE_DIR) { $env:PHONEDESK_CLAUDE_DIR } else { Join-Path $installHome '.claude' }
      $childEnv['PHONEDESK_CODEX_DIR'] = if ($env:PHONEDESK_CODEX_DIR) { $env:PHONEDESK_CODEX_DIR } else { Join-Path $installHome '.codex' }
    } elseif ($env:PHONEDESK_HOME) {
      $childEnv['PHONEDESK_HOME'] = $env:PHONEDESK_HOME
    }
    function Run-Bin([string]$file, [string[]]$arguments, [switch]$Quiet) {
      # runs the program with PhoneDesk's environment and returns its exit code (its output is shown unless -Quiet)
      $saved = @{}
      foreach ($k in $childEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $childEnv[$k], 'Process') }
      $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue' # a native program writing to stderr must not abort the script
      try {
        $out = & $file @arguments 2>&1
        $code = $LASTEXITCODE
        if (-not $Quiet) { foreach ($l in $out) { Write-Host "    $l" } }
        return $code
      } finally {
        $ErrorActionPreference = $ea
        foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
      }
    }

    # ---------- 1. this computer ----------
    Step 'Checking this computer'
    if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { Die "PhoneDesk's Windows installer only runs on Windows." }
    if (-not [Environment]::Is64BitOperatingSystem) { Die 'PhoneDesk needs 64-bit Windows 10 or 11.' }
    $os = [Environment]::OSVersion.Version
    if ($os.Major -lt 10) { Die "PhoneDesk needs Windows 10 or 11 (this is $($os.ToString()))." }
    if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and -not $relocated) {
      # With UAC turned off (EnableLUA=0) every process of an administrator account is elevated and there is no
      # "normal PowerShell window" to switch to: installing as this user is the only option, so go on by default.
      $uacOff = $false
      try { $uacOff = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction Stop).EnableLUA -eq 0 } catch { }
      if ($uacOff) {
        Info 'UAC is turned off on this PC, so PowerShell always runs as administrator; installing for this user.'
      } else {
        Caution 'You are running as administrator. PhoneDesk should run as your own user; start a normal PowerShell window instead.'
        if (-not (Ask 'Continue anyway?' $false)) { Die 'cancelled; nothing was installed' }
      }
    }
    Ok "Windows $($os.Major).$($os.Build) x64, using $asset"

    # ---------- 2. which release ----------
    Step 'Finding the release'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('phonedesk-setup-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $custom = $false
    if ($env:PHONEDESK_RELEASE_BASE) {
      $base = $env:PHONEDESK_RELEASE_BASE.TrimEnd('/', '\')
      $custom = $true
      Info "using PHONEDESK_RELEASE_BASE=$base"
    } else {
      if (-not $Version) {
        try {
          $req = [Net.HttpWebRequest]::Create("https://github.com/$repo/releases/latest")
          $req.Method = 'HEAD'; $req.UserAgent = 'phonedesk-setup'
          $resp = $req.GetResponse()
          $tag = ($resp.ResponseUri.AbsoluteUri -split '/tag/')[1]
          $resp.Close()
        } catch { $tag = $null }
        if (-not $tag) { Die "could not find the latest release of $repo (is there a release yet, and are you online?)" }
      } else {
        $tag = 'v' + $Version.TrimStart('v')
      }
      $base = "https://github.com/$repo/releases/download/$tag"
      Info "release $tag"
    }

    # ---------- 3. download and check ----------
    Step "Downloading $asset"
    function Fetch([string]$src, [string]$dest) {
      if ($src -match '^https?://') {
        if (-not $custom -and $src -notmatch '^https://') { throw 'refusing a non-https download' }
        Invoke-WebRequest -Uri $src -OutFile $dest -UseBasicParsing -UserAgent 'phonedesk-setup'
      } else {
        if (-not (Test-Path -LiteralPath $src)) { throw "not found: $src" }
        Copy-Item -LiteralPath $src -Destination $dest
      }
    }
    $dl = Join-Path $tmp $asset
    $sums = Join-Path $tmp 'SHA256SUMS'
    try { Fetch "$base/$asset" $dl } catch { Die "could not download $base/$asset ($($_.Exception.Message))" }
    try { Fetch "$base/SHA256SUMS" $sums } catch { Die "could not download $base/SHA256SUMS ($($_.Exception.Message))" }
    $expected = $null
    foreach ($line in Get-Content -LiteralPath $sums) {
      $m = [regex]::Match($line, '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$')
      if ($m.Success -and $m.Groups[2].Value -eq $asset) { $expected = $m.Groups[1].Value.ToLowerInvariant(); break }
    }
    if (-not $expected) { Die "$asset is not listed in SHA256SUMS; refusing to install it" }
    $actual = (Get-FileHash -LiteralPath $dl -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Die "$asset does not match its SHA256SUMS entry (expected $expected, got $actual). Nothing was installed." }
    Ok "$asset matches SHA256SUMS ($actual)"
    Unblock-File -LiteralPath $dl -ErrorAction SilentlyContinue # no "downloaded from the internet" mark: SmartScreen stays quiet
    $newVersion = $null
    $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $newVersion = (& $dl --version 2>$null | Select-Object -First 1) } catch { }
    $ErrorActionPreference = $ea
    if (-not $newVersion) { Die 'the downloaded program does not run on this computer (it printed no version)' }
    Ok $newVersion
    $oldVersion = $null
    if (Test-Path -LiteralPath $exe) { $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $oldVersion = (& $exe --version 2>$null | Select-Object -First 1) } catch { }; $ErrorActionPreference = $ea }

    # ---------- 4. install ----------
    Step 'Installing'
    Info "program:  $exe"
    Info "your data stays in $dataDir"
    if ($oldVersion) { Info "replacing $oldVersion" }
    if ($DryRun) {
      Caution 'dry run: nothing was installed, started or changed'
      if (-not $NoAutostart) { Info 'would create the scheduled task "PhoneDesk" (start at logon)' }
      if (-not $NoFirewall) { Info 'would offer a Windows Firewall rule for phonedesk.exe for your local network only (one UAC prompt)' }
      Info "would start PhoneDesk on port $Port and open http://localhost:$Port/manage/"
      return
    }
    if (-not (Ask "Install PhoneDesk to ${exe}?" $true)) { Die 'cancelled; nothing was installed' }
    $autostart = -not $NoAutostart
    if ($autostart) { if (-not (Ask 'Start PhoneDesk automatically when you sign in?' $true)) { $autostart = $false } }

    # stop what is running so the file can be replaced: the scheduled task first, then a manually started agent
    if (Test-Path -LiteralPath $exe) {
      [void](Run-Bin $exe @('service', 'uninstall') -Quiet)
      Get-Process -Name phonedesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 700
    }
    New-Item -ItemType Directory -Force -Path $binDir, $logDir | Out-Null
    $staged = Join-Path $binDir '.phonedesk.new.exe'
    Copy-Item -LiteralPath $dl -Destination $staged -Force
    Move-Item -LiteralPath $staged -Destination $exe -Force
    Ok "installed $newVersion"

    # PATH (user level), so `phonedesk doctor` works in any terminal
    if (-not $NoPath -and -not $relocated) {
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $parts = @($userPath -split ';' | Where-Object { $_ })
      if ($parts -notcontains $binDir) {
        if (Ask 'Add PhoneDesk to your PATH (so you can run `phonedesk` in any terminal)?' $true) {
          [Environment]::SetEnvironmentVariable('Path', (($parts + $binDir) -join ';'), 'User')
          Ok 'added to your PATH (open a new terminal to use it)'
        }
      }
    }

    # ---------- 5. firewall (the one step that needs administrator rights) ----------
    # BEFORE the first start: when a program listens without a rule, Windows shows a popup and, unanswered, creates BLOCK rules that beat any allow rule
    if (-not $NoFirewall -and -not $NoStart) {
      Step 'Letting your phone reach PhoneDesk'
      $has = $false; $blocked = $false
      try {
        $rules = @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
        $has = [bool]($rules | Where-Object { $_.Action -eq 'Allow' })
        $blocked = [bool]($rules | Where-Object { $_.Action -eq 'Block' })
      } catch { }
      if ($has -and -not $blocked) {
        Ok 'Windows Firewall already allows phonedesk.exe'
      } else {
        Info 'Windows Firewall blocks incoming connections by default, so a phone on your Wi-Fi could not reach PhoneDesk.'
        if ($blocked) { Caution 'Windows has BLOCK rules for phonedesk.exe (from an unanswered firewall popup); they are removed in the same step.' }
        Info 'This adds ONE inbound rule for phonedesk.exe, for your local subnet only (any network profile, nothing from the internet), and asks Windows for permission (UAC).'
        if (Ask 'Add the firewall rule?' $true) {
          $rule = "netsh advfirewall firewall delete rule name=all program=`"$exe`" >nul 2>&1 & netsh advfirewall firewall add rule name=`"PhoneDesk`" dir=in action=allow program=`"$exe`" profile=any remoteip=localsubnet enable=yes"
          try {
            $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $rule) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
            if ($p.ExitCode -eq 0) { Ok 'firewall rule added (local subnet only)' } else { Caution "netsh returned $($p.ExitCode); run `phonedesk doctor` for what to do" }
          } catch { Caution 'the permission prompt was declined; no rule was added. Run `phonedesk doctor` to see how to add it later.' }
        } else {
          Info 'Skipped. Without the rule your phone cannot connect; `phonedesk doctor` shows the command to add it later.'
        }
      }
    }

    # ---------- 6. start ----------
    if ($autostart) {
      Step 'Setting up the background service'
      $svcArgs = @('service', 'install')
      if ($Port -ne 7420) { $svcArgs += @('--port', "$Port") }
      if ((Run-Bin $exe $svcArgs) -eq 0) {
        Ok "PhoneDesk will start when you sign in and restart if it crashes (logs: $logDir)"
        $started = $true
      } else {
        Caution 'could not install the scheduled task; starting PhoneDesk without it'
        $autostart = $false
      }
    }
    # make sure installed Claude/Codex hooks (if any) point at this program
    [void](Run-Bin $exe @('hooks', 'repoint', '--port', "$Port") -Quiet)

    if (-not $NoStart -and -not $autostart) {
      Step 'Starting PhoneDesk'
      $saved = @{}
      foreach ($k in $childEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $childEnv[$k], 'Process') }
      try {
        [void](Start-Process -FilePath $exe -ArgumentList @('--port', "$Port") -WindowStyle Hidden -WorkingDirectory $dataDir -RedirectStandardOutput (Join-Path $logDir 'agent.out.log') -RedirectStandardError (Join-Path $logDir 'agent.err.log'))
      } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') } }
    }

    if (-not $NoStart) {
      Step 'Waiting for PhoneDesk'
      $pairing = $null
      for ($i = 0; $i -lt 40; $i++) {
        try { $pairing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/pairing" -Headers @{ 'x-phonedesk' = '1' } -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 500 }
      }
      if (-not $pairing) { Die "PhoneDesk did not answer on port $Port. Look at $logDir\agent.err.log" }
      Ok "running on port $Port"
      Write-Host ''
      Write-Host "  Phone URL:   $($pairing.url)"
      Write-Host "  Pairing PIN: $($pairing.pin)"
      Write-Host "  Manage:      http://localhost:$Port/manage/"
      Write-Host ''
      if (-not [Console]::IsOutputRedirected -and $pairing.url) { try { $qrUrl = if ($pairing.urlLocal) { $pairing.urlLocal } else { $pairing.url }; & $exe qr "$qrUrl" } catch { } }
      Info 'Open the phone URL on a phone on the same Wi-Fi and enter the PIN.'
      if (-not $NoOpen -and -not $relocated) {
        if (Ask 'Open the management page now?' $true) { try { Start-Process "http://localhost:$Port/manage/" } catch { } }
      }
    } else {
      Info "Installed. Start it with: $exe"
    }
    Step 'Done'
    Info 'Check permissions and the firewall any time with: phonedesk doctor'
    Info 'Update: run the same install command again.  Remove: uninstall.ps1 (see the README).'
  } finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

if ($env:PHONEDESK_SETUP_NORUN -ne '1') {
  Install-PhoneDesk `
    -Yes:($env:PHONEDESK_YES -eq '1') -Version ([string]$env:PHONEDESK_VERSION) `
    -Port $(if ($env:PHONEDESK_PORT) { [int]$env:PHONEDESK_PORT } else { 7420 }) `
    -NoAutostart:($env:PHONEDESK_NO_AUTOSTART -eq '1') -NoStart:($env:PHONEDESK_NO_START -eq '1') `
    -NoOpen:($env:PHONEDESK_NO_OPEN -eq '1') -NoFirewall:($env:PHONEDESK_NO_FIREWALL -eq '1') `
    -NoPath:($env:PHONEDESK_NO_PATH -eq '1') -DryRun:($env:PHONEDESK_DRY_RUN -eq '1')
}
