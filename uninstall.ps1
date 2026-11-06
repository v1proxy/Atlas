# uninstall.ps1: stops Atlas and removes what install.ps1 added. Your files are never touched.
# Kept: this folder (settings, tags, the action log) and the Atlas folder of links, which you can delete yourself.
$here = $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -match [regex]::Escape("$here\atlas_service.py") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$startup = [Environment]::GetFolderPath('Startup'); $programs = [Environment]::GetFolderPath('Programs')
Remove-Item "$startup\Atlas.vbs", "$programs\Atlas.url" -ErrorAction SilentlyContinue
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) { & $ts serve --https=443 off 2>&1 | Out-Null }
Remove-Item (Join-Path $here 'devices.json'), (Join-Path $here 'local.key') -ErrorAction SilentlyContinue   # every device is signed out
Write-Host "Atlas is stopped and removed from sign-in, the Start menu and Tailscale. Every device is signed out."
Write-Host "Left in place: $here and your Atlas folder of links."
