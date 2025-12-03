<#
.SYNOPSIS
    Installs claude-code-win-v2 and its dependencies

.DESCRIPTION
    This script:
    1. Checks for Node.js and npm
    2. Installs @anthropic-ai/claude-code globally
    3. Links claude-code-win-v2 globally
    4. Optionally installs context menu integration

.PARAMETER SkipContextMenu
    Skip the context menu installation prompt

.PARAMETER InstallContextMenu
    Automatically install context menu (no prompt)
#>

param(
    [switch]$SkipContextMenu,
    [switch]$InstallContextMenu
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  claude-code-win-v2 Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Check Prerequisites
# ============================================

Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
$nodeVersion = $null
try {
    $nodeVersion = node --version
}
catch {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}
Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green

# Check npm
$npmVersion = $null
try {
    $npmVersion = npm --version
}
catch {
    Write-Host "ERROR: npm is not installed or not in PATH" -ForegroundColor Red
    exit 1
}
Write-Host "  npm: $npmVersion" -ForegroundColor Green

# Check Git (optional but recommended)
$gitVersion = $null
try {
    $gitVersion = git --version
    Write-Host "  Git: $gitVersion" -ForegroundColor Green
}
catch {
    Write-Host "  Git: NOT FOUND (optional but recommended for Unix commands)" -ForegroundColor Yellow
}

Write-Host ""

# ============================================
# Install Claude Code
# ============================================

Write-Host "Installing @anthropic-ai/claude-code..." -ForegroundColor Yellow

try {
    npm install -g @anthropic-ai/claude-code --ignore-scripts
    Write-Host "  Claude Code installed successfully" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: Failed to install Claude Code" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host ""

# ============================================
# Link claude-code-win-v2
# ============================================

Write-Host "Linking claude-code-win-v2..." -ForegroundColor Yellow

# Get the script's directory (installer folder)
$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Get the repo root (parent of installer folder)
$repoRoot = Split-Path -Parent $installerDir

try {
    Push-Location $repoRoot
    npm link
    Pop-Location
    Write-Host "  claude-code-win-v2 linked successfully" -ForegroundColor Green
}
catch {
    Pop-Location
    Write-Host "ERROR: Failed to link claude-code-win-v2" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host ""

# ============================================
# Context Menu Integration
# ============================================

if (-not $SkipContextMenu) {
    $installMenu = $InstallContextMenu

    if (-not $installMenu) {
        Write-Host "Would you like to add right-click context menu integration?" -ForegroundColor Cyan
        Write-Host "This adds 'Open with Claude Code' to folder right-click menus." -ForegroundColor Gray
        Write-Host ""
        $response = Read-Host "Install context menu? (y/n)"
        $installMenu = $response -eq 'y' -or $response -eq 'Y'
    }

    if ($installMenu) {
        Write-Host ""
        Write-Host "Installing context menu..." -ForegroundColor Yellow

        $regFile = Join-Path $repoRoot "registry\install-context-menu.reg"

        if (Test-Path $regFile) {
            # Update the reg file with actual paths
            $content = Get-Content $regFile -Raw
            $launcherPath = Join-Path $repoRoot "launchers\claude-code-launcher.ps1"
            $escapedPath = $launcherPath.Replace('\', '\\')

            # Replace placeholder paths
            $content = $content -replace 'C:\\\\Users\\\\%USERNAME%\\\\repos\\\\claude-code-win-v2\\\\launchers\\\\claude-code-launcher.ps1', $escapedPath

            # Create temp reg file with actual paths
            $tempReg = Join-Path $env:TEMP "claude-code-context-menu.reg"
            $content | Set-Content $tempReg -Encoding Unicode

            try {
                # Import registry file
                Start-Process "regedit.exe" -ArgumentList "/s `"$tempReg`"" -Wait -Verb RunAs
                Write-Host "  Context menu installed successfully" -ForegroundColor Green
            }
            catch {
                Write-Host "  WARNING: Context menu installation requires administrator privileges" -ForegroundColor Yellow
                Write-Host "  You can manually run: $regFile" -ForegroundColor Gray
            }
            finally {
                Remove-Item $tempReg -ErrorAction SilentlyContinue
            }
        }
        else {
            Write-Host "  WARNING: Registry file not found at $regFile" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# ============================================
# Configure Claude Code settings
# ============================================

Write-Host "Configuring Claude Code settings..." -ForegroundColor Yellow

$claudeDir = Join-Path $env:USERPROFILE ".claude"
$settingsFile = Join-Path $claudeDir "settings.json"

if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Create or update settings.json with timeout configuration
$settings = @{}
if (Test-Path $settingsFile) {
    try {
        $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json -AsHashtable
    }
    catch {
        $settings = @{}
    }
}

# Add/update env section for timeout settings
if (-not $settings.ContainsKey('env')) {
    $settings['env'] = @{}
}
$settings['env']['BASH_DEFAULT_TIMEOUT_MS'] = "1800000"  # 30 minutes
$settings['env']['BASH_MAX_TIMEOUT_MS'] = "7200000"      # 2 hours

$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsFile -Encoding UTF8
Write-Host "  Timeout settings configured in ~/.claude/settings.json" -ForegroundColor Green

Write-Host ""

# ============================================
# Done!
# ============================================

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run Claude Code using:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  claude-code-win-v2" -ForegroundColor White
Write-Host ""
Write-Host "Or use the launcher script for extra features:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  $repoRoot\launchers\claude-code-launcher.bat" -ForegroundColor White
Write-Host ""

if (-not $gitVersion) {
    Write-Host "TIP: Install Git for Windows to enable Unix commands (grep, find, awk, sed)" -ForegroundColor Yellow
    Write-Host "     https://git-scm.com/download/win" -ForegroundColor Gray
    Write-Host ""
}
