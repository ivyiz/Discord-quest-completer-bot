@echo off
title Ivyseal DQC Discord Bot Launcher
color 0a
echo ========================================================
echo   ✨ IVYSEAL DQC BOT - TU DONG LAM QUEST DISCORD
echo ========================================================
echo.
cd /d "%~dp0"
node index.js
if %errorlevel% neq 0 (
    echo Co loi xay ra hoac bot da dung.
    pause
)
