# 04. 공통 파일 임포트 엔진

> 웨이브 2 · 브랜치 `feature/04-imports` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 소비자: 10(카드 이용내역 → 가계부), 11(매매내역 → 매매일지).

## 1. 목표

- 표 형태 파일(CSV, XLSX, XLS, HTML로 된 "엑셀 다운로드")을 받아 머리행을 찾고, 열을 목표 필드에 매핑하고, 행을 검증해 미리보기를 보여 준 뒤, 소비 모듈의 저장 함수로 넘기는 공통 흐름을 만든다.
- 매핑은 프리셋 → 동의어 → LLM 추천 → 사용자 수정 순서로 정한다. 사용자가 최종 확인한다.
- 소비 모듈은 "임포트 종류(ImportKind)"를 등록하기만 하면 업로드 화면과 API를 그대로 쓴다.

## 2. 범위

### 포함

- 파일 판별·인코딩 처리·표 읽기, 시트 선택, 머리행 탐지, 합계 행 제외
- 값 변환기(날짜, 금액, 소수, 텍스트, 열거값)
- 임포트 종류 레지스트리와 등록 API
- 매핑 제안(프리셋·동의어·LLM), 매핑 확정, 미리보기, 커밋, 삭제, 만료
- 재사용 UI 컴포넌트 `ImportWizard`
- 테스트용 임포트 종류(테스트 코드 안에서만 등록)

### 제외

| 항목 | 처리 |
| --- | --- |
| 카드 이용내역·매매내역 종류 정의와 저장 로직 | 10, 11 |
| PDF·이미지 명세서 추출 | 10(LLM 추출을 별도 경로로) |
| 암호 걸린 파일 해제 | 범위 밖. `IMPORT_FILE_ENCRYPTED`로 안내 |
| 업로드 페이지(라우트) | 10, 11이 자기 페이지에 위젯을 넣는다 |

## 3. 소유 파일

- `backend/app/modules/imports/**`
- `backend/alembic/versions/imports_0001_*.py`
- `backend/tests/imports/**`(테스트 픽스처 파일 `backend/tests/imports/fixtures/**` 포함)
- `frontend/src/features/imports/**`
- `frontend/tests/imports/**`
- 이 문서의 `## 구현 결과`

## 4. 기술 결정

| 항목 | 결정 |
| --- | --- |
| 파일 저장 | 하지 않는다. 업로드 바이트를 메모리에서 읽고 셀 문자열 표만 `import_jobs.rows`에 둔다 |
| 크기·행 제한 | `IMPORT_MAX_FILE_MB`(기본 10MB), 데이터 행 최대 5,000 |
| 판별 | 확장자보다 내용(매직 바이트)을 우선한다 |
| 읽기 | XLSX `openpyxl`(read_only, data_only), XLS `xlrd`, HTML `pandas.read_html`(lxml), CSV 표준 `csv` |
| 인코딩 | `utf-8-sig` → `cp949` → `charset-normalizer` 추정 순서 |
| 만료 | 생성 후 24시간. 새 작업을 만들 때 만료된 내 작업을 지운다 |
| LLM | `get_structured_llm()`, task `imports.column_mapping`, effort `low`. LLM이 꺼져 있으면 건너뛴다 |

## 5. 레지스트리 (`app/modules/imports/registry.py`)

```python
FieldType = Literal["date", "datetime", "amount", "decimal", "text", "enum"]

@dataclass(frozen=True)
class TargetField:
    key: str                         # camelCase. 예: "occurredOn"
    label: str                       # 화면 표시. 예: "이용일"
    type: FieldType
    required: bool
    synonyms: tuple[str, ...]        # 머리행 동의어. 예: ("이용일", "이용일자", "거래일", "승인일자")
    description: str = ""            # LLM 프롬프트용 설명
    enum_values: dict[str, tuple[str, ...]] | None = None   # type="enum"일 때 값 동의어. 예: {"buy": ("매수", "BUY")}

@dataclass(frozen=True)
class ImportPreset:
    key: str                         # 예: "shinhan_card_xls_v1"
    label: str
    header_signature: tuple[str, ...]   # 이 머리행 셀들이 모두 있으면 일치
    mapping: dict[str, str]          # 목표 필드 key → 머리행 문자열

@dataclass
class RowError:
    row_number: int                  # 원본 파일 기준 1부터
    field: str | None
    message: str

@dataclass
class ImportResult:
    inserted: int
    skipped_duplicates: int
    failed: int
    errors: list[RowError]

@dataclass(frozen=True)
class CommitContext:
    job_id: UUID
    file_name: str

@dataclass(frozen=True)
class ImportKind:
    key: str                         # 예: "ledger_card"
    label: str                       # 예: "카드 이용내역"
    fields: tuple[TargetField, ...]
    normalize_row: Callable[[dict[str, Any]], Any]      # 타입 변환된 값 dict → 도메인 행. 검증 실패는 RowValidationError(field, message)
    commit: Callable[[Session, UUID, list[Any], CommitContext], ImportResult]
    presets: tuple[ImportPreset, ...] = ()
    llm_hint: str = ""

class RowValidationError(Exception):
    def __init__(self, field: str | None, message: str): ...

def register_import_kind(kind: ImportKind) -> None      # 같은 key 재등록은 ValueError
def get_import_kind(key: str) -> ImportKind               # 없으면 AppError 422 VALIDATION_ERROR(field "kind")
def list_import_kinds() -> list[ImportKind]
```

