# 🎮 mkmv (RPG Maker MV - PortMaster Runner Template)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build and Release](https://github.com/eruhoon/mkmv/actions/workflows/release.yml/badge.svg)](https://github.com/eruhoon/mkmv/actions/workflows/release.yml)

Anbernic 등 Linux ARM64 핸드헬드 기기(**ROCKNIX**, **KNULLI**, Batocera 등)의 **PortMaster** 환경에서 **RPG Maker MV** 게임을 간편하게 구동 및 추가할 수 있는 공식 마스터 템플릿 패키지입니다.

---

## ✨ 주요 기능

* **1:1 실측 하드웨어 패드 매핑**: Anbernic 표준 배열 및 아날로그 스틱, NW.js 호환 Shim 내장 (`preload.js`).
* **안정적인 Wayland / Weston 런타임**: KNULLI(Weston Auto Kiosk) 및 ROCKNIX(Sway) 환경 자동 감지 및 최적화 구동.
* **R3 터보 배속 & 발열 억제 프레임 스킵**: R3 스틱 클릭으로 2배속 토글 (`▶▶ 2x` 인디케이터), 50% 렌더링 프레임 스킵으로 SoC 과열 방지.
* **세이브 파손 방지 (Atomic Safe-Save)**: SD 카드 물리 fsync 플러시, `.bak` 자동 백업 및 0바이트 손상 세이브 자동 복구 지원.
* **슬립/절전모드 오디오 복구**: 기기 절전 후 복귀 시 사운드가 멈추지 않도록 WebAudio 컨텍스트 자동 복원.
* **한국어/CJK 통합 폴백 폰트**: 번들된 `Noto Sans CJK KR` 자동 등록으로 한글/일어 폰트 누락 및 네모 깨짐 방지.
* **저사양 1GB 기기 메모리 보호**: `lowMemoryMode`를 통한 V8 힙 512MB 제한으로 OOM 크래시 방지.
* **스마트 자동 폴더 매칭**: `.sh` 파일명과 일치하는 게임 폴더를 찾아 별도 스크립트 수정 없이 자동 구동.
* **경량 소스 관리**: 대용량 바이너리는 소스 트리에 포함되지 않으며 `pnpm build` 또는 GitHub Releases를 통해 배포됩니다.

---

## 🚀 빠른 시작 (일반 사용자)

1. [Releases](https://github.com/eruhoon/mkmv/releases) 탭에서 최신 **`mkmv-v0.2.0.zip`** (또는 최신 버전 zip)을 다운로드합니다.
2. 압축을 해제하면 나오는 `mkmv.sh` 파일과 `mkmv` 폴더를 기기 SD카드의 `roms/ports/` 경로에 복사합니다.
3. 플레이할 게임의 `www` 폴더 내용물을 `mkmv/www/` 안에 넣고 기기에서 실행합니다.

> 📖 상세한 게임 복제 및 고급 옵션 설정법은 **[HOW_TO_USE.md](HOW_TO_USE.md)**를 참고하세요.

---

## 🛠️ 개발 및 빌드 (Developer Guide)

이 프로젝트는 **Node.js (v20+)** 및 **pnpm**을 기반으로 크로스 플랫폼 빌드를 지원합니다.

### 1. 패키지 설치
```bash
pnpm install
```

### 2. 빌드 실행
```bash
pnpm run build
```

* 빌드 스크립트가 공식 Electron aarch64 런타임을 자동으로 다운로드하고 캐싱합니다.
* 불필요/충돌 드라이버 라이브러리를 정리하고 템플릿 소스를 병합합니다.
* `dist/mkmv/` 및 완성된 배포본 **`dist/mkmv-v*.zip`**이 생성됩니다.

### 3. 산출물 정리
```bash
pnpm run clean
```

---

## ⚠️ 면책 조항 (Disclaimer)

* 본 프로젝트(`mkmv`)는 비공식(Unofficial) 오픈소스 런너/템플릿 프로젝트이며, **Gotcha Gotcha Games**, **KADOKAWA**, 또는 **PortMaster** 팀과 공식적인 제휴 및 보증 관계가 없습니다.
* 본 저장소에는 어떠한 상용 게임 파일, 저작권 보호 에셋, 또는 알만툴 엔진 본체 파일도 포함되어 있지 않습니다. 사용자가 정당하게 소유한 게임의 실행을 위한 래퍼(Wrapper) 코드만을 제공합니다.

---

## 📄 라이선스 (License)

본 프로젝트의 소스 코드는 [MIT License](LICENSE)에 따라 배포됩니다.  
런타임 바이너리는 Electron(MIT) 및 Chromium 오픈소스 라이선스를 따릅니다.
