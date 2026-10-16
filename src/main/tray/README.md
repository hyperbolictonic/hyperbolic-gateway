# 🗔 System Tray & Desktop Visibility Subsystem (`src/main/tray/`)

The **System Tray** module manages background desktop lifecycle, system tray icons, and window visibility for the Kuang Grade Mark Eleven Cyberdeck.

---

## 🎯 Purpose

- Keeps the Cyberdeck window completely out of the user's way during long-running automated tasks, batch scrapes, and research pipelines.
- Sits in the Windows Notification Area (System Tray) with custom high-contrast Mark Eleven insignia.
- Provides a fast toggle to minimize/hide the window or summon/restore it with a single tray click.
- Supports **Close-to-Tray** behavior so closing the window keeps active sessions and MCP uplinks alive in the background.

---

## 🏗️ Architecture

```mermaid
graph TD
    A[Electron Main Window] -->|Close Event| B{closeToTray?}
    B -->|true| C[mainWindow.hide & Keep Running]
    B -->|false| D[app.quit]
    E[Tray Icon Click / Double-Click] --> F[Toggle Window Visibility]
    G[Agent MCP / HTTP Bridge] -->|set_window_visibility| H[Show or Hide Window]
    G -->|configure_system_tray| I[Update Tray Preferences]
    J[Chassis State / Tabs / HIL] -->|updateStatus| K[Dynamic Tray Context Menu]
```

---

## 🔌 API & MCP Tools

- `set_window_visibility({ visible: boolean })`: Minimizes to tray (`false`) or restores to screen (`true`).
- `configure_system_tray({ close_to_tray?: boolean })`: Toggles close-to-tray background minimization.