### 5.1 다른 모듈용 서비스 함수 (`app/modules/imports/service.py`)

```python
def create_job_from_table(db, user_id, *, kind_key: str, file_name: str,
                          header: list[str], rows: list[list[str]]) -> ImportJobView
```

- 파일이 아닌 곳에서 이미 표로 만든 데이터(예: 10의 PDF 추출 결과)를 같은 매핑·미리보기·커밋 흐름에 태운다. `header`가 1행, `rows`가 데이터 행인 표로 보고 6.2(머리행은 1행으로 고정)·6.3을 그대로 적용한다. `file_type`은 `csv`로 저장한다. 반환값은 8.2의 `ImportJob`과 같은 모델이다.
- 행 제한(5,000)과 만료 규칙은 파일 업로드와 같다.

- 소비 모듈은 자기 `router.py`가 import될 때 등록되도록 등록 코드를 둔다(예: `ledger/router.py`에서 `from . import import_kind`). 01의 `api/router.py`가 모든 모듈 라우터를 import하므로 앱 시작 시 등록된다.
- 이 작업은 실제 종류를 등록하지 않는다. 테스트는 `tests/imports/conftest.py`에서 `demo` 종류(필드: `date` 필수, `amount` 필수, `title` 필수, `category` 선택 enum)를 등록·해제한다.

## 6. 처리 흐름

### 6.1 파일 읽기

1. 크기 초과 `413 IMPORT_FILE_TOO_LARGE`("파일은 10MB 이하만 올릴 수 있습니다.").
2. 판별
   - `PK\x03\x04`로 시작하고 `[Content_Types].xml`이 있으면 XLSX
   - `D0 CF 11 E0 A1 B1 1A E1`(OLE)이면: `EncryptedPackage` 스트림이 있으면 `422 IMPORT_FILE_ENCRYPTED`("암호가 걸린 파일입니다. 카드사 사이트에서 암호 없이 내려받아 주세요."), 아니면 XLS
   - 앞쪽 공백·BOM 뒤가 `<`이고 `<table`이 있으면 HTML(카드사 "엑셀 다운로드"가 HTML인 경우가 많다)
   - 그 밖의 텍스트는 CSV(구분자는 `,`, `\t`, `;` 중 첫 5줄에서 가장 일관된 것)
   - 그 외(PDF, 이미지 등) `415 IMPORT_FILE_UNSUPPORTED`("CSV, XLSX, XLS 파일만 올릴 수 있습니다.")
3. 시트·표를 "셀 문자열의 2차원 배열"로 바꾼다. 날짜 셀은 `YYYY-MM-DD`(시각이 있으면 `YYYY-MM-DD HH:MM:SS`), 숫자 셀은 지수 표기 없는 문자열(정수면 소수점 없이). 셀 앞뒤 공백 제거, 줄바꿈은 공백으로.
4. 여러 시트(또는 HTML 표 여러 개)면 `sheetName`(요청값)을 쓰고, 없으면 머리행 점수가 가장 높은 시트를 고른다.

### 6.2 머리행 탐지

