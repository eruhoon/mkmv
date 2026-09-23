# 🎮 mkmv (RPG Maker MV & MZ - PortMaster Runner)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build and Release](https://github.com/eruhoon/mkmv/actions/workflows/release.yml/badge.svg)](https://github.com/eruhoon/mkmv/actions/workflows/release.yml)

An all-in-one universal runner and shared runtime architecture for seamlessly launching and multiplying **RPG Maker MV** and **RPG Maker MZ** games on Linux ARM64 handheld devices (**ROCKNIX**, **KNULLI**, Batocera, ArkOS, etc.) via **PortMaster**.

---

## ✨ Features

* **Shared Runtime Package & Portable Dual Support**:
  - **Shared Runtime (`mkmv-runtime`)**: Install the 120MB Electron runtime once in `ports/`, and share it across dozens of games—saving gigabytes of SD card storage!
  - **Portable Package**: Classic all-in-one standalone package for single-game setups.
  - **Clean UI & No Dummy Entries**: Packaged `template.zip` prevents EmulationStation ports list pollution.
* **Per-Game Custom Config (`mkmv.json`)**: Seamless per-game overrides for resolution, scaling, fast-forward, and memory limits.
* **Native Hardware Gamepad Mapping**: Fully calibrated 1:1 hardware gamepad mapping for handheld layouts with optional per-game `keymap.gptk` overrides.
* **Robust Wayland / Weston Runtime**: Automatic environment detection and optimized launch pipelines for both KNULLI (Weston Auto Kiosk) and ROCKNIX (Sway).
* **R3 Turbo Fast-Forward & Thermal Throttling Guard**: Toggle 2x speedup with R3 stick click (`▶▶ 2x` on-screen indicator) with a 50% render frame-skip engine to prevent SoC overheating.
* **Atomic Safe-Save Protection**: Hardware-level SD card physical fsync flush, isolated `.bak` backups (`save/.bak/`), and automatic corrupted 0-byte save restoration.
* **Sleep/Resume Audio Recovery**: Automatic WebAudio context recovery ensures sound never freezes after device sleep or standby.
* **Universal CJK Fallback Fonts**: Bundled `Noto Sans CJK KR` auto-injection eliminates missing Korean/Japanese glyphs and tofu (□) characters.
* **Dynamic Performance Profiles & Hardware GPU Acceleration**: Auto-detects device RAM and hardware capability (`auto`, `high`, `medium`, `low`). Automatically activates Mali-G52 hardware WebGL acceleration and balanced V8 heap on capable devices (RG Vita Pro / RK3576), with intelligent thermal CPU frequency capping to prevent overheating on passively cooled handhelds, while maintaining lightweight 128MB low-memory protection and CPU rendering for budget 1GB devices.
* **Dual Engine Support & Unified `game/` Directory**: Seamless execution and hooks supporting both RPG Maker MV and RPG Maker MZ directly inside a single unified `game/` directory (with automatic engine detection and legacy `www/` backwards compatibility).
* **Release & Debug Dual Package Architecture**:
  - **Release Package**: Minified and obfuscated JavaScript bundle (-30% size reduction), stripped comments, and critical-error-only (`error`) logging to minimize SD card wear and eliminate console I/O latency on embedded handhelds.
  - **Debug Package**: Fully unminified source code with original comments preserved, default `debug` logging, and configurable `verbose` mode for granular troubleshooting of keyboard/gamepad events and unicode asset intercepts.

---

## 🚀 Quick Start (For Users)

Download the latest release from the [Releases](https://github.com/eruhoon/mkmv/releases) page:

### Option 1: Shared Runtime (Recommended for Multiple Games)
1. Download **`mkmv-runtime-v*.zip`** (or `mkmv-runtime-debug-v*.zip` for troubleshooting) and extract the **`mkmv-runtime`** folder into `roms/ports/` on your SD card.
2. Unzip `mkmv-runtime/template.zip` and rename the extracted `game.sh` and `game` folder to your game's name (e.g. `RJ00000000.sh` and `RJ00000000`).
3. Place your game files into `RJ00000000/game/` and launch from the Ports menu!

### Option 2: Portable Package (Single Game)
1. Download **`mkmv-portable-v*.zip`**.
2. Copy `mkmv.sh` and `mkmv` folder into `roms/ports/`.
3. Place your game assets into `mkmv/game/` and launch!

> 📖 For detailed game duplication, multi-game setup, and advanced config options, see **[HOW_TO_USE.md](HOW_TO_USE.md)**.

---

## 🛠️ Development & Building (Developer Guide)

This project supports cross-platform automated builds powered by **Node.js (v20+)** and **pnpm**.

### 1. Run Automated Test Suites
```bash
npm test
# or: node scripts/tests/run-all.cjs
```
Runs 10 comprehensive test suites covering audio, font fallback, virtual fs, config, graphics, memory, NW.js shims, logger, and optimizer.

### 2. Build Release and Debug Packages
```bash
# Build both Release & Debug packages
npm run build

# Or build individually
npm run build:release
npm run build:debug
```

* Automatically downloads and caches the official Electron aarch64 runtime.
* Optimizes and obfuscates JavaScript files for Release builds while keeping Debug builds unminified.
* Outputs:
  - `dist/mkmv-runtime-v*.zip` & `dist/mkmv-portable-v*.zip` (Release)
  - `dist/mkmv-runtime-debug-v*.zip` & `dist/mkmv-portable-debug-v*.zip` (Debug)

### 3. Clean Build Artifacts
```bash
npm run clean
```

---

## ⚠️ Disclaimer

* **mkmv** is an unofficial open-source runner/template project and is not affiliated with, endorsed by, or associated with **Gotcha Gotcha Games**, **KADOKAWA**, or the **PortMaster** team.
* This repository does not contain any commercial game data, copyrighted assets, or RPG Maker engine core binaries. It only provides a runtime wrapper for games legitimately owned and provided by the user.

---

## 📄 License

The source code in this repository is distributed under the [MIT License](LICENSE).  
Runtime binaries and dependencies are governed by Electron (MIT) and Chromium open-source licenses.
