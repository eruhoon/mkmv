# 🎮 RPG Maker MV & MZ 포트마스터 러너 사용 가이드 (ROCKNIX / KNULLI / ARM64)

이 패키지는 Linux ARM64 휴대용 게임기(**ROCKNIX**, **KNULLI**, Batocera 등)에서 **모든 RPG Maker MV 및 MZ 게임을 손쉽게 추가/증식**할 수 있도록 제작된 오픈소스 러너입니다.

mkmv는 사용자의 운용 방식에 따라 **두 가지 배포 패키지**를 제공합니다:
1. **공유 런타임 패키지 (`mkmv-runtime-v*.zip`)** ⭐ **[강력 추천]**: 대용량 런타임 바이너리를 1회만 설치하고 여러 게임이 공유하여 SD 카드 용량을 절약하는 방식
2. **올인원 포터블 패키지 (`mkmv-portable-v*.zip`)**: 게임 하나당 런타임이 통째로 묶여 있는 독립 구동 방식

---

## 🌟 방식 A. 공유 런타임 방식 (권장: 다수 게임 관리 & 용량 절약)

SD 카드의 `ports/` 디렉토리에 **`mkmv-runtime` 폴더를 한 번만 설치**해두면, 게임을 10개, 100개 추가해도 무거운 Electron 바이너리(120MB)가 중복되지 않고 오직 순수 게임 데이터만 유지됩니다.

### 📁 디렉토리 구조 예시

```text
roms/ports/ (또는 ports/)
│
├── mkmv-runtime/                      # 🌟 [공유 런타임] (한 번만 설치, 약 120MB)
│   ├── electron, lib/, conf/, fonts/...
│   ├── main.js, preload.js, mkmv.json, keymap.gptk
│   └── template.zip                   # 📦 [새 게임 생성용 압축 템플릿]
│
├── RJ00000000.sh                      # 🚀 [내 게임 런처] (PortMaster 메뉴에 노출)
└── RJ00000000/                        # 🎮 [내 게임 데이터 폴더] (수십 MB 절약!)
    ├── mkmv.json                      # 게임별 맞춤 설정 (해상도, 배속, 메모리 등)
    ├── keymap.gptk                    # (선택) 특수 조작이 필요한 게임만 개별 오버라이드
    ├── log.txt                        # 게임별 독립 실행 로그
    └── game/ (또는 www/)              # 순수 게임 데이터 (index.html, js, img, audio...)
```

### 🚀 새 게임 추가하는 방법 (딱 3단계)

#### 1단계. 템플릿 압축 해제
`ports/mkmv-runtime/template.zip` 압축 파일을 엽니다.  
(내부 구성: `game.sh`, `game/mkmv.json`, `game/keymap.gptk`, `game/game/`)

#### 2단계. 이름 변경
추출한 파일과 폴더를 원하는 게임명(예: `RJ00000000`)으로 바꿉니다:
- `game.sh` ➔ **`RJ00000000.sh`** 로 변경
- `game` 폴더 ➔ **`RJ00000000`** 으로 변경

> 💡 **스마트 자동 매칭**: 런처 스크립트(`.sh`)가 파일명과 동일한 폴더를 자동으로 찾아서 연결하므로 스크립트 내부를 수정할 필요가 전혀 없습니다!

#### 3단계. 게임 데이터 넣기
엔진 종류에 따라 게임 폴더 안에 게임 에셋을 넣습니다:
- **RPG Maker MV 게임**: 게임 배포본의 **`www` 내용물**을 `RJ00000000/www/` (또는 `game/`)에 넣습니다.
- **RPG Maker MZ 게임**: 게임 배포본의 **루트 내용물**(`index.html`, `js/rmmz_*.js` 등)을 `RJ00000000/game/`에 넣습니다.

이제 기기를 켜고 **Ports** 메뉴에서 `RJ00000000`을 실행하면 끝납니다!

---

## 📦 방식 B. 올인원 포터블 방식 (단일 게임 독립형)

기존 방식 그대로 게임 폴더 하나 안에 바이너리와 게임 데이터를 함께 담아 독립적으로 운용하고 싶을 때 사용합니다.

### 📁 포터블 폴더 구조

```text
roms/ports/
├── MyGame.sh                          # 런처 스크립트
└── MyGame/                            # 독립 게임 폴더
    ├── electron, lib/, conf/, fonts/...
    ├── mkmv.json
    └── www/ (또는 game/)
```

1. `mkmv.sh`를 복사하여 **`MyGame.sh`** 로 변경
2. `mkmv` 폴더를 복사하여 **`MyGame`** 으로 변경
3. `MyGame/www/` 안에 게임 에셋을 넣고 실행

---

## ⚙️ 게임별 맞춤 설정 (`mkmv.json`)

각 게임 폴더 안에 있는 `mkmv.json`을 열어 해상도, 배속, 프레임 레이트, 메모리 절약 모드 등을 게임별로 다르게 세팅할 수 있습니다:

```json
{
  "width": 1920,
  "height": 1080,
  "fullscreen": true,
  "autoDetectResolution": true,
  "forceDeviceScaleFactor": 1.0,
  "scaling": "fit",
  "pixelated": true,
  "hideCursor": false,
  "disableTouch": false,
  "showFps": false,
  "debugKeymap": false,
  "disableNativeGamepad": true,
  "fastForward": true,
  "fastForwardSpeed": 2,
  "performanceProfile": "auto"
}
```

