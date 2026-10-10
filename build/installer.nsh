; Expert Widget installer additions (electron-builder NSIS include).
;
; "Start with Windows" is on by default. The app switches it on itself the first time it runs
; (see main.ts); this also covers the case where the installer finishes without starting the app.
; The value name and command match what Electron's app.setLoginItemSettings writes, so the tray
; toggle shows and changes the same entry. A reinstall or update does not switch it back on once
; the app has run (its state folder exists), so turning it off in the tray sticks.

!macro customInstall
  IfFileExists "$APPDATA\Expert Widget\ui.json" +2 0
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.expertwidget.app" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
!macroend

; Remove the entry on a real uninstall, but not when the uninstaller runs as part of an update.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.expertwidget.app"
  ${endIf}
!macroend
