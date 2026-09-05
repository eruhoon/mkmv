# 🎮 RPG Maker MV 포트마스터 템플릿 사용 가이드 (ROCKNIX / ARM64)

이 패키지는 Anbernic 기기(ROCKNIX)에서 **모든 RPG Maker MV 게임을 단 몇 번의 복사만으로 손쉽게 추가/증식**할 수 있도록 모든 필수 런타임, 키 매핑, 플러그인 호환성 레이어가 완벽히 패키징된 **순정 템플릿(Master Template)**입니다.

---

## 📁 템플릿 폴더 구조

```text
d:\workspace\mkxp-mv\
├── mkmv.sh                         # 범용 런처 스크립트 (자동 폴더 매칭 지원)
├── HOW_TO_USE.md                   # 본 사용 설명서
└── mkmv/                           # ⭐ 마스터 템플릿 폴더 (필수 런타임 내장)
    ├── electron                    # aarch64 실행 바이너리
    ├── main.js                     # 창/디스플레이 관리 스크립트
    ├── preload.js                  # Anbernic 1:1 실측 패드 매핑 및 NW.js 심
    ├── config.json                 # ⭐ 화면 해상도, 전체화면, 배율 설정
    ├── package.json                # 엔진 설정 매니페스트
    ├── keymap.gptk                 # 포트마스터 표준 키패드 매핑
    ├── fonts/                      # ⭐ Noto Sans CJK KR 자동 폴백 폰트
    ├── port.json                   # 포트마스터 메타데이터
    ├── locales/, resources/...     # 필수 런타임 에셋
    └── www/                        # ⭐ [게임 파일(www)을 넣는 곳]
```

---

## 🚀 새 게임 추가하는 방법 (딱 3단계)

### 1단계. 템플릿 복사 및 이름 변경
새로 넣고 싶은 게임 이름(예: `MyGame`)으로 파일과 폴더를 복제합니다.

1. `mkmv.sh` 파일을 복사하여 **`MyGame.sh`** 로 이름을 바꿉니다.
2. `mkmv` 폴더를 복사하여 **`MyGame`** 으로 이름을 바꿉니다.

> 💡 **스마트 자동 매칭**: 런처 스크립트가 `.sh` 파일명과 동일한 폴더를 자동으로 찾아서 연결하므로, 스크립트 내부를 수정하지 않아도 이름만 같으면 알아서 구동됩니다!

---

### 2단계. 게임 파일(www) 넣기
플레이할 RPG Maker MV 게임의 **`www` 폴더 내용물**을 복제한 폴더의 `www` 안에 넣습니다:

```text
MyGame/
└── www/
    ├── index.html       ← (필수)
    ├── js/              ← (스크립트 및 플러그인)
    ├── data/            ← (맵 및 데이터)
    ├── img/             ← (그래픽/일러스트)
    └── audio/           ← (BGM 및 효과음)
```

---

### 3단계. SD 카드에 복사 후 게임기에서 실행
SD 카드의 **`roms/ports/`** (또는 `ports/`) 경로로 복사합니다:

```text
SD카드:/roms/ports/
├── MyGame.sh
└── MyGame/
```

기기를 켜고 **Ports** 목록에서 `MyGame`을 실행하면 끝납니다!

---

## 🎮 기본 조작키 안내 (Anbernic 닌텐도 표준 배열)

| 기기 버튼 | 기능 / 게임 내 동작 |
|---|---|
| **십자키 (D-Pad) 상/하/좌/우** | 캐릭터 및 메뉴 이동 |
| **아날로그 L-스틱** | 캐릭터 및 메뉴 이동 |
| **A 버튼 (우측)** | **결정 / 대화 / 확인 (`Z`)** |
| **B 버튼 (하단)** | **취소 / 메뉴 / 뒤로가기 (`X`)** |
| **X 버튼 (상단)** | **대시 / 달리기 (`Shift`)** |
| **Y 버튼 (좌측)** | **보조 액션 / 메뉴 (`Space`)** |
| **START** | **시작 / 결정 (`Enter`)** |
| **SELECT** | **메뉴 열기 / 닫기 (`Esc`)** |
| **SELECT + START (길게)** | **⭐ 게임 안전 강제 종료 (메뉴 복귀)** |

---

## 💡 유의사항 및 팁
- **화면 해상도 및 옵션 설정 (`config.json`)**:
  - 기본적으로 기기 디스플레이 해상도를 자동 감지(`autoDetectResolution: true`)합니다.
  - RG VITA Pro(1080p), RG VITA/TrimUI(720p), RG505(544p) 등 기기 특성에 맞춰 수동 제어하고 싶다면 `config.json`을 열어 수정할 수 있습니다:
    ```json
    {
      "width": 1920,
      "height": 1080,
      "fullscreen": true,
      "autoDetectResolution": true,
      "forceDeviceScaleFactor": 1.0,
      "scaling": "fit",
      "pixelated": true,
      "disableGpu": true,
      "hideCursor": false,
      "disableTouch": false,
      "showFps": false,
      "lowMemoryMode": false
    }
    ```
    * `"scaling": "fit"` : 원래 게임 비율(도트 비율)을 유지하며 화면 상하를 꽉 채우고 화면 정중앙에 배치 (기본값)
    * `"scaling": "fill"` : 잘림 없이 화면 전체에 가로/세로를 가득 채움 (풀 스트레칭)
    * `"hideCursor": true` : 화면에서 마우스 커서를 완전히 숨김
    * `"disableTouch": true` : 원치 않는 터치스크린 입력 간섭을 전면 차단
    * `"showFps": true` : 화면 좌상단에 실시간 FPS 및 성능 측정기 표시
    * `"lowMemoryMode": true` : RAM 1GB 기기(KNULLI 등)를 위한 V8 힙 512MB 제한 모드
- **게임 백업**: `mkmv` 마스터 템플릿 폴더를 압축해서 보관해 두시면 언제든 새 게임을 무제한으로 찍어내실 수 있습니다.

