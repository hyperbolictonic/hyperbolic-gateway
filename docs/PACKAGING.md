# 📦 Packaging & Multi-Target Installer Guide

Kuang Grade Mark Eleven uses `electron-builder` to produce production-grade desktop distributions, single-file portable binaries, and native installers across Windows, Linux, and macOS.

---

## 🚀 Quick Commands

### Windows Targets
| Command | Output Format | Description |
| :--- | :--- | :--- |
| `pnpm run build:win` | `.exe` (NSIS) | Interactive Windows installer with Desktop shortcut & Start Menu entry |
| `pnpm run build:win:portable` | `.exe` (Portable) | Single-file zero-install executable. Runs anywhere without admin rights |
| `pnpm run build:win:all` | NSIS, Portable, `.zip` | Complete Windows release matrix for x64 architecture |

### Linux Targets
| Command | Output Format | Description |
| :--- | :--- | :--- |
| `pnpm run build:linux:appimage` | `.AppImage` | Universal single-file Linux binary that runs across any distro |
| `pnpm run build:linux:deb` | `.deb` | Debian / Ubuntu / Pop!_OS native package |
| `pnpm run build:linux` | AppImage, deb, `.tar.gz` | Complete Linux distribution bundle |

### macOS Targets
| Command | Output Format | Description |
| :--- | :--- | :--- |
| `pnpm run build:mac` | `.dmg`, `.zip` | Drag-and-drop macOS disk image and compressed app bundle (x64 + ARM64) |

### Development Testing
| Command | Output | Description |
| :--- | :--- | :--- |
| `pnpm run build:pack` | `release/win-unpacked/` | Rapid unpackaged directory build to inspect bundle contents without compression |
| `pnpm run build:dist:all` | All Platforms | Full cross-platform matrix build (Windows, macOS, Linux) |

---

## 🛠️ Configuration Details (`electron-builder.json`)

The packaging configuration is stored in [electron-builder.json](../electron-builder.json):

1. **ASAR & Native Addon Unpacking:**
   Native vector database binaries (`@lancedb` and `.node` addons) are automatically extracted to `app.asar.unpacked/` so they link cleanly without runtime crashes.
2. **Branding & Visuals:**
   Icon points to `public/assets/mark-eleven.png` for unified cyberdeck branding across desktop, taskbar, and installer dialogues.
3. **Output Destination:**
   All compiled installers and archives are placed in the `release/` directory.
