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
