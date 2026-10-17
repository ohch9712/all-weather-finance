# 10. 카드 명세서 업로드와 자동 분류

> 웨이브 3 · 브랜치 `feature/10-ledger-import` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 03(가계부), 04(임포트 엔진)가 develop에 병합된 상태.
> **착수 직전 갱신**: 코디네이터는 디스패치 전에 03·04의 실제 코드(`ledger/service.py`, `imports/registry.py`, `imports/service.py`)와 이 문서를 대조하고, 다른 점을 고친 뒤 디스패치한다.
> **갱신함(2026-10-17, develop `8a5d8f4` 기준)**: 04의 `ImportKind.normalize_row(values)`는 `user_id`를 받지 않고 `commit(db, user_id, rows, CommitContext(job_id, file_name))`은 flush까지만 한다(commit·rollback은 엔진). 03의 기본 지출 카테고리 16개(`ledger_0001`)에 6절 표의 이름이 모두 있다. 이에 맞춰 5·6·7·9절에 중복 키 계산 위치, 같은 파일 안 같은 거래, LLM 얻는 방법, 짧은 영문 키워드, 순액 경계 규칙을 더했다.

## 1. 목표

- 카드사 홈페이지에서 내려받은 이용내역 파일(CSV·XLSX·XLS·HTML)을 04 엔진으로 읽어 가계부에 자동 기록한다.
- PDF·이미지 명세서는 AI(personal 등급, 기본 로컬 Ollama)로 거래를 추출한 뒤 같은 미리보기·저장 흐름에 태운다(사용자 동의 후).
- 가맹점 이름으로 카테고리를 자동 분류한다: 내 규칙 → 기본 키워드 규칙 → LLM 일괄 분류 → "기타 지출".
- 취소 거래를 반영하고, 같은 거래를 두 번 올려도 한 번만 기록한다.
- 사용자가 분류를 고치면 그 가맹점 규칙을 학습한다.

## 2. 범위

### 포함

- `ledger_0002` 마이그레이션, 임포트 종류 `ledger_card` 등록
- 분류 파이프라인, 가맹점 규칙 API, 분류 수정 시 학습
- PDF·이미지 추출 엔드포인트
- 서비스 함수 `import_entries`(17이 사용)
- 요약 계산에 취소 거래 반영(03 코드 수정)
- 화면 `/ledger/import`, `/ledger/import/review`

### 제외

- 카드사별 파일 프리셋: 사용자가 개인정보를 지운 실제 샘플 파일을 `backend/tests/ledger/fixtures/presets/`에 넣어 준 형식만 만든다. 샘플이 없으면 프리셋 없이 동의어·LLM 매핑만 쓴다. **형식을 지어내지 않는다.**
- CODEF 자동 수집: 17

## 3. 소유 파일

- `backend/app/modules/ledger/**`(03 코드 수정 포함)
- `backend/alembic/versions/ledger_0002_*.py`
- `backend/tests/ledger/**`
- `frontend/src/app/(app)/ledger/import/**`(자리표시 교체·신규)
- `frontend/src/features/ledger/**`
- `frontend/tests/ledger/**`
- 이 문서의 `## 구현 결과`

## 4. DB 변경 (revision `ledger_0002`, `--head ledger@head`)

- `ledger_entries`에 컬럼 추가: `card_name varchar(50) NULL`, `approval_no varchar(30) NULL`, `is_cancellation boolean NOT NULL DEFAULT false`, `import_batch_id uuid NULL`(임포트 작업 id, FK 없음). 인덱스 `(user_id, import_batch_id)`.
- 새 테이블 `ledger_merchant_rules`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `merchant_key` | `varchar(100)` | NOT NULL. 정규화한 가맹점명 |
| `category_id` | `uuid` | NOT NULL, FK `ledger_categories.id` ON DELETE CASCADE |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

UNIQUE `(user_id, merchant_key)`.

- 가맹점 정규화(`merchant_key`): 앞뒤 공백 제거, 연속 공백 하나로, 영문 대문자, `(주)`·`주식회사`·`㈜` 제거, 끝의 지점·번호 표기(`_강남점`, ` 강남점`, `-123`)는 남긴다(지점별로 다르게 분류하고 싶을 수 있으므로). 비교는 정규화 값끼리 한다.

