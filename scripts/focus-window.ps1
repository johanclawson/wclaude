<#
.SYNOPSIS
    Focus a Windows Terminal window by its handle.

.DESCRIPTION
    This script is called by wclaude toast notifications to bring the correct
    Windows Terminal window to the foreground using its window handle (HWND).
    The handle uniquely identifies a specific WT window even when multiple
    WT windows share the same process.

    Uses AttachThreadInput to bypass Windows focus-stealing prevention for
    protocol handlers (which run as background processes).

.PARAMETER UrlOrHandle
    Either a wclaude://focus/{handle} URL or a direct window handle number.

.EXAMPLE
    .\focus-window.ps1 "wclaude://focus/12345678"

.EXAMPLE
    .\focus-window.ps1 12345678
#>
param(
    [string]$UrlOrHandle = ""
)

# Parse input - could be wclaude:// URL or direct handle
$WtHandle = 0

if ($UrlOrHandle -match '^wclaude://focus/(\d+)') {
    $WtHandle = [long]$Matches[1]
} elseif ($UrlOrHandle -match '^\d+$') {
    $WtHandle = [long]$UrlOrHandle
}

# Also check $args[0] in case URL was passed without -UrlOrHandle
if ($WtHandle -eq 0 -and $args.Count -gt 0) {
    $arg = $args[0]
    if ($arg -match '^wclaude://focus/(\d+)') {
        $WtHandle = [long]$Matches[1]
    } elseif ($arg -match '^\d+$') {
        $WtHandle = [long]$arg
    }
}

# Logging helper - uncomment Log calls below to enable debug logging
# $logFile = Join-Path $env:USERPROFILE ".claude\focus-window.log"
# function Log($msg) {
#     $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
#     "$timestamp - $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
# }

# Log "=== focus-window.ps1 started ==="
# Log "UrlOrHandle param: '$UrlOrHandle'"
# Log "args[0]: '$($args[0])'"
# Log "Parsed WtHandle: $WtHandle"

# Exit if no valid handle
if ($WtHandle -eq 0) {
    # Log "ERROR: No valid handle, exiting"
    exit 0
}

# Add Win32 functions for window focus
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinApi {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;
}
"@

# Convert to IntPtr
$hwnd = [IntPtr]$WtHandle
# Log "Converted to IntPtr: $hwnd"

# Verify the window handle is valid
$isValidWindow = [WinApi]::IsWindow($hwnd)
# Log "IsWindow result: $isValidWindow"
if (-not $isValidWindow) {
    # Log "ERROR: Invalid window handle, exiting"
    exit 0
}

# Check if minimized
$isMinimized = [WinApi]::IsIconic($hwnd)
# Log "IsIconic (minimized): $isMinimized"

# Get thread IDs for AttachThreadInput
$fgWindow = [WinApi]::GetForegroundWindow()
# Log "Foreground window: $fgWindow"
$fgThreadId = [uint32]0
[WinApi]::GetWindowThreadProcessId($fgWindow, [ref]$fgThreadId) | Out-Null
$currentThreadId = [WinApi]::GetCurrentThreadId()
# Log "Foreground thread ID: $fgThreadId"
# Log "Current thread ID: $currentThreadId"

# Attach our thread to the foreground thread to bypass focus-stealing prevention
$attached = [WinApi]::AttachThreadInput($currentThreadId, $fgThreadId, $true)
# Log "AttachThreadInput result: $attached"

if ($attached) {
    try {
        # Restore if minimized
        if ([WinApi]::IsIconic($hwnd)) {
            $restoreResult = [WinApi]::ShowWindow($hwnd, [WinApi]::SW_RESTORE)
            # Log "ShowWindow(SW_RESTORE) result: $restoreResult"
        }

        # Now we have permission - focus the window
        $bringResult = [WinApi]::BringWindowToTop($hwnd)
        # Log "BringWindowToTop result: $bringResult"
        $fgResult = [WinApi]::SetForegroundWindow($hwnd)
        # Log "SetForegroundWindow result: $fgResult"

        # Give message queue time to process
        Start-Sleep -Milliseconds 50
    } finally {
        # Always detach
        $detachResult = [WinApi]::AttachThreadInput($currentThreadId, $fgThreadId, $false)
        # Log "Detach result: $detachResult"
    }
} else {
    # Log "AttachThreadInput failed, trying fallback..."
    # Fallback: try without AttachThreadInput (may not work but worth trying)
    if ([WinApi]::IsIconic($hwnd)) {
        $restoreResult = [WinApi]::ShowWindow($hwnd, [WinApi]::SW_RESTORE)
        # Log "Fallback ShowWindow(SW_RESTORE) result: $restoreResult"
    }
    $bringResult = [WinApi]::BringWindowToTop($hwnd)
    # Log "Fallback BringWindowToTop result: $bringResult"
    $fgResult = [WinApi]::SetForegroundWindow($hwnd)
    # Log "Fallback SetForegroundWindow result: $fgResult"
}

# Log "=== focus-window.ps1 finished ==="
exit 0
