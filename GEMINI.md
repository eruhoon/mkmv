# 프로젝트 규칙 (Project Rules)

## 패키지 매니저 규칙
- 이 프로젝트의 기본 패키지 매니저는 **`pnpm`**입니다.
- 패키지 설치(`pnpm install`, `pnpm add`), 스크립트 실행(`pnpm run build`, `pnpm test`) 등 모든 종속성 및 태스크 실행은 `npm` 대신 `pnpm`을 우선 사용합니다.

---

## 버전 관리 및 커밋 규칙 (`Major.Minor.Patch.Revision`)

이 프로젝트는 `Major.Minor.Patch.Revision` (4자리 체계, 예: `v0.3.1.0`) 버전 관리 규칙을 따릅니다.

### 1. 버전 체계 및 트리거

| 자리 | 이름 | 트리거 (올리는 시점) | 하위 버전 리셋 룰 |
| :--- | :--- | :--- | :--- |
| **1 (Major)** | **Major** | 대규모 아키텍처 개편, 하위 호환성 단절 등 | Minor, Patch, Revision ➔ `0` |
| **2 (Minor)** | **Minor** | **새로운 세션 시작 / 핵심 기능 단위 작업** | Patch, Revision ➔ `0` |
| **3 (Patch)** | **Patch** | **사용자가 직접 "커밋해줘"라고 명시적 요청 시** | Revision ➔ `0` |
| **4 (Revision)** | **Revision** | **에이전트(AI)가 자체 판단하여 작업 후 커밋 시** | 다음 Patch/Minor 시 리셋 |

---

### 2. 커밋 메시지 및 분리 규칙

커밋 메시지 제목에는 별도의 `[vX.Y.Z.R]` 태그를 붙이지 않고 Conventional Commits 형식을 깔끔하게 유지합니다.

#### 사용자가 직접 "커밋해줘" 요청 시 (2단계 커밋)
1. **1단계 - 작업 변경 사항 커밋**:
   - 실제 기능/수정 코드 변경 사항만 스테이징하여 커밋합니다.
   - 형식: `<type>: <작업 내용 설명>`
   - 예시: `feat: 게임 패드 입력 매핑 추가`
2. **2단계 - 버전 갱신(버전업) 커밋**:
   - `package.json` 등 메타데이터 파일의 버전을 올리고 해당 파일만 스테이징하여 별도 커밋합니다.
   - 형식: `chore(release): bump version to vX.Y.Z.0` (또는 `chore: bump version to vX.Y.Z.0`)
   - 예시: `chore(release): bump version to v0.3.2.0`

#### 에이전트 자율 작업 커밋 시 (Revision)
- 에이전트가 자체 판단하여 작업 후 커밋할 때는 작업 내용 단위로 1개 커밋으로 진행합니다.
- 형식: `<type>: <작업 내용 설명>`
- 예시: `fix: 버튼 릴리즈 이벤트 누락 수정`

---

### 3. 프로젝트 메타데이터 연동

- `package.json`의 `version` 필드는 버전업 커밋 시 함께 갱신합니다.
