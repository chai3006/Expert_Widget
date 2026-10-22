; Expert Widget installer additions (electron-builder NSIS include).
;
; "Start at login" is on by default. The app switches it on itself the first time it runs
; (see main.ts); this also covers the case where the installer finishes without starting the app.
; The value name and command match what Electron's app.setLoginItemSettings writes, so the tray
; toggle shows and changes the same entry. A reinstall or update does not switch it back on once
; the app has run (its state folder exists), so turning it off in the tray sticks.

!macro customInstall
  IfFileExists "$APPDATA\Expert Widget\ui.json" +2 0
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.expertwidget.app" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
!macroend

; The finish page says where the CV goes and offers to open that folder. Same "Run" checkbox as
; electron-builder's own finish page (assistedInstaller.nsh), plus a second checkbox. The folder is
; the app's default (ExpertWidget\CV in the user's Documents folder, which is where
; app.getPath('documents') points too). The app's welcome screen says the same, with the real path.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function OpenCvFolder
    CreateDirectory "$DOCUMENTS\ExpertWidget\CV"
    ExecShell "open" "$DOCUMENTS\ExpertWidget\CV"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "Expert Widget is installed"
  !define MUI_FINISHPAGE_TEXT "Put your CV in this folder (one file: PDF, Word .docx or text .txt, in German or English):$\r$\n$\r$\n$DOCUMENTS\ExpertWidget\CV$\r$\n$\r$\nThen press Refresh in the widget. Your CV stays on your computer."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the CV folder"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "OpenCvFolder"
  !insertmacro MUI_PAGE_FINISH
!macroend

; Remove the entry on a real uninstall, but not when the uninstaller runs as part of an update.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "de.expertwidget.app"
  ${endIf}
!macroend
