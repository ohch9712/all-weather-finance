# 20. 증권사 자동 동기화

> 웨이브 6 · 브랜치 `feature/20-auto-sync` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 08·11·14·18 병합(develop). 사용자 결정(2026-10-19): 연결된 증권사 계좌의 잔고·체결을 서버가 정해진 시각에 알아서 불러온다. 사용자 키로 서버가 자동 호출하므로 연결마다 화면에서 켜고 끈다(기본 꺼짐).

## 1. 목표

- 증권사 연결(키움·토스)마다 "자동 동기화"를 켜고 끌 수 있게 한다.
- 켜진 연결은 평일 20:30(KST)에 서버 배치가 잔고를 자산 현황에(14), 최근 7일 체결을 매매일지에(11) 반영한다. 지금 있는 수동 버튼과 같은 서비스 함수를 쓰므로 결과도 같다.
- 마지막 자동 동기화 시각·결과를 연결 카드에 보여 준다.

## 2. 범위

### 포함

- `broker_connections` 컬럼 추가(revision `market_0003`), 연결 응답 필드 추가, `PATCH /api/market/connections/{id}`
- 배치 명령 `auto-sync`, `deploy/crontab` 일정 한 줄, README 배치 설명
- journal 공개 함수 `sync_connection_trades` 추가(기존 동기화 로직을 그대로 감싼다)
- `/settings/connections` 연결 카드의 스위치·안내·마지막 결과
- 개인정보 처리방침 5조에 자동 조회 한 문장(19 7절 원안도 코디네이터가 같은 문장으로 갱신했다)

### 제외

- CODEF 커넥터 자동 수집(데모 키 하루 100회 제한), 샘플(Mock) 연결의 자동 동기화
- 사용자가 시각·주기를 고르는 설정, 실패 알림(메일·푸시), 연속 실패 시 자동 끄기

## 3. 소유 파일

- 백엔드: `backend/app/modules/market/{models.py,schemas.py,router.py,service.py,repository.py,jobs.py}`, `backend/alembic/versions/market_0003_auto_sync.py`, `backend/app/modules/journal/service.py`(공개 함수 `sync_connection_trades` 추가만), `backend/tests/market/test_auto_sync.py`(새 파일), `backend/tests/market/test_market.py`(연결 응답 필드 단언을 새 필드에 맞추는 경우만)
- 프론트: `frontend/src/features/market/**`, `frontend/tests/market/**`, `frontend/src/features/privacy/content.ts`(5조 문장 한 줄만), `frontend/tests/privacy/**`(그 문장을 글자 단위로 단언하는 경우만)
- 배포: `deploy/crontab`(한 줄 추가), `deploy/README.md`(7절 배치 설명 문장만)
- 이 문서의 `## 구현 결과`

토스 체결(08 4.4절 주문 단위)은 별도 작업(`feature/08-market-fix-5`)이 `integrations/brokers/toss.py`에서 만든다. 이 작업은 어댑터를 고치지 않고 `client.capabilities`만 본다.

## 4. DB 변경 (revision `market_0003`, `--head market@head`)

`broker_connections`에 추가한다. downgrade는 네 컬럼과 CHECK를 지운다.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `auto_sync` | `boolean` | NOT NULL, server default `false` |
| `last_auto_sync_at` | `timestamptz` | NULL |
| `last_auto_sync_status` | `varchar(8)` | NULL, CHECK `ok, partial, failed`(이름 `last_auto_sync_status`) |
| `last_auto_sync_error_code` | `varchar(40)` | NULL |

## 5. API 계약 (모두 인증 필요)

- `Connection`에 필드를 더한다: `"autoSync": false`, `"lastAutoSyncAt": "…" | null`, `"lastAutoSyncStatus": "ok" | "partial" | "failed" | null`, `"lastAutoSyncErrorCode": "BROKER_AUTH_FAILED" | null`. 기존 필드는 그대로다.
- `PATCH /api/market/connections/{id}`(`require_json`) `{"autoSync": true}` → `200 Connection`
  - `autoSync`는 필수 불리언이고 그 밖의 필드는 받지 않는다(`422`).
  - `provider`가 `mock`이면 `422`(`field: "autoSync"`, "샘플 연결은 자동 동기화를 쓸 수 없습니다.").
  - 연결 `status`는 보지 않는다(확인 전·오류 연결도 켤 수 있고, 배치 결과에 그 오류가 남는다).
  - 끄면 `auto_sync=false`만 바꾸고 `last_auto_sync_*`는 남긴다. 키·계좌 값은 바꾸지 않는다.
  - 남의 연결·없는 id `404`, 미인증 `401`.

