@echo off
REM Claude Code Continue Session (resumes last conversation)

setlocal

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Run the PowerShell launcher with --continue flag
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%claude-code-launcher.ps1" --continue %*

endlocal
