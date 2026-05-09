!macro NSIS_HOOK_PREINSTALL
  ; Close lingering Dreamina subprocesses from the previous install so bundled files can be replaced.
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
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "dreamina.exe"' $0
  Sleep 800
!macroend
