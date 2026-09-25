; Move an all-users install to this account, once.
;
; The installer is per-user only (installMode "currentUser"): no admin, no
; choice screen, and updates that install silently. 1.9.2 to 1.9.5 used "both",
; which defaulted an administrator to AllUsers, so machines that took those
; releases have the app in Program Files with its uninstall key in HKLM.
;
; A per-user installer cannot see that copy -- it reads HKCU -- and would
; install a second one beside it, while the Program Files copy stays in Apps,
; still launches, and never updates again. It cannot remove it either: that
; needs an administrator. So this runs the old uninstaller elevated, which is
; one UAC prompt, once, for the move. Every update after it is silent.
;
; THE VAULT IS NOT TOUCHED. The uninstaller removes app data only under
; ${If} $DeleteAppDataCheckboxState = 1, and that variable is assigned in
; exactly one place -- a checkbox on a page a silent uninstall never shows -- so
; it stays empty and the comparison is false. Checked against the generated
; script; if that ever changes upstream, this starts deleting people's atriums.
;
; Declining the prompt is not an error. The new copy installs regardless, the
; old one stays until removed from Apps, and the next update asks again.

; ---------------------------------------------------------------------------
; The folder page: keep people out of folders they cannot write to.
; ---------------------------------------------------------------------------
;
; The installer runs without admin rights, so a folder under Program Files or
; Windows fails halfway through with "Error opening file for writing". Asking
; for elevation at that point is no answer: the folder is remembered and every
; update reinstalls into it, so every update would need an administrator again
; -- the exact problem per-user installs exist to avoid -- and on a standard
; account the elevated copy would run as whoever typed the admin password.
;
; So Next stays disabled on those folders, and the page text says why. Anywhere
; else works without admin: the user's own folder, elsewhere on C:\ such as
; C:\Apps, or another drive.
;
; And AppData\LocalLow, which is writable but worse: it's the sandbox folder,
; and whatever is put in it is labelled low integrity. Windows runs a program
; from a low-labelled file at low integrity, and a low-integrity program can't
; write to its own user's AppData or temp folder -- so the webview couldn't make
; its data folder, and the app opened as a white flash and closed, leaving a
; process behind. That happened on a standard account whose copy was put there.
;
; Blocking the page is not enough on its own. The installer offers the folder
; the last install used (Tauri's RestorePreviousInstallLocation, from HKCU), so
; a copy already in a refused folder would come back to it: the page on a
; folder whose Next is disabled, and an update -- which skips the page -- into
; it again. So a remembered folder that would be refused is replaced by the
; default, AppData\Local\The Digital Atrium, before the page shows (AtriumGuiInit)
; and again before anything is copied (NSIS_HOOK_PREINSTALL, for silent runs,
; which have no GUI to init). The old copy is left to the uninstaller the
; installer already runs for a reinstall or update.
;
; All of it is set from here because this file is included (line 28 of the
; generated script) before the pages are declared: MUI reads
; MUI_DIRECTORYPAGE_TEXT_TOP when the folder page is inserted, and
; MUI_CUSTOMFUNCTION_GUIINIT when it writes .onGUIInit; .onVerifyInstDir is a
; global callback NSIS runs whenever the folder on that page changes. None is
; defined by Tauri's template -- checked -- so nothing is overridden. But
; ${PRODUCTNAME} is defined five lines later, so the functions here spell the
; name out.

!define MUI_DIRECTORYPAGE_TEXT_TOP "Setup will install The Digital Atrium in the following folder. To use a different one, click Browse.$\r$\n$\r$\nProgram Files and Windows need administrator rights, and AppData\LocalLow runs programs with restricted rights, so Next stays disabled there. Any other folder in your user folder, elsewhere on C:\ (such as C:\Apps) or on another drive works."

Var AtriumBlockedDir

; Sets AtriumBlockedDir to 1 when $INSTDIR is PREFIX itself or anything inside
; it. The character after the prefix must be "\" or nothing, so that
; "C:\Program Files2" is not mistaken for "C:\Program Files". Comparison is
; case-insensitive, as Windows paths are.
; ponytail: known system folders by prefix, not a real write test -- an 8.3
; short path (C:\PROGRA~1) or another user's profile still gets through and
; fails at copy time. Swap for a create-and-delete probe if that ever happens.
!macro _AtriumUnder PREFIX
  StrLen $R8 "${PREFIX}"
  StrCpy $R7 $INSTDIR $R8
  ${If} $R7 == "${PREFIX}"
    StrCpy $R7 $INSTDIR 1 $R8
    ${If} $R7 == ""
    ${OrIf} $R7 == "\"
      StrCpy $AtriumBlockedDir 1
    ${EndIf}
  ${EndIf}
!macroend

; Sets AtriumBlockedDir to 1 when $INSTDIR is a folder this installer refuses.
Function AtriumCheckInstDir
  Push $R7
  Push $R8
  StrCpy $AtriumBlockedDir 0
  !insertmacro _AtriumUnder "$PROGRAMFILES64"
  !insertmacro _AtriumUnder "$PROGRAMFILES"
  !insertmacro _AtriumUnder "$WINDIR"
  !insertmacro _AtriumUnder "$PROFILE\AppData\LocalLow"
  Pop $R8
  Pop $R7
FunctionEnd

; Back to the default folder, when the one in $INSTDIR would be refused.
Function AtriumDefaultIfRefused
  Call AtriumCheckInstDir
  ${If} $AtriumBlockedDir == 1
    DetailPrint "Installing in $LOCALAPPDATA\The Digital Atrium instead of $INSTDIR"
    StrCpy $INSTDIR "$LOCALAPPDATA\The Digital Atrium"
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  Call AtriumCheckInstDir
  ; Abort here disables Next rather than ending anything.
  ${If} $AtriumBlockedDir == 1
    Abort
  ${EndIf}
FunctionEnd

; Before the first page: after .onInit has put back the remembered folder.
!define MUI_CUSTOMFUNCTION_GUIINIT AtriumGuiInit
Function AtriumGuiInit
  Call AtriumDefaultIfRefused
FunctionEnd

; ---------------------------------------------------------------------------
; Moving an all-users install
; ---------------------------------------------------------------------------

; Strip one leading and one trailing double quote, in place. The uninstall
; values are stored WITH literal quotes -- checked in the registry -- and
; ExecShellWait wants the bare path.
!macro _AtriumUnquote VAR SUFFIX
  StrCpy $R2 ${VAR} 1
  StrCmp $R2 '"' 0 hook_unquote_done_${SUFFIX}
    StrLen $R2 ${VAR}
    IntOp $R2 $R2 - 2
    StrCpy ${VAR} ${VAR} $R2 1
  hook_unquote_done_${SUFFIX}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; A remembered folder that would be refused, for runs that never showed a
  ; page (see the folder page above). The section has already set the output
  ; path to it, so it's set again.
  Call AtriumDefaultIfRefused
  SetOutPath $INSTDIR

  Push $R0
  Push $R2

  ; The 64-bit view, explicitly. The all-users install was made in MultiUser
  ; mode, which switches to it; this per-user installer never does, so a plain
  ; HKLM read lands in WOW6432Node, finds nothing, and the move silently does
  ; not happen. Restored straight after, so nothing the installer writes later
  ; is affected.
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
  ReadRegStr $R0 HKLM "${UNINSTKEY}" "UninstallString"
  SetRegView default

  StrCmp $R0 "" hook_move_done 0
    !insertmacro _AtriumUnquote $R0 a
    DetailPrint "Moving The Digital Atrium from an all-users install to this account..."

    ; runas, because the old copy is under Program Files. Without _?= on
    ; purpose: the uninstaller relocates itself to %TEMP% and removes its own
    ; folder, which an unelevated installer could not do afterwards. That means
    ; ExecShellWait returns before the removal finishes -- harmless, since every
    ; path it touches (Program Files, HKLM, the all-users Start menu and
    ; desktop) is one this install does not use.
    ExecShellWait "runas" "$R0" "/S /AllUsers"

  hook_move_done:
  Pop $R2
  Pop $R0
!macroend
