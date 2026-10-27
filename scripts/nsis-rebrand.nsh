; Remove the pre-rebrand shortcuts after an in-place upgrade. The new installer creates the
; Hyperbolic Gateway shortcuts; the old names would otherwise be left behind pointing at a
; deleted executable.
!macro customInstall
  Delete "$DESKTOP\Kuang Grade Mark Eleven  Cyberdeck.lnk"
  Delete "$SMPROGRAMS\Kuang Grade Mark Eleven  Cyberdeck.lnk"
!macroend
