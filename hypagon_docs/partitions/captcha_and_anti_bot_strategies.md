# Kuang Grade Mark Eleven: CAPTCHA, Anti-Bot & HIL Strategies

## 1. Challenge Triage Matrix

When an agent encounters a block or challenge page in Kuang Browser, it MUST classify the challenge before acting:

| Challenge Type | Appearance / Indicators | Recommended Autonomous Action | Escalation (HIL) |
| :--- | :--- | :--- | :--- |
| **Simple Text CAPTCHA** | Distorted letters/numbers image + text input box (`name="captcha"`, `id="captcha_input"`) | Read text from image via `take_screenshot(marks:true)` or `observe(as="markdown")`, type text into box with `act(mark_id, action="type", text="…")`, click submit. | If 2 failed attempts, trigger HIL. |
| **Math / Logic Challenge** | Simple text e.g. "What is 4 + 7?" or "Type the 3rd word" | Evaluate the math expression in prompt, type answer into input. | None needed. |
| **Cloudflare Turnstile Checkbox** | "Verify you are human" iframe box | Try clicking the Turnstile checkbox via `act(mark_id, action="click")`. | If Turnstile enters infinite loop or shows interactive puzzle, trigger HIL. |
| **Complex Puzzle / Geetest / reCAPTCHA v2 Image Grid** | "Select all traffic lights" / slider puzzle | **DO NOT GUESS.** These burn time and flag the IP. | Trigger `request_human_intervention` or `send_notification` IMMEDIATELY. |
| **2FA / SMS OTP / Login Prompt** | "Enter code sent to +1-XXX..." or password prompt | **STOP.** The agent does not have access to the user's phone or 2FA authenticator app. | Trigger `request_human_intervention` IMMEDIATELY. |

---

## 2. Triggering Human-In-The-Loop (HIL)

When human intervention is required:

### Option A: Blocking Intervention (`request_human_intervention`)
Halts the agent loop, plays an audible alert, brings the Kuang browser window to the front, and presents a HUD banner on screen until the human solves the challenge and clicks "Resolved":
```json
{
  "reason": "Cloudflare Turnstile verification required to access target page",
  "timeout_seconds": 180,
  "bring_to_front": true
}
```

### Option B: Non-Blocking Desktop Alert (`send_notification`)
If you want to notify the user via a native Windows toast notification without completely freezing execution:
```json
{
  "title": "Kuang Browser: Human Intervention Required",
  "message": "Please complete SMS 2FA verification in the active browser window.",
  "urgency": "critical"
}
```