## 5. 임포트 종류 `ledger_card` (`ledger/import_kind.py`)

`ledger/router.py`가 import될 때 `register_import_kind`로 등록한다.

| key | 라벨 | 타입 | 필수 | 동의어 |
| --- | --- | --- | --- | --- |
| `occurredOn` | 이용일 | date | 예 | 이용일, 이용일자, 이용일시, 거래일, 거래일자, 거래일시, 승인일, 승인일자, 승인일시, 사용일, 사용일자 |
| `merchant` | 가맹점 | text | 예 | 가맹점, 가맹점명, 이용가맹점, 이용하신곳, 이용하신 가맹점, 사용처, 이용처, 상호, 거래처 |
| `amount` | 금액 | amount | 예 | 이용금액, 승인금액, 사용금액, 거래금액, 금액, 결제원금, 매출금액 |
| `status` | 승인/취소 | enum | 아니오 | 상태, 승인구분, 취소여부, 매출구분, 거래구분 (`approved`: 승인, 정상, 매출, 일시불 / `cancelled`: 취소, 승인취소, 매출취소, 부분취소) |
| `cardName` | 카드 | text | 아니오 | 카드명, 카드종류, 이용카드, 카드구분, 카드 |
| `approvalNo` | 승인번호 | text | 아니오 | 승인번호 |
| `installment` | 할부 | text | 아니오 | 할부, 할부개월, 할부기간, 이용구분 |
| `merchantCategory` | 업종 | text | 아니오 | 업종, 가맹점업종, 업종명 |

- `normalize_row`: 금액이 음수이거나 `status=cancelled`면 `is_cancellation=True`, 금액은 절댓값. 금액 0은 오류("금액이 0입니다."). `kind`는 항상 `expense`. 결과는 `LedgerImportRow`(9절)다.
- `dedup_hash` = `sha256("{user_id}|{occurred_on}|{merchant_key}|{amount}|{approval_no or ''}|{is_cancellation}")` 16진수. `normalize_row`에는 `user_id`가 없으므로 `import_entries`(9절)가 계산한다.
  - 같은 호출(한 파일) 안에 위 문자열이 같은 행이 여러 개면, 두 번째부터 문자열 끝에 `|{n}`을 붙인다(n은 1, 2, …, 파일 안 순서대로). 승인번호 없는 파일의 같은 날 같은 금액 거래 두 건(커피 두 잔)을 둘 다 저장하면서, 같은 파일이나 기간이 겹치는 파일을 다시 올리면 같은 키가 나와 중복으로 걸러진다.
- `commit`: `import_entries(db, user_id, rows, source="import", batch_id=ctx.job_id)`를 부른다. 분류(6절) → 삽입(`source='import'`, `payment_method='card'`, `import_batch_id=job_id`) → 같은 `dedup_hash`가 이미 있으면 `skipped_duplicates`. flush까지만 하고 commit·rollback은 04 엔진이 한다(한 트랜잭션).
- `llm_hint`: "한국 신용·체크카드 이용내역 표다. 결제일·결제예정금액 열은 이용일·이용금액이 아니다."

## 6. 카테고리 자동 분류 (`ledger/categorize.py`)

1. 내 규칙: `merchant_key`가 같은 규칙.
2. 기본 키워드 규칙(`ledger/category_rules.py`, 데이터): 가맹점명에 키워드가 들어 있으면 해당 기본 카테고리. 위에서부터 첫 일치.

