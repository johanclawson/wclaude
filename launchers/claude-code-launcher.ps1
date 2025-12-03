<#
.SYNOPSIS
    Claude Code Windows Launcher with crash recovery and environment setup

.DESCRIPTION
    This launcher script:
    - Sets up proper Windows environment variables for Claude Code
    - Prevents MSYS path conversion issues
    - Allocates sufficient Node.js heap memory (32GB)
    - Loads API tokens from Windows Registry (optional)
    - Provides auto-relaunch on crash capability

.NOTES
    Based on claude-code-windows-setup by aaronvstory
    Enhanced for claude-code-win-v2

.PARAMETER FolderPath
    Optional path to open Claude Code in a specific directory
#>

param(
    [Parameter(Position = 0)]
    [string]$FolderPath
)

# ============================================
# Configuration
# ============================================

$ErrorActionPreference = "Continue"

# ============================================
# Environment Variables
# ============================================

# Prevent MSYS/Git Bash path conversion issues
$env:MSYS_NO_PATHCONV = "1"
$env:MSYS2_ARG_CONV_EXCL = "*"

# Allocate 32GB heap for Node.js (helps with large projects)
$env:NODE_OPTIONS = "--max-old-space-size=32768"

# Disable shell timeout (optional - use claude settings.json instead)
# $env:BASH_DEFAULT_TIMEOUT_MS = "1800000"
# $env:BASH_MAX_TIMEOUT_MS = "7200000"

# ============================================
# Git Path Setup (prefer Program Files Git over Scoop)
# ============================================

$gitPath = "C:\Program Files\Git\cmd"
if (Test-Path $gitPath) {
    # Ensure Program Files Git is first in PATH
    $currentPath = $env:PATH -split ';' | Where-Object { $_ -notmatch 'scoop.*git' }
    $env:PATH = "$gitPath;$($currentPath -join ';')"
}

# ============================================
# Optional: Load API tokens from Registry
# ============================================

function Get-EnvFromRegistry {
    param([string]$Name)
    try {
        $value = [System.Environment]::GetEnvironmentVariable($Name, "User")
        if ($value) { return $value }
        $value = [System.Environment]::GetEnvironmentVariable($Name, "Machine")
        return $value
    }
    catch {
        return $null
    }
}

# Load common API tokens if not already set
$tokenNames = @(
    'ANTHROPIC_API_KEY',
    'GITHUB_TOKEN',
    'BRAVE_API_KEY',
    'EXA_API_KEY',
    'PERPLEXITY_API_KEY'
)

foreach ($tokenName in $tokenNames) {
    if (-not $env:$tokenName) {
        $value = Get-EnvFromRegistry $tokenName
        if ($value) {
            Set-Item "env:$tokenName" -Value $value
        }
    }
}

# ============================================
# WSL Path Detection
# ============================================

# Check if path is a WSL UNC path (\\wsl$\... or \\wsl.localhost\...)
if ($FolderPath -match '^\\\\wsl') {
    Write-Host ""
    Write-Host "WSL path detected: $FolderPath" -ForegroundColor Yellow
    Write-Host "Redirecting to WSL launcher..." -ForegroundColor Yellow
    Write-Host ""

    # Convert UNC path to WSL path
    # \\wsl$\Ubuntu\home\user → /home/user
    # \\wsl.localhost\Ubuntu\home\user → /home/user
    $wslPath = $FolderPath -replace '^\\\\wsl(\$|\.localhost)\\[^\\]+', ''
    $wslPath = $wslPath -replace '\\', '/'

    # Extract distro name
    $distro = $FolderPath -replace '^\\\\wsl(\$|\.localhost)\\([^\\]+).*', '$2'

    Write-Host "Launching in WSL ($distro): $wslPath" -ForegroundColor Cyan
    wsl -d $distro --cd $wslPath -- claude
    exit $LASTEXITCODE
}

# ============================================
# MCP Module Junction Setup
# ============================================

# Create junction for Claude Code MCP module to avoid admin privileges
# This helps when Claude Code tries to access node_modules in protected locations

$claudeDataDir = Join-Path $env:USERPROFILE ".claude"
$mcpModulesDir = Join-Path $claudeDataDir "mcp_modules"

if (-not (Test-Path $mcpModulesDir)) {
    try {
        New-Item -ItemType Directory -Path $mcpModulesDir -Force | Out-Null
        Write-Host "[Launcher] Created MCP modules directory: $mcpModulesDir" -ForegroundColor Gray
    }
    catch {
        Write-Host "[Launcher] Warning: Could not create MCP modules directory" -ForegroundColor Yellow
    }
}

# Set MCP_MODULES_PATH environment variable for Claude Code
$env:MCP_MODULES_PATH = $mcpModulesDir

# ============================================
# Working Directory
# ============================================

if ($FolderPath -and (Test-Path $FolderPath -PathType Container)) {
    Set-Location $FolderPath
    Write-Host "[Launcher] Working directory: $FolderPath" -ForegroundColor Cyan
}

# ============================================
# Check Prerequisites
# ============================================

$claudeCommand = Get-Command "claude-code-win-v2" -ErrorAction SilentlyContinue
if (-not $claudeCommand) {
    Write-Host ""
    Write-Host "ERROR: claude-code-win-v2 is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "To install:" -ForegroundColor Yellow
    Write-Host "  1. npm install -g @anthropic-ai/claude-code --ignore-scripts" -ForegroundColor White
    Write-Host "  2. npm install -g claude-code-win-v2" -ForegroundColor White
    Write-Host ""
    Write-Host "Or if running from local repo:" -ForegroundColor Yellow
    Write-Host "  cd path\to\claude-code-win-v2" -ForegroundColor White
    Write-Host "  npm link" -ForegroundColor White
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# ============================================
# Launch Loop with Crash Recovery
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     Claude Code Windows Launcher      " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Environment configured:" -ForegroundColor Green
Write-Host "  - MSYS path conversion: disabled" -ForegroundColor Gray
Write-Host "  - Node.js heap: 32GB" -ForegroundColor Gray
Write-Host "  - Git path: $(if (Test-Path $gitPath) { 'Program Files' } else { 'default' })" -ForegroundColor Gray
Write-Host "  - MCP modules: $mcpModulesDir" -ForegroundColor Gray
Write-Host ""

$continueRunning = $true

while ($continueRunning) {
    Write-Host "Starting Claude Code..." -ForegroundColor Green
    Write-Host ""

    try {
        # Run claude-code-win-v2
        & claude-code-win-v2 @args
        $exitCode = $LASTEXITCODE
    }
    catch {
        Write-Host ""
        Write-Host "ERROR: Claude Code crashed with exception:" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        $exitCode = 1
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  Claude Code session ended (exit: $exitCode)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  [R] Relaunch Claude Code" -ForegroundColor White
    Write-Host "  [Q] Quit" -ForegroundColor White
    Write-Host ""

    $choice = Read-Host "Enter choice"

    switch ($choice.ToUpper()) {
        'R' {
            Write-Host ""
            Write-Host "Relaunching..." -ForegroundColor Green
            # Continue the loop
        }
        'Q' {
            $continueRunning = $false
        }
        default {
            $continueRunning = $false
        }
    }
}

Write-Host ""
Write-Host "Goodbye!" -ForegroundColor Cyan
