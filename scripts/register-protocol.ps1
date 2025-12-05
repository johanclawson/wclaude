<#
.SYNOPSIS
    Register the wclaude:// protocol handler for toast notification clicks.

.DESCRIPTION
    This script registers a custom URI protocol (wclaude://) that launches
    the focus-window.ps1 script when clicked. This enables toast notification
    click-to-focus functionality.

.NOTES
    Run this once during installation or first run.
    Requires elevation to write to HKCR (or uses HKCU for per-user).
#>

# Get script directory - works whether run directly or via npm global install
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$focusScript = Join-Path $scriptDir "focus-window.ps1"

# Verify focus script exists
if (-not (Test-Path $focusScript)) {
    Write-Error "focus-window.ps1 not found at: $focusScript"
    exit 1
}

# Use HKCU (per-user, no elevation needed) instead of HKCR (system-wide)
$protocolKey = "HKCU:\Software\Classes\wclaude"

try {
    # Create protocol key
    if (-not (Test-Path $protocolKey)) {
        New-Item -Path $protocolKey -Force | Out-Null
    }

    # Set protocol properties
    Set-ItemProperty -Path $protocolKey -Name "(Default)" -Value "URL:wclaude Protocol"
    Set-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value ""

    # Create shell\open\command key
    $commandKey = "$protocolKey\shell\open\command"
    if (-not (Test-Path $commandKey)) {
        New-Item -Path $commandKey -Force | Out-Null
    }

    # Set command to run pwsh with our focus script (hidden window)
    # The %1 receives the full URI (wclaude://focus/<handle>)
    # Use -WindowStyle Hidden to prevent PowerShell window from appearing
    $command = "pwsh -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$focusScript`" -UrlOrHandle `"%1`""
    Set-ItemProperty -Path $commandKey -Name "(Default)" -Value $command

    Write-Host "wclaude:// protocol registered successfully"
    Write-Host "Protocol key: $protocolKey"
    Write-Host "Command: $command"
}
catch {
    Write-Error "Failed to register protocol: $_"
    exit 1
}
