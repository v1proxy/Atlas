# build.ps1: builds the Atlas launcher for Android on a Windows PC, with nothing installed beforehand and no
# administrator rights. Everything it downloads goes to %LOCALAPPDATA%\AtlasBuild (a JDK and Android's command-line
# build tools). The signing key is made once, in %USERPROFILE%\.android\atlas-launcher.jks; keep it, because Android
# only installs an update signed with the same key.
#   powershell -ExecutionPolicy Bypass -File launcher\build.ps1 [-Notes "what changed"]
# The finished app goes to launcher_dist\ beside Atlas, where Atlas serves it at /launcher to your signed-in phone.
param([string]$Notes = "")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$atlas = Split-Path -Parent $here
$proj = Join-Path $here "android"
$tools = Join-Path $env:LOCALAPPDATA "AtlasBuild"
New-Item -ItemType Directory -Force $tools | Out-Null

function Get-Zip($url, $dest) {
  $zip = "$dest.zip"
  Write-Host "Downloading $url"
  Invoke-WebRequest -UseBasicParsing $url -OutFile $zip
  Expand-Archive -Force $zip $dest
  Remove-Item $zip
}

# 1. Java 17 (Eclipse Temurin, portable)
$jdk = Get-ChildItem (Join-Path $tools "jdk") -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) {
  Get-Zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" (Join-Path $tools "jdk")
  $jdk = Get-ChildItem (Join-Path $tools "jdk") -Directory | Select-Object -First 1
}
$env:JAVA_HOME = $jdk.FullName
$env:Path = "$($jdk.FullName)\bin;$env:Path"

# 2. Android SDK: command-line tools, platform 35, build tools
$sdk = Join-Path $tools "android-sdk"
$sdkmanager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
  Get-Zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" (Join-Path $tools "clt")
  New-Item -ItemType Directory -Force (Join-Path $sdk "cmdline-tools") | Out-Null
  Move-Item (Join-Path $tools "clt\cmdline-tools") (Join-Path $sdk "cmdline-tools\latest")
  Remove-Item -Recurse (Join-Path $tools "clt")
}
$env:ANDROID_HOME = $sdk
if (-not (Test-Path (Join-Path $sdk "platforms\android-35"))) {
  $yes = ("y`n" * 20)
  $yes | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null
  & $sdkmanager --sdk_root=$sdk "platforms;android-35" "build-tools;35.0.0" "platform-tools" | Out-Null
}
Set-Content -Encoding ASCII (Join-Path $proj "local.properties") ("sdk.dir=" + ($sdk -replace '\\', '\\'))

# 3. The signing key, made once
$keydir = Join-Path $env:USERPROFILE ".android"; New-Item -ItemType Directory -Force $keydir | Out-Null
$store = Join-Path $keydir "atlas-launcher.jks"
$props = Join-Path $proj "keystore.properties"
if (-not (Test-Path $store)) {
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  & keytool -genkeypair -keystore $store -storetype PKCS12 -alias atlas -keyalg RSA -keysize 4096 -validity 36500 `
    -storepass $pw -keypass $pw -dname "CN=Atlas launcher" | Out-Null
  Set-Content -Encoding ASCII $props @("storeFile=$($store -replace '\\', '/')", "storePassword=$pw", "keyAlias=atlas", "keyPassword=$pw")
  Write-Host "Signing key made: $store (its password is in $props). Back both up."
}
if (-not (Test-Path $props)) { throw "The signing key exists but $props is missing." }

# 4. Build
Push-Location $proj
try { & .\gradlew.bat --no-daemon assembleRelease; if ($LASTEXITCODE -ne 0) { throw "The build failed." } }
finally { Pop-Location }

# 5. Hand it to Atlas
$apk = Join-Path $proj "app\build\outputs\apk\release\app-release.apk"
$dist = Join-Path $atlas "launcher_dist"; New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item -Force $apk (Join-Path $dist "atlas-launcher.apk")
$gp = Get-Content (Join-Path $proj "gradle.properties")
$code = [int](($gp | Select-String '^atlasVersionCode=(\d+)').Matches[0].Groups[1].Value)
$name = ($gp | Select-String '^atlasVersionName=(.+)$').Matches[0].Groups[1].Value.Trim()
$sha = (Get-FileHash -Algorithm SHA256 (Join-Path $dist "atlas-launcher.apk")).Hash.ToLower()
$json = [ordered]@{ version = $name; code = $code; notes = $Notes; sha256 = $sha; built = (Get-Date -Format s) } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $dist "latest.json"), $json)     # UTF-8 without a byte-order mark
Write-Host "Atlas launcher $name ($code) is in $dist"
