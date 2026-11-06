# install.ps1: installs Atlas for this Windows user, in the folder this file is in.
# Double-click "Install Atlas.cmd", or run:  powershell -ExecutionPolicy Bypass -File install.ps1
# It never needs administrator rights and never opens anything on your router.
#   1. checks Python 3.10+ and installs the few packages Atlas uses
#   2. creates atlas.config.json from the example the first time (edit it to choose your folders)
#   3. starts Atlas at sign-in (Startup folder) and adds Atlas to the Start menu
#   4. if Tailscale is installed, lets your own devices reach Atlas privately (tailscale serve, never Funnel)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
Set-Location $here
function Say($m) { Write-Host "  $m" }
Write-Host "`nInstalling Atlas from $here`n"

# 1. Python
$py = Get-Command python -ErrorAction SilentlyContinue
$ok = $false
if ($py) { try { $ok = (& python -c "import sys; print(sys.version_info >= (3, 10))") -eq 'True' } catch { $ok = $false } }
if (-not $ok) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say "Installing Python 3.12 for this user (winget)..."
    winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements | Out-Null
    Say "Python is installed. Close this window and run the installer once more."; exit 1
  }
  throw "Atlas needs Python 3.10 or newer: https://www.python.org/downloads/ (tick 'Add python.exe to PATH')."
}
$pyw = Join-Path (Split-Path (Get-Command python).Source) 'pythonw.exe'
Say "Python: $((& python --version) -join '')"
& python -m pip install --disable-pip-version-check -q -r (Join-Path $here 'requirements.txt')
Say "Packages: installed"

# 2. Settings
if (-not (Test-Path (Join-Path $here 'atlas.config.json'))) {
  Copy-Item (Join-Path $here 'atlas.config.example.json') (Join-Path $here 'atlas.config.json')
  Say "Settings: created atlas.config.json from the example. Edit it to choose your folders, then run this again."
  Start-Process notepad.exe (Join-Path $here 'atlas.config.json')
} else { Say "Settings: atlas.config.json kept as it is" }
$view = (& python -c "import config; print(config.VIEW)").Trim()
$port = (& python -c "import config; print(config.PORT)").Trim()
New-Item -ItemType Directory -Force $view | Out-Null
$dev = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
if ($dev -ne 1) { Say "Note: turn on Developer Mode (Settings > System > For developers) so Atlas can build its folder of links in $view. The map and file browser work without it." }

# 3. Start at sign-in, Start menu, icons, Quick Access
& python (Join-Path $here 'make_icons.py') | Out-Null
$startup = [Environment]::GetFolderPath('Startup'); $programs = [Environment]::GetFolderPath('Programs')
$vbs = "' Atlas: indexes your folders, keeps $view current, serves the map at http://127.0.0.1:$port`r`n" +
       "Set sh = CreateObject(""WScript.Shell"")`r`nsh.Run """"""$pyw"""" """"$here\atlas_service.py"""""", 0, False`r`n"
Set-Content -Path "$startup\Atlas.vbs" -Value $vbs -Encoding ASCII
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -match [regex]::Escape("$here\atlas_service.py") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 1
Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$startup\Atlas.vbs`""
$key = (& python -c "import security; print(security.local_key())").Trim()
$url = "[InternetShortcut]`r`nURL=http://127.0.0.1:$port/login?key=$key`r`nIconFile=$here\atlas.ico`r`nIconIndex=0`r`n"
Set-Content -Path "$programs\Atlas.url" -Value $url -Encoding ASCII
Set-Content -Path (Join-Path $view 'Atlas map.url') -Value $url -Encoding ASCII
try { (New-Object -ComObject shell.application).Namespace($view).Self.InvokeVerb('pintohome') } catch { }
Say "Starts at sign-in: $startup\Atlas.vbs"
Say "Start menu: Atlas (signs this PC in; keep the shortcut private)"

# 4. Phone access through Tailscale only
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) {
  $p = Start-Process -FilePath $ts -ArgumentList "serve --bg $port" -WindowStyle Hidden -PassThru
  if (-not $p.WaitForExit(15000)) {
    Say "Tailscale: Serve needs one click in your Tailscale account. Run in a terminal:  tailscale serve --bg $port  and open the link it shows."
  } else { Say "Tailscale: Atlas is reachable from your own devices at https://$((& python -c "import security; print(security.ts_name() or '')").Trim())" }
  Say "Tailscale Funnel (the public internet) stays off: $((& $ts funnel status 2>&1) -join ' ')"
} else { Say "Tailscale is not installed: Atlas stays on this PC only. Install Tailscale to use it from your phone." }

Start-Sleep -Seconds 3
Start-Process "$programs\Atlas.url"
Write-Host "`nDone. Atlas is open in your browser. Pair a phone from Atlas: Devices, then Pair a phone.`n"
