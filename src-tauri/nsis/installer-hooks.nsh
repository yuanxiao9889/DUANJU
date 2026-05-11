!macro NSIS_HOOK_PREINSTALL
  ; Close the app before copying the new executable. Do not use /T for the
  ; main app here: during in-app updates the installer can be a child process
  ; of the app, and killing the whole tree may terminate the installer too.
  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM "${MAINBINARYNAME}.exe"' $0
  Sleep 1200

  ; Keep this hard-coded fallback for older builds whose running process name
  ; may not match the current NSIS main binary variable.
  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM "storyboard-copilot.exe"' $0
  Sleep 800

  ; Close lingering Dreamina subprocesses from the previous install so bundled
  ; files can be replaced.
  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "dreamina.exe"' $0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Never let installer-driven uninstall remove user projects/media from AppData.
  ; Tauri's default NSIS template exposes a "Delete application data" checkbox that maps
  ; to %APPDATA%\com.storyboard.copilot; an upgrade should only replace program files.
  StrCpy $DeleteAppDataCheckboxState 0

  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM "${MAINBINARYNAME}.exe"' $0
  Sleep 1200

  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM "storyboard-copilot.exe"' $0
  Sleep 800

  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "dreamina.exe"' $0
  Sleep 800
!macroend
