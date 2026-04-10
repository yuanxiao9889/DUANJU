@echo off
setlocal

set "PYTHON_EXE="

if defined HUNYUANWORLD_PYTHON (
  if exist "%HUNYUANWORLD_PYTHON%" (
    set "PYTHON_EXE=%HUNYUANWORLD_PYTHON%"
  )
)

if not defined PYTHON_EXE (
  if exist "%~dp0python.exe" (
    set "PYTHON_EXE=%~dp0python.exe"
  )
)

if defined PYTHON_EXE (
  "%PYTHON_EXE%" %*
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py -3 %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  python %*
  exit /b %ERRORLEVEL%
)

echo No usable Python interpreter was found. Set HUNYUANWORLD_PYTHON to a valid python.exe path. 1>&2
exit /b 1