| 카테고리 | 키워드(대소문자 무시) |
| --- | --- |
| 카페·간식 | 스타벅스, 투썸, 이디야, 메가커피, 메가MGC, 컴포즈, 빽다방, 할리스, 폴바셋, 파리바게뜨, 뚜레쥬르, 배스킨, 던킨, 카페, 커피 |
| 식비 | 배달의민족, 요기요, 쿠팡이츠, 맥도날드, 버거킹, 롯데리아, 맘스터치, 김밥, 식당, 치킨, 피자 |
| 교통 | 카카오T, 택시, 티머니, 코레일, SRT, 지하철, 버스, 주유, SK에너지, GS칼텍스, S-OIL, 현대오일뱅크, 하이패스, 주차 |
| 통신 | SKT, SK텔레콤, KT, LGU+, LG유플러스, 알뜰폰 |
| 주거·관리비 | 관리비, 도시가스, 한국전력, 한전, 수도요금 |
| 의료·건강 | 병원, 의원, 약국, 치과, 한의원, 안과, 피부과 |
| 문화·여가 | CGV, 롯데시네마, 메가박스, 넷플릭스, 유튜브, 멜론, 스포티파이, 디즈니, 왓챠, 티빙, 웨이브 |
| 여행 | 대한항공, 아시아나, 제주항공, 진에어, 티웨이, 호텔, 에어비앤비, 야놀자, 여기어때, 아고다 |
| 교육 | 학원, 교보문고, YES24, 알라딘, 클래스101, 인프런 |
| 보험 | 보험, 생명, 화재, 손해보험 |
| 세금·공과금 | 국세, 지방세, 과태료, 범칙금 |
| 금융·수수료 | 수수료, 연회비 |
| 생활용품 | 다이소, 올리브영, 이마트, 홈플러스, 롯데마트, 코스트코, 편의점, GS25, CU, 세븐일레븐, 이마트24 |
| 쇼핑 | 쿠팡, 11번가, G마켓, 지마켓, 옥션, 무신사, SSG, 네이버페이, 카카오페이, 위메프, 티몬, 29CM |

- 영문·숫자로만 된 3자 이하 키워드(`KT`, `CU`, `SKT`, `SRT`, `CGV`, `SSG` 등)는 앞뒤가 영문·숫자가 아닐 때만 일치로 본다(`CU 강남점`은 일치, `CUCKOO`는 불일치). 나머지 키워드는 포함 여부로 본다.

3. LLM 일괄 분류: 1·2로 정하지 못한 **서로 다른 가맹점**을 최대 200개씩 묶어 `llm.generate(task="ledger.categorize", system=…, content=JSON, output=CategorizeOutput)`(personal 등급, effort·max_tokens는 작업 등록부). `content` = `{"categories": [지출 카테고리 이름들], "merchants": [{"merchant": "…", "merchantCategory": "업종" | null}]}`(금액·카드번호·승인번호는 보내지 않는다). 출력 `{"items": [{"merchant": "…", "category": "식비" | null}]}`. 모르는 이름·null은 4로.
4. "기타 지출".

- LLM이 꺼져 있거나 오류면 3을 건너뛴다. 저장은 실패시키지 않는다.
- 04의 `commit` 콜백과 `import_entries`에는 LLM 인자가 없다. 분류 모듈이 `app.integrations.llm.deps.get_structured_llm()`을 직접 불러 얻는다(04의 `create_job_from_table`과 같은 방식). 테스트는 이 호출을 monkeypatch로 `FakeStructuredLLM`으로 바꾼다.

### 6.1 규칙 학습

- `PATCH /api/ledger/entries/{id}`로 `source`가 `import`·`codef`인 내역의 카테고리를 바꾸면 그 가맹점의 내 규칙을 upsert한다(가맹점이 비어 있으면 건너뛴다). 규칙의 카테고리는 지출 카테고리만 된다(아니면 03과 같은 `categoryId` `422`).
- `POST /api/ledger/merchant-rules` `{"merchant": "김밥천국 강남점", "categoryId": "…", "applyToExisting": true}` → 규칙 upsert, `applyToExisting`이면 같은 `merchant_key`의 내 내역 중 `source`가 `import`·`codef`인 것을 모두 그 카테고리로 바꾸고 바뀐 개수를 돌려준다(수동 입력 내역은 바꾸지 않는다).
- 규칙의 카테고리가 지워지면(03의 내 카테고리 삭제) 규칙도 함께 지워진다(FK `ON DELETE CASCADE`). `GET /api/ledger/merchant-rules`, `DELETE /api/ledger/merchant-rules/{id}`.

### 6.2 가져오기 묶음 조회

- 03의 `GET /api/ledger/entries`에 `importBatchId` 쿼리 필터를 추가한다. 이 값이 있으면 `month` 기본값을 적용하지 않고 그 묶음의 내역만 돌려준다.
- `Entry` 응답에 `cardName`, `approvalNo`, `isCancellation`, `importBatchId`를 더한다.
- 리뷰 화면(10절)과 17의 "가계부에서 보기" 링크가 이 필터를 쓴다. 17은 CODEF 동기화 id를 묶음 id로 넘긴다.

