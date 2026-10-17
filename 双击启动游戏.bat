@echo off
title PokeRogue LAN Multiplayer
cls

if exist "%~dp0repo\scripts\launcher.mjs" (
    node "%~dp0repo\scripts\launcher.mjs"
    pause
    goto :eof
)
if exist "%~dp0scripts\launcher.mjs" (
    node "%~dp0scripts\launcher.mjs"
    pause
    goto :eof
)
if exist "%~dp0launcher.mjs" (
    node "%~dp0launcher.mjs"
    pause
    goto :eof
)

cd /d "%~dp0repo"
pnpm run preview
pause
