; Remove a per-user copy left behind by the move to installMode "both".
;
; Up to 1.9.1 the bundle used installMode "currentUser", which installs into
; %LOCALAPPDATA% and does not include MultiUser.nsh at all -- so it never wrote
; the marker value a "both" installer reads to decide which scope this machine
; already uses. Every install made before 1.9.2 therefore has no marker,
; MultiUser finds nothing, and with MULTIUSER_EXECUTIONLEVEL Highest and an
; administrator running it the fallback is AllUsers.
;
; The result is a second copy in Program Files with the per-user one still
; sitting in %LOCALAPPDATA%: still listed in Apps, still launchable, and never
; updated again, because the updater only ever installs over whichever copy the
; installer chose. Launching the stale one just downloads the same update and
; installs it to Program Files a second time, leaving itself behind again.
;
; The install location cannot be preserved from here. The scope is decided in
; .onInit, before any page is drawn, and this hook runs inside Section Install
; long after that -- reaching it would mean replacing the whole generated script
; through bundle.windows.nsis.template. What this can do is make sure the
; machine is not left with two, which is the part that actually bites.
;
; Only fires in the one direction that can strand a copy: installing all-users
; while a per-user install exists. A per-user install never orphans an all-users
; one, since it could not have written HKLM in the first place.
;
; THE VAULT IS NOT TOUCHED. The uninstaller only removes app data under
; ${If} $DeleteAppDataCheckboxState = 1, and that variable is assigned in
; exactly one place -- from the checkbox on a page a silent uninstall never
; shows -- so it stays empty and the comparison is false. Checked against the
; generated script rather than assumed, because getting it wrong would delete
; somebody's atriums.

; Strip one leading and one trailing double quote, in place. NSIS has no string
; trim, and the label suffix is what keeps two uses in one macro from declaring
; the same label twice.
!macro _AtriumUnquote VAR SUFFIX
  StrCpy $R2 ${VAR} 1
  StrCmp $R2 '"' 0 hook_unquote_done_${SUFFIX}
    StrLen $R2 ${VAR}
    IntOp $R2 $R2 - 2
    StrCpy ${VAR} ${VAR} $R2 1
  hook_unquote_done_${SUFFIX}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; $MultiUser.InstallMode exists only for installMode "both". Guard on the
  ; define so this file stays inert if the mode is ever changed back.
  !ifdef MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY
    Push $R0
    Push $R1
    Push $R2

    StrCmp $MultiUser.InstallMode "AllUsers" 0 hook_orphan_done

      ; The per-user uninstaller, from the hive a per-user install writes to.
      ReadRegStr $R0 HKCU "${UNINSTKEY}" "UninstallString"
      StrCmp $R0 "" hook_orphan_done 0

      ReadRegStr $R1 HKCU "${UNINSTKEY}" "InstallLocation"

      ; Both values are stored WITH literal double quotes around them -- checked
      ; in the registry, not assumed. Left in place they would reach ExecWait as
      ; ""C:\...\uninstall.exe"" and _?= as a quoted path, which it rejects.
      !insertmacro _AtriumUnquote $R0 a
      !insertmacro _AtriumUnquote $R1 b

      DetailPrint "Removing the previous per-user installation..."

      ; _?= keeps the uninstaller in its own directory so it runs synchronously.
      ; Without it NSIS copies itself to %TEMP% and returns at once, and the file
      ; copying below would race a process still deleting the old install. /S is
      ; silent: nobody asked to see a second wizard inside this one.
      StrCmp $R1 "" hook_orphan_no_dir 0
        ExecWait '"$R0" /S _?=$R1'
        ; An uninstaller running under _?= cannot delete itself.
        Delete "$R0"
        RMDir "$R1"
        Goto hook_orphan_cleaned

      hook_orphan_no_dir:
        ExecWait '"$R0" /S'

      hook_orphan_cleaned:
        ; However the uninstaller tidied up, the HKCU key must not survive: a
        ; later "both" installer would read its CurrentUser marker and default
        ; this machine back to a per-user install that is no longer there.
        DeleteRegKey HKCU "${UNINSTKEY}"
        DeleteRegKey HKCU "${MANUPRODUCTKEY}"

    hook_orphan_done:
    Pop $R2
    Pop $R1
    Pop $R0
  !endif
!macroend
