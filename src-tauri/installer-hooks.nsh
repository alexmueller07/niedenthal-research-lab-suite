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
;
; ---------------------------------------------------------------------------
; THE UNINSTALLER IS NOT ON THE LIST, AND THAT IS THE WHOLE POINT
; ---------------------------------------------------------------------------
; Alex, 2026-09-21. The version of this file written on 2026-09-12 matched on
; the path alone: "any process whose executable lives under $INSTDIR". That set
; turns out to include the uninstaller.
;
; Run uninstall.exe on its own and NSIS copies it to $TEMP first, so it is not
; under $INSTDIR and the filter misses it. But an UPGRADE does not run it on its
; own — Tauri's installer runs it in place, `uninstall.exe /P _?=$INSTDIR`
; (installer.nsi, reinst_uninstall), precisely so it can be waited on. In place
; means its own ExecutablePath is `$INSTDIR\uninstall.exe`, the filter matched
; it, and this hook — which runs as the first thing in Section Uninstall — shot
; the uninstaller before it deleted anything.
;
; What the lab saw: exit code -1, not one file removed, and because Tauri's
; template treats a surviving `$INSTDIR\<app>.exe` as failure whatever the exit
; code, a message box reading "Unable to uninstall!" and an upgrade that refused
; to proceed. Every machine with a previous version installed, from v1.1.0 on.
;
; So the kill list is now explicit: the app and the two sidecars, which are the
; only things that can hold a file handle open, and never the uninstaller. An
; allow-list rather than a "not uninstall.exe" exclusion, because the failure
; mode of getting this wrong is silent and expensive, and a new sidecar should
; have to be added here deliberately.

!macro KillOurProcesses
  DetailPrint "Closing anything still running from $INSTDIR..."
  nsExec::ExecToLog `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ours = @('${MAINBINARYNAME}.exe', 'ffmpeg.exe', 'ffprobe.exe'); Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -like '$INSTDIR\*' -and $$ours -contains $$_.Name } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
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
