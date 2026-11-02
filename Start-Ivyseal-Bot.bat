@echo off
title Ivyseal DQC Discord Bot Launcher
color 0a
echo ========================================================
echo   ✨ IVYSEAL DQC BOT - AUTO DISCORD QUEST COMPLETER
echo ========================================================
echo.
cd /d "%~dp0"
node index.js
if %errorlevel% neq 0 (
    echo An error occurred or the bot has stopped.
    pause
)
