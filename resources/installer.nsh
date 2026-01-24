; ============================================================================
; Nuvana NSIS Installer Customization Script
;
; Custom macros for enhanced Windows installer behavior.
; Handles application close detection, folder permissions, and uninstall prompts.
;
; @module installer.nsh
; @security SEC-014: Proper permission handling
; ============================================================================

!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ============================================================================
; customInit - Called before installation begins
; ============================================================================
!macro customInit
  ; Check if Nuvana application is currently running
  ; Use FindWindow to check for the application window
  FindWindow $0 "" "Nuvana"
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Nuvana is currently running.$\n$\nClick OK to close it and continue with installation, or Cancel to abort." \
      IDOK closeRunningApp IDCANCEL abortInstall

    closeRunningApp:
      ; Try graceful shutdown first via WM_CLOSE
      SendMessage $0 ${WM_CLOSE} 0 0

      ; Wait for application to close (up to 5 seconds)
      StrCpy $1 0
      ${Do}
        Sleep 500
        IntOp $1 $1 + 1
        FindWindow $0 "" "Nuvana"
        ${If} $0 == 0
          ${Break}
        ${EndIf}
      ${LoopUntil} $1 >= 10

      ; If still running, force kill via taskkill
      ${If} $0 != 0
        nsExec::ExecToStack 'taskkill /IM Nuvana.exe /F'
        Pop $0
        Pop $1
        Sleep 2000
      ${EndIf}
      Goto doneCloseCheck

    abortInstall:
      Abort "Installation cancelled by user."

    doneCloseCheck:
  ${EndIf}

  ; Also check for running process by name (backup check)
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq Nuvana.exe" /NH'
  Pop $0
  Pop $1
  ${If} $1 != ""
    ; Check if output contains our process (not just "INFO: No tasks...")
    StrCpy $2 $1 4
    ${If} $2 == "Nuva"
      ; Process found via tasklist, try to kill it
      nsExec::ExecToStack 'taskkill /IM Nuvana.exe /F'
      Pop $0
      Pop $1
      Sleep 2000
    ${EndIf}
  ${EndIf}
!macroend

; ============================================================================
; customInstall - Called after files are installed
; ============================================================================
!macro customInstall
  ; Create application data directory in user's LocalAppData
  ; Using LOCALAPPDATA ensures per-user isolation (SEC-014 compliance)
  CreateDirectory "$LOCALAPPDATA\nuvana"

  ; Create subdirectories for organized data storage
  CreateDirectory "$LOCALAPPDATA\nuvana\logs"
  CreateDirectory "$LOCALAPPDATA\nuvana\data"

  ; Set appropriate permissions on the data folder
  ; The folder inherits user-only permissions from LOCALAPPDATA
  ; No explicit ACL modification needed for single-user installation

  ; Write installation info for troubleshooting
  FileOpen $0 "$LOCALAPPDATA\nuvana\.install-info" w
  ${If} $0 != ""
    FileWrite $0 "Installed: $INSTDIR$\r$\n"
    FileWrite $0 "Version: ${VERSION}$\r$\n"
    FileWrite $0 "Date: $\r$\n"
    FileClose $0
  ${EndIf}
!macroend

; ============================================================================
; customUnInit - Called when uninstaller initializes
; ============================================================================
!macro customUnInit
  ; Check if application is running before uninstall
  FindWindow $0 "" "Nuvana"
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Nuvana is currently running.$\n$\nClick OK to close it and continue with uninstallation, or Cancel to abort." \
      IDOK closeBeforeUninstall IDCANCEL abortUninstall

    closeBeforeUninstall:
      SendMessage $0 ${WM_CLOSE} 0 0
      Sleep 2000

      ; Force kill if still running
      FindWindow $0 "" "Nuvana"
      ${If} $0 != 0
        nsExec::ExecToStack 'taskkill /IM Nuvana.exe /F'
        Pop $0
        Pop $1
        Sleep 1000
      ${EndIf}
      Goto doneUninstallCheck

    abortUninstall:
      Abort "Uninstallation cancelled by user."

    doneUninstallCheck:
  ${EndIf}
!macroend

; ============================================================================
; customUnInstall - Called during uninstallation
; ============================================================================
!macro customUnInstall
  ; Prompt user about data removal
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove all Nuvana application data?$\n$\n\
This includes:$\n\
- Local database$\n\
- Configuration settings$\n\
- Log files$\n$\n\
Click No to keep this data for future reinstallation." \
    IDNO skipDataRemoval

  ; User chose to remove data
  ; Remove log files first
  RMDir /r "$LOCALAPPDATA\nuvana\logs"

  ; Remove data directory
  RMDir /r "$LOCALAPPDATA\nuvana\data"

  ; Remove install info file
  Delete "$LOCALAPPDATA\nuvana\.install-info"

  ; Remove main config files
  Delete "$LOCALAPPDATA\nuvana\config.json"
  Delete "$LOCALAPPDATA\nuvana\nuvana.db"
  Delete "$LOCALAPPDATA\nuvana\nuvana.db-shm"
  Delete "$LOCALAPPDATA\nuvana\nuvana.db-wal"

  ; Try to remove the directory (will fail if not empty, which is fine)
  RMDir "$LOCALAPPDATA\nuvana"

  skipDataRemoval:
!macroend