## 6. 배치 명령 `auto-sync` (`python -m app.modules.market.jobs auto-sync [--today YYYY-MM-DD]`)

- 대상: `auto_sync = true`이고 `provider`가 `kiwoom`·`toss`인 연결 전부(`created_at` 순). `--today`는 테스트·수동 재실행용이고 기본값은 `today_kst()`다.
- 연결마다 아래 두 단계를 차례로 실행한다. 한 단계가 실패해도 다음 단계와 다음 연결은 계속한다.
  1. 잔고: 연결 클라이언트에 `HOLDINGS`가 있으면 `allocation.service.sync_holdings(db, user_id, connection_id)`(14, 수동 "증권사에서 불러오기"와 같은 함수).
  2. 체결: `EXECUTIONS`가 있으면 `journal.service.sync_connection_trades(db, user_id, connection_id, start=today-6일, end=today)`(11, 수동 동기화와 같은 규칙. 7일로 잡아 서버가 멈췄던 날과 부분 체결 갱신을 메운다).
  - 클라이언트는 `market.service.get_user_broker_client`로 한 번 만든다. 여기서 실패하면(`BROKER_NOT_CONNECTED` 등) 두 단계 모두 실패로 친다.
  - 단계 실패: `AppError`면 그 `code`, 그 밖의 예외면 `INTERNAL_ERROR`. 실패한 단계 뒤에는 `db.rollback()`을 한 뒤 다음 단계로 간다.
- 결과 기록: 실행한 단계가 모두 성공하면 `ok`, 모두 실패하면 `failed`, 섞이면 `partial`. 실행할 단계가 없으면(두 기능 모두 없음) `ok`. `last_auto_sync_error_code`는 첫 실패 단계의 코드(성공이면 NULL), `last_auto_sync_at=now_utc()`. 연결마다 commit한다. 연결 `status`·`last_error_code`(연결 확인 결과)는 바꾸지 않는다.
- 출력: 연결마다 한 줄 `auto-sync <connection id> <status> <error code 또는 ->`, 끝에 `auto-sync done total=N ok=… partial=… failed=…`. 키·토큰·계좌번호·금액·종목·사용자 이메일을 출력하거나 로그에 남기지 않는다(예외는 종류 이름만). 개별 연결 실패로는 종료 코드를 바꾸지 않는다(0). 배치 자체가 실패하면(DB 연결 등) 0이 아닌 코드다.
- 토스 토큰: 배치는 별도 프로세스라 토큰을 새로 받는다. 토스는 재발급하면 이전 토큰이 무효가 되므로 백엔드 프로세스의 캐시 토큰은 다음 요청에서 08 4.4절의 401 재시도로 회복한다. 사용자가 같은 토스 키를 다른 프로그램에서도 쓰면 그 프로그램의 토큰이 끊길 수 있다(화면 안내, 7절).
- 일정(`deploy/crontab`): `30 20 * * 1-5 cd /app && python -m app.modules.market.jobs auto-sync`. 넥스트트레이드 애프터마켓(20:00 종료) 뒤다. 휴장일에도 돌지만 새 체결이 없으면 바뀌는 것이 없다.

## 7. 다른 모듈용 서비스 함수 (architecture 8절에 추가)

```python
# app/modules/journal/service.py  (11, 20)
def sync_connection_trades(db, user_id, connection_id: UUID, start: date, end: date) -> SyncResult
    # POST /api/journal/sync와 같은 검증·중복 판정·갱신·commit. 20의 배치가 사용

# app/modules/allocation/service.py  (14, 20이 사용)
def sync_holdings(db, user_id, connection_id: UUID) -> HoldingSyncResult
    # 기존 함수. POST /api/allocation/holdings/sync와 같다. commit까지 한다
```

## 8. 화면 명세 (`/settings/connections`, 연결 카드)