* `"performanceProfile": "auto"` : 기기 사양 및 발열 환경에 따른 렌더링/메모리 프로파일 구성 (`"auto"`, `"high"`, `"medium"`, `"low"`)
  - `"high"` (RG VITA PRO, RK3576 등): Mali-G52 하드웨어 WebGL 가속 활성화, 512MB V8 힙, 60초 주기 유휴 GC, 풀 캐시 적용으로 60 FPS 부드러운 구동
  - `"medium"` (패시브 쿨링 기기 권장 / 1.5GB ~ 2.5GB RAM): 하드웨어 WebGL 가속 활성화, 384MB V8 힙, 45초 주기 유휴 GC, 단일 렌더러 프로세스 제한으로 장시간 플레이 시 발열 및 메모리 누적 방지
  - `"low"` (1GB RAM 이하 기기: H700, RK3326 등): 안정적인 소프트웨어 CPU 렌더링, 128MB V8 힙 제한, 단일 렌더러 프로세스 제약
* `"cpuMaxFreq": 1608000` : (선택사항) 기기 CPU 최대 클럭 상한선(kHz). 팬이 없는 기기에서 발열로 인한 하드웨어 재부팅을 방지하기 위해 1.6GHz로 안전 캡을 씌우며, 게임 종료 시 원래 클럭으로 자동 복구됩니다.
* `"disableGpu": false` : 하드웨어 GPU 가속 강제 활성화 (프로파일 기본값 대신 수동 지정 시 사용)
* `"disableNativeGamepad": true` : PortMaster의 `gptokeyb` 가상 키보드와 브라우저 Gamepad API의 이중 입력 및 버튼 충돌(A버튼이 cancel로 덮어써져 키가 씹히는 문제)을 원천 차단 (기본값: `true`)
* `"debugKeymap": true` : 게임 화면 좌측 상단에 실시간 패드/키보드 입력 디버그 오버레이 표시 (`F10` 단축키로 온오프 토글 가능)
* `"scaling": "fit"` : 원본 도트 종횡비를 유지하며 화면에 꽉 채우고 중앙 배치 (기본값)
* `"scaling": "fill"` : 화면 전체에 빈틈없이 가득 채움 (풀 스트레칭)
* `"showFps": true` : 화면 좌상단에 네이티브 FPS 및 렌더링 성능 오버레이 표시
* `"fastForward": true` : R3(우측 스틱 클릭)로 1배속 ↔ 고속 배속 토글 (발열 방지 프레임 스킵 내장)
* `"fastForwardSpeed": 2` : 배속 배율 (2: 2배속, 3: 3배속)
* `"lowMemoryMode": true` : (레거시 호환) `true` 설정 시 `performanceProfile: "low"`와 동일하게 동작
* `"gameDir": "custom_path"` : (선택사항) 게임 에셋이 특수한 하위 폴더에 있는 경우 수동 지정 가능

---

## 🎮 기본 조작키 안내 (닌텐도 표준 배열)

| 기기 버튼 | 키보드 키 | 기능 / 게임 내 동작 |
|---|---|---|
| **십자키 (D-Pad) 상/하/좌/우** | `화살표 방향키` | 캐릭터 및 메뉴 이동 |
| **아날로그 L-스틱** | `화살표 방향키` | 캐릭터 및 메뉴 이동 |
| **A 버튼 (우측)** | `Z` / `Enter` | **결정 / 대화 / 확인** |
| **B 버튼 (하단)** | `X` / `Esc` | **취소 / 메뉴 / 뒤로가기** |
| **X 버튼 (상단)** | `Shift` | **대시 / 달리기** |
| **Y 버튼 (좌측)** | `Space` | **보조 액션 / 텍스트 스킵** |
| **START** | `Enter` | **시작 / 결정** |
| **SELECT** | `Esc` | **메뉴 열기 / 닫기** |
| **R3 (우측 스틱 클릭)** | `R` / `Tab` | **⏩ 고속 배속 토글 (1배속 ↔ 2배속, CPU 과열 억제 프레임 스킵)** |
| **SELECT + START (길게)** | - | **⭐ 게임 안전 강제 종료 (포트마스터 메뉴 복귀)** |

> 💡 게임별로 특수한 조작 키가 필요하다면, 개별 게임 폴더(`RJ00000000/`) 안에 `keymap.gptk`를 넣어두면 공용 런타임 키맵을 덮어쓰고 해당 게임 전용 키맵이 우선 적용됩니다.

---

## 💡 유의사항 및 내장 기능

1. **세이브 파손 방지 (Atomic Safe-Save) & 백업 자동 복구**
   - 배터리 방전이나 강제 종료 시 세이브 파일이 0바이트로 깨지는 문제를 방지하기 위해, SD 카드 물리 `fsync` 플러시와 `.bak` 안전 백업을 거쳐 원자적으로 기록합니다.
   - 혹시 모를 전원 차단으로 0바이트 세이브가 발생하더라도, 로드 시 `.bak` 내의 직전 정상 세이브를 자동 감지하여 복구합니다.
2. **슬립/절전 모드 오디오 자동 복구**
   - 기기 절전(Sleep) 진입 후 복귀 시 사운드가 먹통이 되는 현상을 막기 위해, 화면 복귀 시 WebAudio 컨텍스트를 자동 재개(`resume`)합니다.
3. **완벽한 캐시 및 데이터 격리**
   - 공유 런타임을 사용하더라도 Chromium 캐시, 세션 데이터, 로컬스토리지, 에러 로그는 각 게임 폴더(`conf/`, `log.txt`) 내부로만 완벽히 격리 저장됩니다.
