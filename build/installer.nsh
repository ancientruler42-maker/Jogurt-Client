; Jogurt Client — custom NSIS hooks only.
; Do NOT !define MUI_ICON / MUI_UNICON here; electron-builder already sets them.

; Keep AppData (.jogurtclient profiles) when uninstalling the app files.
!macro customRemoveFiles
  RMDir /r "$INSTDIR"
!macroend
