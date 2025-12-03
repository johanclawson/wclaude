@echo off
REM Claude Code Windows Launcher (BAT wrapper)
REM Calls the PowerShell launcher script

setlocal

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Run the PowerShell launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%claude-code-launcher.ps1" %*

endlocal