## 7. 요약 계산 변경

- 지출 합계·카테고리별·일별·상위 사용처는 `is_cancellation=false` 금액 합에서 `is_cancellation=true` 금액 합을 뺀 순액이다. 수입은 영향 없다. 추이(`GET /api/ledger/trend`)의 월 지출도 같은 순액이다.
- 지난달 결제를 이번 달에 취소하면 순액이 음수가 될 수 있다. 경계 규칙:
  - 지출 합계와 일별 지출은 0 미만이면 0으로 둔다.
  - 카테고리별·상위 사용처에는 순액이 0보다 큰 항목만 넣는다. 카테고리 비율의 분모는 표에 넣은 지출 카테고리 금액의 합이다(0으로 나누지 않는다).
  - 상위 사용처의 `count`는 취소가 아닌 내역의 건수다.
- 03의 테스트는 그대로 통과해야 하고, 취소 거래 테스트(같은 달 취소, 지난달 결제의 이번 달 취소)를 더한다.

## 8. PDF·이미지 추출

- `POST /api/ledger/import/extract`(multipart): `file`(PDF 10MB·20쪽 이하, PNG·JPEG 5MB 이하), `consent=true`(없으면 `422`, `field: "consent"`, "AI로 처리하는 데 동의해 주세요."). PDF 쪽 수는 `pypdfium2`로 센다. personal 등급이 꺼져 있으면(`llm.enabled_for("ledger.extract_statement")`가 거짓) `503 LLM_UNAVAILABLE`.
- 호출: `llm.generate(task="ledger.extract_statement", system=…, content=[DocumentPart(data) 또는 ImagePart(data, mime_type), TextPart(지시)], output=ExtractOutput)`(architecture 9.1.3의 Part 타입, 파일 부분을 텍스트보다 앞에 둔다). 공급자별 변환(Gemini 문서·이미지 입력, Ollama는 PDF 쪽을 PNG로 바꿔 이미지로 보냄)은 01a 계층이 한다.
- `ExtractOutput`: `{"transactions": [{"occurredOn": "YYYY-MM-DD", "merchant": str, "amount": int, "isCancellation": bool, "cardName": str | null, "approvalNo": str | null}], "warnings": [str]}`.
- 추출 결과를 04의 `create_job_from_table(db, user_id, kind_key="ledger_card", file_name=…, header=["이용일", "가맹점", "금액", "상태", "카드", "승인번호"], rows=[…])`로 임포트 작업으로 만든다. 응답은 04의 `ImportJob`(같은 매핑·미리보기·커밋 흐름을 그대로 쓴다).
- 파일은 저장하지 않는다. 용량 초과는 `413 IMPORT_FILE_TOO_LARGE`, 20쪽 초과는 `422`(`field: "file"`, "20쪽 이하의 명세서만 올릴 수 있습니다."), 그 밖의 형식은 `415 IMPORT_FILE_UNSUPPORTED`.

## 9. 다른 모듈용 서비스 함수

```python
# app/modules/ledger/service.py (추가)
@dataclass(frozen=True)
class LedgerImportRow:
    occurred_on: date
    merchant: str
    amount: int                  # 양수
    is_cancellation: bool
    card_name: str | None = None
    approval_no: str | None = None
    merchant_category: str | None = None

def import_entries(db, user_id, rows: list[LedgerImportRow], *, source: Literal["import", "codef"], batch_id: UUID | None = None) -> ImportResult
```

- 분류·중복 제거·삽입을 한다. `ImportResult`는 04의 타입(`app.modules.imports.registry`)이고, `errors`의 `row_number`는 `rows`의 1부터 센 순서다. 17이 CODEF 승인내역 저장에 쓴다.
- flush까지만 하고 commit하지 않는다. 04 엔진의 `commit` 콜백(5절)과 17의 동기화가 트랜잭션을 끝낸다.

## 10. 화면 명세