- 정규화: 공백·괄호·`*`·`:` 제거, 소문자.
- 처음 30행 각각에 대해 점수 = 목표 필드 동의어와 일치(정규화 후 같거나 셀이 동의어를 포함)하는 셀 수. 최고 점수 행(동점이면 위쪽)이 2점 이상이면 머리행이다.
- 2점 미만이고 LLM이 켜져 있으면 6.4 LLM 매핑을 처음 15행으로 실행해 `headerRow`도 함께 받는다. 그래도 없으면 `422 IMPORT_HEADER_NOT_FOUND`("표의 제목 행을 찾지 못했습니다. 파일 형식을 확인해 주세요.").
- 머리행 아래의 행이 데이터다. 모든 셀이 빈 행은 버린다. 어떤 셀이 "합계", "총계", "소계", "합 계"로 시작하는 행은 `skippedRows`로 센다. 데이터 행이 5,000개를 넘으면 `422 VALIDATION_ERROR`(`field: "file"`, "한 번에 5,000행까지 올릴 수 있습니다.").

### 6.3 매핑 제안 (`mappingSource`)

1. `preset`: 종류의 프리셋 중 `header_signature`가 모두 머리행에 있는 첫 프리셋.
2. `synonym`: 목표 필드마다 동의어와 일치하는 첫 열(이미 다른 필드에 쓴 열은 제외).
3. `llm`: 필수 필드가 하나라도 비었고 LLM이 켜져 있으면 6.4로 추천받아 빈 필드만 채운다.
4. 필수 필드가 여전히 비면 그대로 둔다. 사용자가 화면에서 정한다(확정하면 `user`).

### 6.4 LLM 컬럼 매핑

- 호출: `llm.generate(task="imports.column_mapping", system=SYSTEM, content=<JSON 문자열>, output=ColumnMappingOutput, effort="low", max_tokens=4000)`
- `SYSTEM`(고정 문자열): 표의 머리행과 예시 값을 보고 각 목표 필드에 맞는 열 번호를 고르는 역할, 확실하지 않으면 `null`, 한 열을 두 필드에 쓰지 않음, 종류 설명(`llm_hint`).
- `content`: `{"kind": "...", "fields": [{"key", "label", "type", "required", "description"}], "headerRowCandidates": [...] | null, "header": [...], "samples": [[...], [...], [...]]}`. 예시는 3행까지만 보낸다. 8자리 이상 연속 숫자는 앞 2자리·뒤 2자리만 남기고 `*`로 가린다(카드번호·승인번호 보호).
- `ColumnMappingOutput`: `{"headerRow": int | null, "mappings": [{"field": str, "columnIndex": int | null, "reason": str}]}`. 범위 밖 열 번호, 모르는 필드, 중복 열은 버린다.
- LLM 오류(`LLM_UNAVAILABLE`, `LLM_REFUSED`)는 업로드를 실패시키지 않는다. `mappingSource`를 `synonym`으로 두고 `warnings`에 "AI 매핑 추천을 쓰지 못했습니다."를 넣는다.

### 6.5 값 변환 (`app/modules/imports/converters.py`, 소비 모듈도 사용 가능)

| 타입 | 받는 형식 | 결과 |
| --- | --- | --- |
| `date` | `2026-10-16`, `2026.10.16`, `2026/10/16`, `20261016`, `26.10.16`, `2026-10-16 13:45:00`(날짜만 사용), 엑셀 일련번호(20000~80000 정수) | `date` |
| `datetime` | 위 형식 + `HH:MM`, `HH:MM:SS` | KST로 해석한 aware `datetime` |
| `amount` | `12,000`, `12000원`, `₩12,000`, `-12,000`, `(12,000)`(음수), `12,000-`(음수), `1.2E+4` | `int`(원) |
| `decimal` | 쉼표 제거 후 `Decimal` | `Decimal` |
| `text` | 앞뒤 공백 제거, 연속 공백 하나로, 빈 문자열은 `None` | `str \| None` |
| `enum` | `enum_values`의 동의어와 정규화 비교 | 키 문자열 |

- 변환 실패는 `RowError(field=key, message="날짜 형식이 아닙니다." / "금액 형식이 아닙니다." / "알 수 없는 값입니다.")`.
- 필수 필드가 비면 `RowError(field=key, message="필수 값이 비었습니다.")`.

## 7. DB 스키마 (revision `imports_0001`, `branch_labels=("imports",)`)

