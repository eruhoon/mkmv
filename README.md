# 🎮 mkmv (RPG Maker MV & MZ - PortMaster Runner Template)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build and Release](https://github.com/eruhoon/mkmv/actions/workflows/release.yml/badge.svg)](https://github.com/eruhoon/mkmv/actions/workflows/release.yml)

An all-in-one universal master template and runner package for seamlessly launching and multiplying **RPG Maker MV** and **RPG Maker MZ** games on Linux ARM64 handheld devices (**ROCKNIX**, **KNULLI**, Batocera, etc.) via **PortMaster**.

---

## ✨ Features

* **Native Hardware Gamepad Mapping**: Fully calibrated 1:1 hardware gamepad mapping for standard handheld layouts, analog sticks, and integrated NW.js compatibility shims (`preload.js`).
* **Robust Wayland / Weston Runtime**: Automatic environment detection and optimized launch pipelines for both KNULLI (Weston Auto Kiosk) and ROCKNIX (Sway).
* **R3 Turbo Fast-Forward & Thermal Throttling Guard**: Toggle 2x speedup with R3 stick click (`▶▶ 2x` on-screen indicator) with a 50% render frame-skip engine to prevent SoC overheating.
* **Atomic Safe-Save Protection**: Hardware-level SD card physical fsync flush, isolated `.bak` backups (`save/.bak/`), and automatic corrupted 0-byte save restoration.
* **Sleep/Resume Audio Recovery**: Automatic WebAudio context recovery ensures sound never freezes after device sleep or standby.
* **Universal CJK Fallback Fonts**: Bundled `Noto Sans CJK KR` auto-injection eliminates missing Korean/Japanese glyphs and tofu (□) characters.
* **Low-Memory Protection for 1GB RAM Devices**: 512MB compressed ZRAM dynamic swap, `MALLOC_ARENA_MAX=1`, V8 heap capping, and scene-transition GC triggers prevent Out-Of-Memory (OOM) crashes on budget handhelds.
* **Smart Folder Auto-Matching**: Automatically detects and matches game directories identical to the `.sh` launcher name—no script editing required.
* **Dual Engine Support**: Separate isolated layouts and hooks supporting both RPG Maker MV (`www/`) and RPG Maker MZ (`game/`).
* **Lightweight Repository**: Bulky binaries are excluded from git history and packaged cleanly via `pnpm build` or downloadable directly from GitHub Releases.

---

## 🚀 Quick Start (For Users)

1. Download the latest **`mkmv-v0.3.0.zip`** from the [Releases](https://github.com/eruhoon/mkmv/releases) page.
2. Extract the archive and copy the `mkmv.sh` file and `mkmv` folder to `roms/ports/` on your device's SD card.
3. Place your RPG Maker MV game's `www` folder contents into `mkmv/www/` (or MZ contents into `mkmv/game/`) and launch from the Ports menu!

> 📖 For detailed game duplication, multi-game setup, and advanced config options, see **[HOW_TO_USE.md](HOW_TO_USE.md)**.

---

## 🛠️ Development & Building (Developer Guide)

This project supports cross-platform automated builds powered by **Node.js (v20+)** and **pnpm**.

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Build Release Package
```bash
pnpm run build
```

* Automatically downloads and caches the official Electron aarch64 runtime.
* Cleans conflicting driver libraries and bundles runtime assets and template scripts.
* Outputs the prepared folder `dist/mkmv/` and the final release archive **`dist/mkmv-v*.zip`**.

### 3. Clean Build Artifacts
```bash
pnpm run clean
```

---

## ⚠️ Disclaimer

* **mkmv** is an unofficial open-source runner/template project and is not affiliated with, endorsed by, or associated with **Gotcha Gotcha Games**, **KADOKAWA**, or the **PortMaster** team.
* This repository does not contain any commercial game data, copyrighted assets, or RPG Maker engine core binaries. It only provides a runtime wrapper for games legitimately owned and provided by the user.

---

## 📄 License

The source code in this repository is distributed under the [MIT License](LICENSE).  
Runtime binaries and dependencies are governed by Electron (MIT) and Chromium open-source licenses.