- `/ledger/import`: 탭 두 개
  - "엑셀·CSV 파일": `ImportWizard kind="ledger_card"`. 위에 카드사별 내려받기 안내(카드사 홈페이지 → 이용내역 조회 → 엑셀 저장, 암호 없는 파일로).
  - "PDF·이미지 명세서(AI)": 파일 선택, `AiProviderBadge scope="personal"`와 처리 위치 문구(로컬: "명세서는 이 서버의 로컬 AI(Ollama)가 처리하고 외부로 보내지 않아요. 몇 분 걸릴 수 있어요.", Gemini: "명세서 내용이 Google Gemini로 전송돼요."), "AI로 명세서를 처리하는 데 동의합니다" 체크, 추출 중 표시, 이후 위저드의 매핑 단계부터 이어진다. LLM이 꺼져 있으면 탭 안에 안내.
- 저장 후 `/ledger/import/review?batch=<jobId>`로 이동.
- `/ledger/import/review?batch=<id>`: `GET /api/ledger/entries?importBatchId=<id>`로 이번에 가져온 내역을 카테고리별로 묶어 보여 준다(취소 거래 표시). 행마다 카테고리 선택(바꾸면 규칙 학습), "같은 가맹점 모두 바꾸기" 체크. 임포트 작업이 아직 남아 있으면(24시간 안) 위에 저장·중복·실패 수를 보여 준다.

## 11. 테스트

### 백엔드

- 가짜 카드 이용내역 파일 4종(CSV, XLSX, HTML형 xls, 취소·합계 행 포함)으로 업로드 → 매핑(동의어) → 커밋 → 내역·분류·중복 확인
- 같은 파일 두 번 업로드 시 두 번째는 전부 `skipped_duplicates`
- 분류 우선순위(내 규칙 > 키워드 > LLM > 기타), LLM 입력에 금액·승인번호가 없음, LLM 꺼짐
- 규칙 학습(PATCH, merchant-rules `applyToExisting`), 남의 규칙 404
- 요약 순액 계산(취소 포함), 03 테스트 회귀 없음
- PDF 추출: `FakeStructuredLLM`으로 결과를 정해 작업 생성까지, 동의 없음 422, 용량 초과 413
- `import_entries` 직접 호출(17 시나리오)

### 프론트

- 두 탭 흐름(MSW), 리뷰 화면의 카테고리 변경·일괄 변경

## 12. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 가짜 카드 파일로 업로드 → 리뷰 → 가계부 요약 반영까지 실제 서버로 동작한다
- [ ] 프리셋을 만들었다면 그 근거 샘플 파일이 테스트 픽스처에 있다(없으면 프리셋 없음)

## 13. 검증 체크리스트

1. 5절 필드·동의어·중복 키 공식이 같다.
2. LLM 호출 두 종이 작업 키 `ledger.categorize`·`ledger.extract_statement`로 architecture 9.1 계층을 거친다. 분류 입력에 개인 식별 숫자가 없다. 동의 문구가 실제 처리 위치(로컬·Gemini)와 같다.
3. 근거 샘플 없는 카드사 프리셋이 없다.
4. 취소 거래가 요약에서 순액으로 계산된다.
5. `import_entries` 시그니처가 9절과 같다(17의 전제).
6. 업로드·추출 파일이 저장되지 않는다.
7. 사용자 격리 404.

## 구현 결과

### 구현한 것

- `ledger_0002`에 카드명·승인번호·취소 여부·가져오기 묶음 컬럼, 사용자별 가맹점 규칙과 카테고리 삭제 연쇄 처리를 추가했다.
- `ledger_card`를 5절의 전체 필드·동의어로 등록했다. 금액 부호와 취소 상태를 정규화하고, 한 파일 안 동일 거래에는 순번을 붙인다. 사용자별 SHA-256 키와 DB 중복 제약으로 재업로드를 걸러낸다.
- 내 규칙 → 기본 키워드 → personal LLM(서로 다른 가맹점 최대 200개씩) → 기타 지출 순서로 분류한다. 분류 입력에는 가맹점·업종·카테고리 이름만 포함하며 금액·카드 정보·승인번호를 넣지 않는다. AI 오류는 저장을 중단하지 않는다.
- 규칙 조회·저장·삭제, 카테고리 수정 시 학습, 기존 import·codef 내역 일괄 적용, `importBatchId` 필터와 공개 `import_entries` 함수를 구현했다. 저장 콜백은 flush까지만 수행한다.
- 취소를 뺀 월·일·카테고리·사용처·추이를 계산한다. 음수 경계와 카테고리 비율 분모는 7절을 따른다. 기존 가계부 목록에도 취소 배지·환입 부호와 날짜별 순액을 반영했다.
- PDF·PNG·JPEG는 메모리 multipart 파서로 읽는다. 파일을 디스크에 저장하지 않고 동의·형식·용량·PDF 쪽 수를 검사한 뒤 personal 작업 키로 추출해 공용 임포트 작업을 만든다.
- 파일/AI 두 탭, 개인 AI 상태에 맞춘 처리 위치·동의·고지, 추출 결과 매핑·미리보기·오류 제외 저장, 카테고리별 리뷰와 같은 가맹점 일괄 변경을 구현했다.