### `import_jobs`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `kind` | `varchar(32)` | NOT NULL |
| `status` | `varchar(12)` | NOT NULL, CHECK `parsed, mapped, committed` |
| `file_name` | `varchar(255)` | NOT NULL |
| `file_type` | `varchar(8)` | NOT NULL, CHECK `csv, xlsx, xls, html` |
| `sheet_names` | `jsonb` | NOT NULL, default `[]` |
| `sheet_name` | `varchar(100)` | NULL |
| `header_row` | `integer` | NOT NULL. 원본 기준 1부터 |
| `columns` | `jsonb` | NOT NULL. `[{"index": 0, "header": "이용일", "samples": ["2026-10-01", ...]}]` 예시 3개 |
| `rows` | `jsonb` | NOT NULL. `[{"rowNumber": 5, "cells": ["...", ...]}]`. 커밋하면 `[]` |
| `skipped_row_count` | `integer` | NOT NULL, default 0 |
| `mapping` | `jsonb` | NOT NULL. `{"occurredOn": 0, "amount": 3, "memo": null}` |
| `mapping_source` | `varchar(8)` | NOT NULL, CHECK `preset, synonym, llm, user` |
| `warnings` | `jsonb` | NOT NULL, default `[]` |
| `result` | `jsonb` | NULL. 커밋 결과 |
| `expires_at` | `timestamptz` | NOT NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id, created_at desc)`, `(expires_at)`.

## 8. API 계약 (모두 인증 필요)

### 8.1 `GET /api/imports/kinds`

- `200 {"items": [{"key": "ledger_card", "label": "카드 이용내역", "fields": [{"key", "label", "type", "required"}], "presets": [{"key", "label"}]}]}`

### 8.2 `POST /api/imports/jobs` (multipart/form-data)

- 필드: `kind`(필수), `file`(필수), `sheetName`(선택)
- 성공 `201 ImportJob`

```json
{
  "id": "…", "kind": "ledger_card", "status": "parsed",
  "fileName": "2026-10_카드이용내역.xls", "fileType": "html",
  "sheetNames": ["Sheet1"], "sheetName": "Sheet1", "headerRow": 3,
  "columns": [ { "index": 0, "header": "이용일", "samples": ["2026-10-01", "2026-10-01", "2026-10-02"] } ],
  "fields": [ { "key": "occurredOn", "label": "이용일", "type": "date", "required": true } ],
  "mapping": { "occurredOn": 0, "merchant": 2, "amount": 4 },
  "mappingSource": "synonym",
  "presetKey": null,
  "rowCount": 132, "skippedRowCount": 1,
  "warnings": [],
  "expiresAt": "2026-10-17T03:21:45Z",
  "preview": null,
  "result": null
}
```

- 실패: `413`, `415`, `422 IMPORT_FILE_ENCRYPTED`, `422 IMPORT_HEADER_NOT_FOUND`, `422 VALIDATION_ERROR`(kind 없음 등)

### 8.3 `GET /api/imports/jobs/{id}`

- `200 ImportJob`. 남의 작업·없는 id `404`, 만료 `410 IMPORT_JOB_EXPIRED`("업로드한 지 24시간이 지났습니다. 파일을 다시 올려 주세요.").

### 8.4 `PUT /api/imports/jobs/{id}/mapping`

- 요청: `{"mapping": {"occurredOn": 0, "merchant": 2, "amount": 4, "memo": null}}`
- 모든 필수 필드가 매핑돼야 하고, 열 번호는 범위 안, 한 열은 한 필드에만 쓴다(어기면 `422`, `field`는 필드 key).
- 성공 `200 ImportJob`(`status: "mapped"`, `mappingSource: "user"`(제안과 같으면 원래 값 유지), `preview` 채움)

```json
"preview": {
  "validCount": 130, "invalidCount": 2,
  "rows": [ { "rowNumber": 4, "values": { "occurredOn": "2026-10-01", "amount": 12000, "merchant": "김밥천국" }, "errors": [] } ],
  "page": 1, "pageSize": 50, "total": 132
}
```

- `preview.rows[].values`는 6.5 변환 후 값을 JSON으로(날짜는 문자열, Decimal은 문자열)

### 8.5 `GET /api/imports/jobs/{id}/preview?page=1&pageSize=50&onlyInvalid=false`

- 매핑 확정 후에만. 전에는 `409 CONFLICT`("열 매핑을 먼저 확정해 주세요."). 응답은 8.4의 `preview` 객체.

### 8.6 `POST /api/imports/jobs/{id}/commit`

- 요청: `{"skipInvalid": true}`. `false`인데 오류 행이 있으면 `422 VALIDATION_ERROR`(`field: "rows"`, "오류가 있는 행을 고치거나 제외해 주세요.").
- 오류 없는 행을 `normalize_row` → `kind.commit(db, user_id, rows, ctx)`로 넘긴다. 한 트랜잭션이다.
- 성공 `200 ImportJob`(`status: "committed"`, `result: {"inserted": 128, "skippedDuplicates": 2, "failed": 2, "errors": [{"rowNumber": 9, "field": "amount", "message": "..."}]}`, `errors`는 최대 100개). `rows`는 비운다.
- 이미 커밋한 작업은 `409 CONFLICT`("이미 저장한 업로드입니다.").

### 8.7 `DELETE /api/imports/jobs/{id}`

- `204`.

## 9. 프론트 컴포넌트 (`features/imports/`)

```tsx
<ImportWizard
  kind="ledger_card"
  title="카드 이용내역 가져오기"
  description="카드사 홈페이지에서 내려받은 이용내역 파일을 올려 주세요."
  onCommitted={(job) => ...}
