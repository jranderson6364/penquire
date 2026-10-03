# Penquire one-shot setup (Windows PowerShell)
# Usage (from the app folder):   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Safe to re-run: finished steps are skipped.
# It pauses only for: Expo login, Apple ID + 2FA, registering the iPad, and choosing the device.

$ErrorActionPreference = 'Continue'  # native tools report via $LASTEXITCODE
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Pause-For($msg) { Write-Host "`n$msg" -ForegroundColor Yellow; Read-Host 'Press Enter when done' | Out-Null }

# 1. Node.js -----------------------------------------------------------------
Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
$major = 0
if ($node) { $major = [int]((node -v).TrimStart('v').Split('.')[0]) }
if ($major -lt 20) {
  Write-Host 'Installing Node.js LTS via winget...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node installed. Close this window, open a new PowerShell, and run setup.ps1 again.' -ForegroundColor Yellow
    exit 0
  }
}
Write-Host "Node $(node -v)"

# 2. Dependencies -------------------------------------------------------------
Step 'Installing project dependencies (npm install)'
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

# 3. API key ------------------------------------------------------------------
Step 'Anthropic API key (.env)'
$hasKey = (Test-Path .env) -and ((Get-Content .env -Raw) -match 'EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-[^\s.]')
if (-not $hasKey) {
  $secure = Read-Host 'Paste your Anthropic API key (from console.anthropic.com)' -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  @(
    "EXPO_PUBLIC_ANTHROPIC_API_KEY=$($key.Trim())",
    'EXPO_PUBLIC_CHECK_MODEL=claude-sonnet-5-5',
    'EXPO_PUBLIC_PARSE_MODEL=claude-sonnet-5-5'
  ) | Set-Content -Encoding utf8 .env
  Write-Host 'Saved .env'
} else { Write-Host '.env already has a key' }

# 4. EAS CLI + Expo login -----------------------------------------------------
Step 'EAS CLI'
if (-not (Get-Command eas -ErrorAction SilentlyContinue)) {
  npm install -g eas-cli
  $env:Path += ";$env:APPDATA\npm"
}
eas whoami 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { eas login }
Write-Host "Logged in to Expo as $(eas whoami)"

# 5. Link Expo project --------------------------------------------------------
Step 'Linking Expo project'
$appJson = Get-Content app.json -Raw | ConvertFrom-Json
if (-not $appJson.expo.extra.eas.projectId) { eas init --non-interactive --force 2>$null; if ($LASTEXITCODE -ne 0) { eas init } }
else { Write-Host 'Already linked' }

# 6. Register iPad ------------------------------------------------------------
Step 'Registering your iPad'
$reg = Read-Host 'Is your iPad already registered with EAS? (y/N)'
if ($reg -notmatch '^[yY]') {
  Write-Host 'Choose "Website" when asked, then open the link/QR on the iPad in Safari.'
  eas device:create
  Pause-For 'On the iPad: Settings > "Profile Downloaded" > Install.'
}

# 7. Cloud build --------------------------------------------------------------
Step 'Starting the iOS development build (10-20 min)'
Write-Host 'Answer YES to Apple login, certificate, and provisioning profile; select your iPad when asked.'
eas build --profile development --platform ios
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nBuild failed. Open the build page link above, copy the first red error, and paste it to Claude." -ForegroundColor Red
  exit 1
}

Pause-For @'
Install on the iPad: open the build link/QR above in Safari and tap Install.
If the app won't open: Settings > Privacy & Security > Developer Mode > On, restart, confirm.
'@

# 8. Dev server ---------------------------------------------------------------
Step 'Starting the dev server. Open Penquire on the iPad and tap this server.'
Write-Host 'If Windows Firewall asks about Node, allow Private networks.'
Write-Host 'If the iPad cannot find it, stop (Ctrl+C) and run:  npx expo start --dev-client --tunnel'
npx expo start --dev-client
