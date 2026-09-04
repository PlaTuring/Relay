!macro customRemoveFiles
  # The packaged app is deliberately executed during release validation. On
  # Windows, image mapping or antivirus inspection can transiently keep the
  # just-exited Relay.exe busy after the exact process tree is gone. The
  # electron-builder default performs one RMDir and silently continues, which
  # can leave Relay.exe behind. Retry the complete owned installation tree for
  # at most 30 seconds, then fail the uninstall instead of reporting success.
  SetOutPath "$TEMP"
  StrCpy $R9 0

  relay_remove_retry:
    ClearErrors
    RMDir /r "$INSTDIR"
    IfFileExists "$INSTDIR\*.*" relay_remove_pending 0
    IfFileExists "$INSTDIR" relay_remove_pending relay_remove_done

  relay_remove_pending:
    IntOp $R9 $R9 + 1
    IntCmp $R9 120 relay_remove_failed relay_remove_wait relay_remove_failed

  relay_remove_wait:
    Sleep 250
    Goto relay_remove_retry

  relay_remove_failed:
    DetailPrint "Relay installation files remain in use after bounded removal retries."
    Abort "Relay installation files are still in use. Close Relay and retry uninstall."

  relay_remove_done:
!macroend