- 키움·토스 연결 카드에 스위치(`role="switch"`, 이름 "자동 동기화")를 둔다. 샘플 연결에는 두지 않는다.
- 스위치 아래 안내: "평일 오후 8시 30분에 잔고를 자산 현황에, 최근 7일 체결을 매매일지에 반영합니다. 저장된 키로 서버가 조회하며, 끄면 바로 멈춥니다."
- 토스 연결에는 한 줄 더: "같은 토스 키를 다른 프로그램에서도 쓰면, 자동 동기화가 토큰을 새로 받을 때 그 프로그램의 연결이 끊길 수 있습니다."
- 마지막 결과(`lastAutoSyncAt`이 있을 때): "마지막 자동 동기화 10월 19일 20:30 · 성공"(`partial` "일부 실패", `failed` "실패"). 실패·일부 실패면 `lastAutoSyncErrorCode`를 연결 확인 오류와 같은 오류 코드 안내 문구로 보여 준다. 시각은 KST.
- 누르면 `PATCH`, 요청 중에는 스위치를 끄고, 성공하면 연결 목록 쿼리를 무효화한다. 실패하면 카드에 오류 문구를 보여 주고 스위치는 서버 값으로 돌아간다.
- 360px에서 가로로 넘치지 않는다.

## 9. 개인정보 처리방침 문장

`features/privacy/content.ts` 5조 문단을 19 7절(2026-10-19 갱신)과 같게 바꾼다.

> 운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 이용자가 증권사 연결을 등록하면 이용자가 발급한 앱키로 해당 증권사에 잔고·체결 조회를 요청합니다. 이용자가 연결에서 자동 동기화를 켜면 평일 정해진 시각에 서버가 같은 방식으로 자동 조회합니다.

## 10. 테스트

- 백엔드(`test_auto_sync.py`): 마이그레이션 컬럼 기본값, `Connection` 새 필드, `PATCH` 켜기·끄기(끌 때 `last_auto_sync_*` 유지), 샘플 연결 422, 필드 누락·다른 필드·불리언 아님 422, JSON 아님, 남의 연결 404, 미인증 401. 배치: 꺼진 연결·샘플 연결 건너뜀, 두 단계 성공 `ok`, 한 단계 실패 `partial`과 첫 오류 코드, 클라이언트 생성 실패 `failed`, 예상 못 한 예외 `INTERNAL_ERROR`와 다음 연결 계속, `EXECUTIONS`가 없는 클라이언트는 잔고만, 체결 기간이 `--today` 기준 7일, 다른 사용자 데이터에 영향 없음, 출력·로그에 키·계좌번호가 없음, 연결 `status`·`last_error_code`가 그대로. 외부 호출은 respx(`assert_all_mocked`)나 `get_user_broker_client` 가짜 클라이언트로 막는다.
- `sync_connection_trades`가 `POST /api/journal/sync`와 같은 결과(삽입·갱신·변화 없음)를 낸다.
- 프론트(MSW): 스위치 표시 조건(키움·토스만), 켜기·끄기 요청 본문, 요청 중 비활성, 실패 시 되돌림과 오류 문구, 마지막 결과 문구 세 가지와 오류 코드 안내, 토스 안내 줄, 360px.
- `supercronic -test deploy/crontab` 통과.

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목(마이그레이션 순환 포함)
- [ ] 실제 서버(슬롯 20, DB `finance_20`)로 확인한다: 화면에서 키움·토스 연결을 만들고 스위치를 켠 뒤, 저장소 밖 임시 실행기에서 respx(`assert_all_mocked`)로 키움·토스 응답을 고정하고 같은 프로세스에서 `auto-sync` 명령 함수를 `--today`로 실행한다. 연결 카드에 마지막 결과가 보이고, 자산 현황·매매일지에 반영됐는지 본다(연결 `active`가 아니면 `BROKER_NOT_CONNECTED`로 `failed`가 남는 것도 확인)
- [ ] 360·768·1280px에서 `/settings/connections`가 가로로 넘치지 않는다

## 12. 검증 체크리스트

1. 꺼진 연결·샘플 연결은 배치가 건드리지 않는다.
2. 수동 동기화와 같은 함수로 잔고·체결을 반영하고, 같은 기간을 두 번 돌려도 중복이 생기지 않는다.
3. 단계·연결 실패가 서로 번지지 않고 결과가 `ok`·`partial`·`failed`로 남는다.
4. `PATCH` 계약(필드, 422, 404, 401)과 응답 새 필드.
5. 출력·로그·응답에 비밀값·계좌번호·금액이 없다.
6. crontab 일정과 README, 처리방침 5조 문장이 스펙과 같다.
7. 소유 경로 밖 변경 없음, 실제 외부 호출 없음.
