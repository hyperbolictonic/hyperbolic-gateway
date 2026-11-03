; Remove the pre-rebrand shortcuts after an in-place upgrade. The new installer creates the
; Hypagon Gateway shortcuts; the old names would otherwise be left behind pointing at a
; deleted executable. NSIS strips "//" from a shortcut name, which is why the Hyperbolic
; entry has a double space.
!macro customInstall
  Delete "$DESKTOP\Kuang Grade Mark Eleven  Cyberdeck.lnk"
  Delete "$SMPROGRAMS\Kuang Grade Mark Eleven  Cyberdeck.lnk"
  Delete "$DESKTOP\Hyperbolic Gateway  Cyberdeck.lnk"
  Delete "$SMPROGRAMS\Hyperbolic Gateway  Cyberdeck.lnk"
!macroend