/>
```

- 단계: ① 파일 선택(끌어 놓기 + 버튼, `.csv,.xlsx,.xls,.html,.htm`) → ② 열 매핑(목표 필드별 열 선택 `Select`, 각 열의 예시 값 표시, 필수 표시, `mappingSource` 배지 "자동 인식"/"AI 추천"/"직접 지정"/"알려진 형식") → ③ 미리보기(정상·오류 수, 오류 행 강조와 메시지, "오류 행 제외하고 저장" 토글) → ④ 결과(저장·중복·실패 수, `onCommitted` 호출).
- 시트가 여러 개면 ①에서 시트 선택을 보여 준다(다시 업로드).
- 업로드 진행 표시, 만료(410) 시 처음으로 돌아가는 안내.
- `api.ts`: `listImportKinds`, `createImportJob(kind, file, sheetName?)`(FormData, `apiFetch`는 FormData일 때 Content-Type을 넣지 않는다), `getImportJob`, `updateMapping`, `getPreview`, `commitImportJob`, `deleteImportJob`. `hooks.ts`에 대응 훅.

## 10. 테스트

### 백엔드 (`backend/tests/imports/`)

- 픽스처 파일(직접 만든 가짜 데이터, 실제 개인정보 없음): UTF-8 CSV, CP949 CSV, 탭 구분 CSV, XLSX(앞쪽 안내 행 2줄 + 머리행 + 합계 행), XLS, HTML 표, 암호화 OOXML 흉내(OLE + `EncryptedPackage`), PDF 바이트
- 판별·인코딩·시트 선택·머리행 탐지·합계 행 제외·5,000행 제한
- 값 변환기 6.5 표의 모든 입력
- 매핑 제안 순서(preset > synonym > llm), LLM 응답 정리(범위 밖·중복·모르는 필드 제거), LLM 꺼짐·오류 시 경고
- `FakeStructuredLLM` 호출 내용에 8자리 이상 숫자가 가려져 있다
- API 전체 흐름(업로드 → 매핑 → 미리보기 → 커밋), 커밋 결과 집계, 재커밋 409, 매핑 전 미리보기 409, 만료 410(`freezegun`), 남의 작업 404
- 레지스트리 중복 등록 ValueError
- `create_job_from_table`로 만든 작업이 업로드 작업과 같은 흐름(매핑 → 미리보기 → 커밋)을 탄다

### 프론트 (`frontend/tests/imports/`, MSW)

- 위저드 4단계 진행, 필수 필드 미매핑 시 다음 단계 비활성, 오류 행 표시, 결과 표시, 410 처리

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 테스트용 `demo` 종류로 6종 픽스처 파일이 끝까지 처리된다
- [ ] LLM 없이도(DisabledLLM) 업로드·매핑·커밋이 동작한다
- [ ] 파일 바이트가 디스크와 DB에 남지 않는다

## 12. 검증 체크리스트

1. 5절 레지스트리와 5.1 `create_job_from_table` 시그니처가 문서와 같다(10·11의 전제).
2. 6.1 판별 순서와 에러 코드·문구가 같다. 암호 파일이 `IMPORT_FILE_ENCRYPTED`다.
3. 6.4 LLM 호출이 architecture 9.1 래퍼를 거치고 effort `low`, 예시 3행, 숫자 가림이 지켜진다.
4. 6.5 변환 표의 모든 형식이 테스트돼 있다.
5. 8절 응답 필드·상태 전이(`parsed → mapped → committed`)·에러 코드가 같다.
6. 커밋이 한 트랜잭션이고 실패 시 아무 행도 남지 않는다.
7. 업로드 파일이 임시 파일로도 저장되지 않는다(`tempfile` 사용 금지 확인).

## 13. 다음 단계 연결점

- 10: `ledger_card` 종류(카드 이용내역)를 등록하고, 카드사 프리셋은 실제 샘플이 있을 때만 추가한다.
- 11: `journal_trades` 종류(매매내역)를 등록한다.
