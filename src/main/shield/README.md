# 🛡️ Shield Breaker Subsystem

The **Shield Breaker** is Mark Eleven's automated consent and modal defense system. It unblocks agent operations by automatically detecting and dismissing cookie consent dialogs, GDPR banners, and overlay barriers using physical Bézier mouse clicks.

---

## 🎯 Architecture & Operation

1. **Vendor Detection Rules:**
   - Detects standard CMP architectures including **OneTrust**, **Cookiebot**, **Google Consent**, **TrustArc**, **Didomi**, **Civic**, and **Quantcast**.
2. **Heuristic Pattern Matching:**
   - Evaluates interactive elements matching natural language consent intent (`Accept All`, `Allow All`, `Agree & Continue`, `I Agree`).
3. **Physical Mouse Simulation:**
   - Rather than programmatic DOM `.click()` (which anti-bot scripts can easily flag with `isTrusted: false`), Shield Breaker routes through `InputSimulator`, actuating the Bézier cursor and genuine OS mouse events.
4. **Body Unfreezing:**
   - Clears lingering `overflow: hidden` restrictions on `document.body` if the dismissed modal locked the page scrollbar.