### 스펙과 다른 점과 이유

- 04 `ImportWizard`에는 기존 `ImportJob`을 받아 매핑 단계부터 시작하는 prop이 없다. 코디네이터 승인에 따라 일반 파일 탭은 공개 `ImportWizard`를 사용하고, 추출 탭 전용 연결 컴포넌트를 10 소유 경로에 만들었다. 04의 내부 hooks·API·컴포넌트는 import하지 않고, 공개 타입과 HTTP 계약을 10의 `api.ts`·`hooks.ts`에서 사용한다. 04 파일은 수정하지 않았다.
- 가맹점 규칙 저장 응답은 규칙 필드와 `updatedCount`를 반환한다. 변경 개수는 카테고리가 실제로 바뀐 기존 내역 수다.
- 실제 카드사 샘플이 없어 프리셋을 만들지 않았다. 테스트 파일은 범용 헤더로 직접 생성한 CSV·XLSX·HTML형 XLS·취소/합계 포함 CSV이며 실제 카드사 형식으로 표시하지 않는다.

### 검증 결과

- `scripts/worktree-setup.sh` 성공: 슬롯 10, 백엔드 8010, 프론트 3010, DB `finance_10`.
- 백엔드 `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest -q`(1,047개) 통과. 분류 우선순위·입력 최소화·AI 오류/꺼짐·200개 묶음, 규칙 학습·사용자 격리 404, 동일 파일 재업로드·중복 키, 취소 경계·0원 오류, FakeStructuredLLM 추출·동의·용량·쪽 수·형식 검증을 포함한다.
- 별도 빈 DB `finance_10_verify`에서 `uv run alembic upgrade heads` → `uv run alembic downgrade base` → `uv run alembic upgrade heads` 성공 후 DB를 삭제했다.
- 프론트 `npm run lint`, `npx tsc --noEmit`, `npm run test`(357개), `npm run build` 통과. MSW로 두 탭의 저장·리뷰 이동, 로컬/Gemini/꺼짐 상태, 만료 안내, 단건·일괄 분류 수정을 확인했다.
- 독립 Playwright `ledger10` 세션에서 실제 서버에 범용 CSV 업로드 → 자동 매핑 → 정상 4행 미리보기 → 저장 4건 → 리뷰 → 지출 순액 16,000원 반영을 확인했다. 같은 파일 재업로드는 중복 4건, 같은 가맹점 3건 일괄 변경도 확인했다.
- 360px 업로드·리뷰·AI 꺼짐 화면 및 1280px 리뷰·AI 탭의 문서 너비가 뷰포트 너비와 같았다. 360px 리뷰 스크린샷도 확인했다.
- 실제 외부 API·LLM은 호출하지 않았다. 서버는 `scripts/stop.sh`, 독립 브라우저는 세션 close로 종료했다.
- 브라우저 저장 요청과 테스트 정리 DELETE가 겹친 실행에서 DB 잠금 충돌이 한 번 발생했다. 서버·브라우저를 종료하고 백엔드 전체 검사를 단독 재실행해 1,047개 통과를 확인했다.

### 참고 사항

- 일반 파일 탭 저장 직후 04의 `useCommitImportJob`이 미리보기 쿼리를 무효화하면서 이미 저장된 작업의 preview 요청이 409를 반환하는 배경 콘솔 오류를 관찰했다. 저장과 리뷰 이동은 정상이다. 04 소유 코드여서 수정하지 않았으며 코디네이터에게 알렸다.

### 남은 일

- 구현 범위의 남은 일은 없다. 코디네이터의 별도 검증과 병합이 남았다.
- 실제 카드사별 프리셋은 개인정보를 지운 사용자 샘플이 제공된 뒤 별도 작업으로 추가한다.
