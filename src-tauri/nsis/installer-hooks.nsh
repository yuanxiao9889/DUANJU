!macro NSIS_HOOK_PREINSTALL
  ; Close lingering Dreamina subprocesses from the previous install so bundled files can be replaced.
  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "dreamina.exe"' $0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ClearErrors
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "dreamina.exe"' $0
  Sleep 800
!macroend
