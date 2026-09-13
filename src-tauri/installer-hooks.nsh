; Close anything still running from the install folder before touching files.
;
; The app spawns FFmpeg as a sidecar out of its own install directory, and a
; force-quit or a crash can leave one behind — the reason `reap_orphaned_sidecars`
; exists in capture.rs, after a preview sidecar was found holding the camera 22
; minutes after the app died. That reaper runs when the APP starts, which is no
; use to an INSTALLER, which runs when the app is not running.
;
; So an orphaned ffmpeg.exe holds ffmpeg.exe open, the installer cannot overwrite
; it, and the upgrade dies with "can't write file" — after it has already replaced
; lab-suite.exe, leaving a half-upgraded folder with no ffprobe.exe in it. Hit on
; a real machine on 2026-09-12, and the conversation-room computers are precisely
; the ones that get force-quit.
;
; Filtered on $INSTDIR rather than killing every ffmpeg.exe on the machine: an RA
; may be running FFmpeg for something else, and an installer has no business
; ending processes it does not own.

!macro KillOurProcesses
  DetailPrint "Closing anything still running from $INSTDIR..."
  nsExec::ExecToLog `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Windows releases the file handle a moment after the process goes.
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillOurProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; An uninstall fails the same way, and for the same reason.
  !insertmacro KillOurProcesses
!macroend
