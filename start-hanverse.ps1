# Start HanVerse from the repository root, even when this script is launched
# from the parent "hanverse-learn" folder.
$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
Set-Location -LiteralPath $repoRoot

Write-Host ""
Write-Host "  HanVerse local development" -ForegroundColor Cyan
Write-Host "  Repository: $repoRoot" -ForegroundColor DarkGray
Write-Host ""

foreach ($requiredFile in @('package.json', 'package-lock.json', 'netlify.toml')) {
    $path = Join-Path $repoRoot $requiredFile
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "HanVerse setup is incomplete: missing $requiredFile in $repoRoot"
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed or is not on PATH. Install the Node.js LTS release, then retry."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not installed or is not on PATH. Repair the Node.js installation, then retry."
}

# Check dependencies from THIS repository, never from the parent directory.
$modulesDir = Join-Path $repoRoot 'node_modules'
$needsInstall = -not (Test-Path -LiteralPath $modulesDir -PathType Container)
if (-not $needsInstall) {
    & npm ls --depth=0 --parseable *> $null
    $needsInstall = ($LASTEXITCODE -ne 0)
}

if ($needsInstall) {
    Write-Host "Installing the exact dependencies recorded in package-lock.json..." -ForegroundColor Yellow
    & npm ci
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed (exit code $LASTEXITCODE). Review the npm output above."
    }
}

# Use an installed Netlify CLI when available; otherwise let npx obtain it.
$netlify = Get-Command netlify -ErrorAction SilentlyContinue
if ($netlify) {
    Write-Host "Starting Netlify Dev from the HanVerse repository root..." -ForegroundColor Green
    & $netlify.Source dev
} else {
    Write-Host "Netlify CLI not found globally; starting it through npx..." -ForegroundColor Yellow
    & npx --yes netlify-cli@latest dev
}

if ($LASTEXITCODE -ne 0) {
    throw "Netlify Dev exited with code $LASTEXITCODE."
}
