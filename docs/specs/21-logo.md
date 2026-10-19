# 21. 로고와 앱 아이콘

> 웨이브 6 · 브랜치 `feature/21-logo` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01b·19 병합(develop). 사용자 결정(2026-10-19): 사용자가 고른 "네온 컬러 분할 링" 그림을 로고로 쓰고 **색은 원본 그대로** 둔다. 원본 파일은 이름만 SVG이고 안에 1254×1254 PNG(약 1MB, ChatGPT 이미지 생성, C2PA 출처 메타데이터 포함)가 통째로 들어 있어 그대로 쓰지 않는다. 같은 모양을 진짜 벡터 SVG로 다시 그리고, 거기서 크기별 아이콘을 만든다.

## 1. 목표

- 브라우저 탭 아이콘(favicon), 홈 화면 아이콘(apple-touch), 화면 안 브랜드 마크를 같은 로고로 바꾼다. 지금 `public/favicon.ico`는 Next.js 기본 아이콘이다.
- 로고 파일은 몇 KB짜리 벡터이고, 원본 PNG·메타데이터는 저장소에 넣지 않는다.

## 2. 범위

### 포함

- 앱 아이콘 SVG(어두운 둥근 사각 타일 + 네 조각 링)와 평면 마크 SVG(타일 없이 링만)
- Next.js 메타데이터 파일 규칙의 `app/icon.svg`, `app/apple-icon.png`(180×180), `app/favicon.ico`(16·32·48)
- 공용 `LogoMark` 컴포넌트와 서비스 이름 옆 표시: 사이드바, 모바일 메뉴 제목, 로그인·가입 화면(auth 레이아웃), `/privacy` 머리

### 제외

- 서비스 이름(`APP_NAME`) 변경, 글자를 넣은 워드마크, PWA manifest, 소셜 공유 이미지(OG), 색 변경

## 3. 소유 파일

- 새 파일: `frontend/src/app/icon.svg`, `frontend/src/app/apple-icon.png`, `frontend/src/app/favicon.ico`, `frontend/public/brand/app-icon.svg`(타일 포함 원본 벡터), `frontend/public/brand/logo-mark.svg`(링만), `frontend/src/components/common/LogoMark.tsx`, `frontend/tests/branding/**`
- 삭제: `frontend/public/favicon.ico`(Next.js 기본 아이콘. `app/favicon.ico`가 대신한다)
- 고침(브랜드 마크 한 줄만): `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/layout/MobileNav.tsx`, `frontend/src/app/(auth)/layout.tsx`, `frontend/src/features/privacy/components/PrivacyPolicy.tsx`
- 기존 테스트가 브랜드 영역 마크업을 단언해 깨지는 경우 그 단언만: `frontend/tests/foundation/**`, `frontend/tests/privacy/**`
- 이 문서의 `## 구현 결과`

의존성을 추가하지 않는다. PNG·ICO를 만드는 임시 스크립트는 저장소 밖에 두고(이미 설치된 `sharp`를 `frontend/node_modules`에서 불러 써도 된다), 만든 결과 파일만 커밋한다.

## 4. 모양 (원본 측정값, 코디네이터가 2026-10-19 원본 PNG에서 쟀다)

원본 경로(저장소 밖, 참고용으로 열어 보기만 한다): `/Users/ochunghwan/Documents/Codex/2026-10-19/new-chat/outputs/neon-ring-original.svg`. 안의 PNG를 꺼내 비교할 때는 저장소 밖 임시 폴더를 쓴다.

원본 1254px 캔버스에서 타일은 x 222~1031, y 229~1015(약 800px)이고 나머지는 투명 여백과 그림자다. 아래 값은 **타일 한 변 = 512**로 바꾼 것이다(`viewBox="0 0 512 512"`, 여백 없이 타일이 캔버스를 채운다).

| 요소 | 값 |
| --- | --- |
| 타일 | 0,0~512,512 둥근 사각형, 모서리 반지름 약 113(한 변의 22%). 위 `#222a3a` → 아래 `#161c2a` 세로 그라데이션 |
| 링 중심 | (256, 252) 부근(원본에서 타일 중심보다 약간 위) |
| 링 바깥 반지름 | 약 175(원본 273px) |
| 링 안쪽 반지름 | 약 96~118(원본 150~185px, 조각 가운데가 두껍고 끝으로 갈수록 얇은 "콩" 모양) |
| 조각 | 네 개, 각각 약 84°. 각도는 수학 좌표(오른쪽 0°, 반시계 방향): 초록 0~82°, 파랑 84~178°, 노랑 180~262°, 빨강 268~352° |
| 틈 | 약 83°·179°·265°·355° 부근. 정확한 십자 방향에서 조금 돌아간 비스듬한 틈이고, 틈 폭은 타일 기준 4~6 정도의 어두운 선이다 |
| 조각 끝 | 둥글게 말린 끝(볼록). 이웃 조각과 맞닿는 쪽이 틈을 따라 비스듬하다 |

조각 색(원본 그대로, 그라데이션 방향은 원본을 보고 맞춘다):

| 조각 | 색 |
| --- | --- |
| 파랑(왼쪽 위) | 바깥·위 `#43b1fc` → 가운데 `#339dfc` → 아래 끝 `#1a7afc` |
| 초록(오른쪽 위) | 가운데 `#2bc692`, 안쪽 `#1fbc89` ~ 바깥 `#35d298` |
| 노랑(왼쪽 아래) | 위 끝 `#ffd634` → 가운데 `#fdc220` → 아래 끝 `#ffaf14` |
| 빨강(오른쪽 아래) | 가운데 `#fc7557`, 바깥 `#fd684d` ~ 안쪽 `#fd7e5e` |

- 원본의 입체감(조각 안쪽 미세한 광택, 타일 그림자)은 앱 아이콘에서 SVG 그라데이션·필터 정도로만 흉내 낸다. 필터를 쓰면 `icon.svg`가 작은 크기에서 흐려지지 않는지 확인한다. 바깥 그림자·투명 여백은 넣지 않는다.
- 평면 마크(`logo-mark.svg`, `LogoMark`)는 타일·그림자 없이 링 네 조각만, 같은 색(단색 또는 같은 그라데이션)이다. `viewBox`는 링에 딱 맞게(여백 2% 이내) 잡는다. 밝은 배경과 어두운 배경(다크 모드) 모두에서 보여야 한다.
- 파일 크기: 각 SVG 8KB 이하, `<image>`·base64·외부 참조·스크립트·`<text>` 없음.
- 원본과 나란히 놓고 비교한 이미지(저장소 밖)로 모양·색이 같은 로고로 보이는지 확인하고, 구현 결과에 비교 방법과 다른 점을 적는다.

## 5. 아이콘 파일

- `app/icon.svg` = `public/brand/app-icon.svg`와 같은 내용. Next.js 16 메타데이터 파일 규칙(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`)대로 두면 `<link rel="icon">`이 자동으로 붙는다. `layout.tsx`의 `metadata`는 고치지 않는다.
- `app/apple-icon.png`: 앱 아이콘 SVG를 180×180으로 렌더링(타일이 꽉 차게, 투명 여백 없음).
- `app/favicon.ico`: 16·32·48px 세 장을 담은 ICO. 16px에서 타일 위 네 색 링이 구분돼야 한다.
- PNG·ICO에 출처 메타데이터(C2PA 등)가 없어야 한다(우리 SVG에서 새로 렌더링하므로 원래 없다).

## 6. 화면

- `LogoMark`: `className`을 받아 크기를 정한다(기본 `size-5`). 장식용이라 `aria-hidden="true"`이고 서비스 이름 글자가 접근 가능한 이름이다. 인라인 SVG로 그려 추가 요청이 없다.
- 사이드바·모바일 메뉴 제목·auth 레이아웃·`/privacy` 머리의 `APP_NAME` 앞에 `LogoMark`를 둔다(글자와 세로 가운데 정렬, 간격 `gap-2`). 링크 영역·글자·크기는 지금과 같게 둔다.
- 360px에서 가로로 넘치지 않는다. 다크 모드에서도 마크가 보인다.

## 7. 테스트

- `frontend/tests/branding/`: `LogoMark`가 `aria-hidden`이고 서비스 이름이 그대로 보임, 네 곳(사이드바·모바일 메뉴·auth 레이아웃·처리방침)에 마크가 있음. SVG 파일 검사(크기 상한, `<image>`·`data:`·`<script>`·`href="http`·`<text>` 없음, `viewBox` 존재), `app/favicon.ico` 머리(ICO 형식, 16·32·48 세 장), `app/apple-icon.png` 180×180, `public/favicon.ico` 없음.

## 8. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 프론트 항목
- [ ] 실제 서버(슬롯 21)와 독립 브라우저에서 탭 아이콘이 새 로고로 바뀌고(`/icon.svg`·`/favicon.ico`·`/apple-icon.png` 200), 네 화면의 마크가 라이트·다크 모드, 360·768·1280px에서 보인다
- [ ] 원본과의 비교 이미지를 저장소 밖에 만들어 확인했다

## 9. 검증 체크리스트

1. SVG가 진짜 벡터(도형·그라데이션)이고 원본 PNG·base64·C2PA가 저장소 어디에도 없다(`git diff`로 추가된 바이너리는 `apple-icon.png`·`favicon.ico`뿐).
2. 원본과 나란히 봤을 때 같은 로고로 보인다(네 색, 조각 배치, 틈 방향, 타일 색). 색 값이 4절과 같다.
3. favicon 16·32·48과 apple-icon 180이 선명하고 타일이 꽉 찬다.
4. 네 화면의 마크 배치와 접근성(장식용 `aria-hidden`, 이름 유지), 라이트·다크, 360px.
5. 의존성 추가 없음, 소유 경로 밖 변경 없음.

## 10. 서비스 이름 변경 (2026-10-19 사용자 결정, 브랜치 `feature/21-logo-fix-1`)

- 서비스 이름을 "금융 프로젝트"에서 **"올웨더 자산관리"**로 바꾼다. 로고와 같은 브랜드 작업이라 이 스펙에서 다룬다.
- 바꾸는 곳은 두 군데다: `frontend/src/lib/site.ts`의 `APP_NAME = "올웨더 자산관리"`, `backend/app/main.py`의 FastAPI `title="올웨더 자산관리 API"`. 화면(사이드바·모바일 메뉴·로그인·가입·`/privacy` 머리·브라우저 제목 `%s | 올웨더 자산관리`)은 모두 `APP_NAME`을 쓰므로 따라 바뀐다. `APP_DESCRIPTION`·저장소 이름·폴더 이름은 바꾸지 않는다.
- 소유 파일: 위 두 파일, 이름을 글자로 단언하는 테스트가 있으면 그 단언만(`frontend/tests/**`, `backend/tests/**`), 이 문서 `## 구현 결과`의 새 소절.
- 확인: 프론트·백엔드 공통 완료 기준, 슬롯 21 서버에서 네 화면과 브라우저 제목·`/api/docs`(또는 OpenAPI JSON `info.title`)에 새 이름, 360px에서 사이드바·모바일 상단 바·로그인 화면 이름이 넘치거나 잘리지 않음(사이드바는 기존처럼 `truncate`).

## 구현 결과

### 구현한 것

- 로고 벡터(손으로 쓴 도형·그라데이션만, `<image>`·base64·필터·`<text>` 없음)
  - `public/brand/app-icon.svg`(2.9KB) = `app/icon.svg`: 타일 512×512(`rx` 113, 세로 그라데이션 `#222a3a`→`#161c2a`), 위쪽이 조금 밝은 흰 테두리 광택(불투명도 .16→.04→.08), 링 안팎의 방사형 그림자(불투명도 .3), 조각 뒤 어두운 띠(`#0a111c`, 틈과 조각 테두리 1px), 네 조각.
  - `public/brand/logo-mark.svg`(1.9KB): 같은 네 조각과 그라데이션만. `viewBox="74.5 74.5 360 360"`(링 지름 354에 여백 한쪽 3, 0.8%).
- 링 모양(타일 512 좌표): 중심 (254.5, 254.5), 바깥 반지름 177, 안쪽 반지름 97(두께 80). 네 조각은 90° 회전 대칭이다. 각 조각의 시계 방향 쪽 끝은 볼록한 공(반타원, 깊이 33.5, 위 반축 37·아래 반축 43)이고, 반시계 방향 쪽 끝은 이웃 조각의 공을 틈 약 7로 감싸는 오목한 소켓(타원 42×54)이며 소켓 양 끝 뿔은 바깥 반지름 14, 안쪽 반지름 6으로 둥글린다. 공 끝 가운데는 87.5°·177.5°·267.5°·357.5°(십자 방향에서 시계 방향으로 2.5°)다. 경로는 원·타원 호(`A`) 명령만 쓴다.
- 색: 4절 값을 그라데이션 정지점으로 그대로 썼다. 파랑은 오른쪽 위 바깥(`#43b1fc`)→가운데(`#339dfc`)→왼쪽 아래 안쪽 끝(`#1a7afc`) 선형, 노랑은 위 끝(`#ffd634`)→가운데(`#fdc220`)→아래 끝 바깥(`#ffaf14`) 선형, 초록·빨강은 링 중심 기준 방사형(안쪽 `#1fbc89`/`#fd7e5e` → 가운데 `#2bc692`/`#fc7557` → 바깥 `#35d298`/`#fd684d`).
- 아이콘 파일(저장소 밖 임시 스크립트가 `frontend/node_modules`의 `sharp`로 우리 SVG에서 새로 렌더링): `app/apple-icon.png` 180×180 RGB(알파 없음), `app/favicon.ico` PNG 항목 16·32·48. PNG 청크는 `IHDR·pHYs·IDAT·IEND`뿐이라 C2PA·텍스트·EXIF 메타데이터가 없다. `public/favicon.ico`(Next.js 기본 아이콘)는 지웠다. `layout.tsx`의 `metadata`는 고치지 않았고, `<head>`에 `favicon.ico`(sizes 48x48)·`icon.svg`(sizes any)·`apple-touch-icon`(180x180) 링크가 자동으로 붙는다.
- `components/common/LogoMark.tsx`: 인라인 SVG, 기본 `size-5 shrink-0`, `className`으로 크기 변경, `aria-hidden="true"`, `data-slot="logo-mark"`. 그라데이션 id는 `useId`로 만들어, 좁은 화면에서 사이드바(`display:none`)와 모바일 메뉴의 마크가 한 문서에 같이 있어도 서로의 그라데이션을 참조하지 않는다. 경로·viewBox는 `LOGO_MARK_PATHS`·`LOGO_MARK_VIEW_BOX`로 내보내 테스트가 `logo-mark.svg`와 대조한다.
- 네 화면의 `APP_NAME` 앞에 마크를 두고 `items-center gap-2`로 맞췄다. 사이드바·모바일 메뉴 제목은 `size-5`, auth 레이아웃·`/privacy` 머리는 글자가 `text-lg`라 `size-6`이다. 사이드바는 링크를 `flex min-w-0`으로 바꾸고 말줄임(`truncate`)을 글자 `span`으로 옮겨 긴 이름의 말줄임을 그대로 유지했다. 처리방침 링크는 `inline-flex`라 링크 영역이 이전처럼 글자(와 마크) 폭이다.
- 테스트 `tests/branding/`(15개): `logo-mark.test.tsx`(aria-hidden·기본 크기·className, `logo-mark.svg`와 같은 경로, 두 개를 그려도 그라데이션 id가 겹치지 않음, 사이드바·모바일 메뉴 제목·auth 레이아웃·처리방침 머리에 마크가 글자 앞에 하나 있고 접근 가능한 이름이 `APP_NAME`), `icon-files.test.ts`(세 SVG의 8KB 상한·`viewBox`·금지 요소·허용 요소 목록·4절 색, `icon.svg`=`app-icon.svg`, 평면 마크에 타일 없음, `favicon.ico` 머리와 16·32·48 PNG 항목, `apple-icon.png` 180×180·알파 없음, PNG 메타데이터 청크 없음, `public/favicon.ico` 없음). 기존 `tests/foundation/**`·`tests/privacy/**` 단언은 접근 가능한 이름이 그대로라 고칠 필요가 없었다.

### 측정·비교 방법

- 원본 SVG 안의 PNG(1254×1254)를 저장소 밖 임시 폴더에 꺼냈다. 타일 영역(x 222~1031, y 229~1014, 810×786)이 가로로 약 3% 넓어서, 512×512 정사각으로 늘려 원본 링도 원으로 맞춘 뒤 각도 1°마다 링 안팎 반지름, 반지름 4마다 틈 경계 각도, 위치별 색을 쟀다(바깥 원 맞춤 중심 (254.5, 254.6), 반지름 약 175~179, 안쪽 약 94~99).
- 원본 | 새 아이콘 | 50% 겹침 | 픽셀 차이를 나란히 놓은 이미지와 네 틈을 3배 확대한 비교 이미지(모두 저장소 밖)로 다듬었다. 차이 이미지에는 조각 가장자리 1~2px 선만 남는다.

### 스펙과 다른 점과 이유

- 조각 끝 모양: 4절은 "둥글게 말린 끝(볼록)"이라고 적었지만, 원본을 확대해 보면 틈마다 한쪽은 볼록한 공이고 다른 쪽은 그 공을 감싸는 오목한 소켓(양 끝은 둥근 뿔)이다. 같은 로고로 보이게 원본 모양을 따랐다.
- 측정값 차이: 링 중심은 (256, 252) 대신 측정값 (254.5, 254.5)이다. 안쪽 반지름은 96~118의 "콩 모양" 대신 97로 일정하다. 각도별로 재 보니 조각 몸통 두께는 약 80으로 거의 일정하고, 끝으로 갈수록 얇아 보이는 것은 공·소켓 끝 모양 때문이었다. 틈은 83·179·265·355° 대신 측정한 공 끝 기준 87.5·177.5·267.5·357.5°(90° 간격)다.
- `apple-icon.png`: 둥근 모서리 바깥을 투명으로 두지 않고 타일을 정사각으로 꽉 채웠다(테두리 광택은 뺐다). iOS가 홈 화면 아이콘에 자체 둥근 마스크를 씌우고 투명 픽셀을 검게 채우기 때문이다. 나머지 그림은 `app-icon.svg`와 같다. favicon은 탭에서 둥근 타일로 보이도록 모서리 투명을 유지했다.
- 입체감: 필터 대신 방사형 그림자·어두운 띠·테두리 그라데이션만 써서 작은 크기에서도 흐려지지 않는다. 원본의 조각 안 미세한 광택은 넣지 않았다.
- 색: 원본에서 잰 극값(초록 바깥 위 `#3fe3a5`, 파랑 안쪽 아래 끝 `#0c65fc` 등)은 4절 값보다 조금 더 밝거나 진하지만 4절 값을 그대로 썼다.

### 확인

- 프론트 `npm run lint`, `npx tsc --noEmit`, `npm run test`(54개 파일, 541개), `npm run build` 통과. 백엔드는 바꾸지 않았다.
- 슬롯 21 서버와 독립 Chrome 컨텍스트(Playwright, 새 프로필, `/api/market/connections/egress-ip` 가로채기 설치): `/icon.svg`·`/favicon.ico`·`/apple-icon.png` 200이고 받은 바이트가 저장소 파일과 같다. `<head>` 링크가 가리키는 세 아이콘을 브라우저에서 그려 새 로고임을 확인했다(headless에는 탭 줄이 없어 링크와 아이콘 리소스로 확인).
- 로그인·`/privacy`·사이드바(1280)·모바일 메뉴(360·768)를 라이트·다크, 360·768·1280px에서 열어 마크가 보이고 `aria-hidden`, 글자와 간격 8px·세로 가운데 차이 0, 그라데이션 참조 정상, 가로 넘침 0임을 확인했다.

### 남은 일

- 실제 브라우저 탭 줄과 iOS 홈 화면 추가 모습은 사람이 한 번 눈으로 보면 좋다.
- PWA manifest, 소셜 공유 이미지(OG), 워드마크는 범위 밖이다.

### 서비스 이름 변경

- 브랜치 `feature/21-logo-fix-1`(develop 436c62f에서 만듦), 10절대로 두 곳만 바꿨다: `frontend/src/lib/site.ts`의 `APP_NAME = "올웨더 자산관리"`, `backend/app/main.py`의 FastAPI `title="올웨더 자산관리 API"`. `APP_DESCRIPTION`·저장소·폴더 이름은 그대로다.
- 저장소에서 "금융 프로젝트"를 찾아보니(`git grep`, docs 제외) 위 두 파일뿐이었다. 테스트는 모두 `APP_NAME` 상수를 불러 단언하므로 고친 테스트가 없다.
- 확인
  - 백엔드 `uv run ruff check .`·`uv run ruff format --check .` 통과, `uv run pytest` 1490개 통과. 프론트 `npm run lint`·`npx tsc --noEmit`·`npm run test`(54개 파일, 541개)·`npm run build` 통과.
  - 슬롯 21 서버(백엔드 8021, 프론트 3021)와 독립 Chrome 컨텍스트(Playwright, 새 컨텍스트, `/api/market/connections/egress-ip` 가로채기와 localhost 밖 요청 차단 설치, 외부 요청 0건): 화면에서 가입한 새 계정으로 로그인해 확인했다.
  - 브라우저 제목: `로그인 | 올웨더 자산관리`, `가입 | 올웨더 자산관리`, `개인정보 처리방침 | 올웨더 자산관리`, `홈 | 올웨더 자산관리`.
  - 이름 표시: 로그인·가입·`/privacy` 머리(360·768·1280px), 사이드바(1280px), 모바일 메뉴 제목과 대화상자 접근 이름(360·768px), 메뉴 항목이 없는 `/onboarding`의 모바일 상단 바(360·768px)에 새 이름이 보이고, 글자가 상자 안에 들어가며(잘림 없음) 페이지 가로 넘침이 0이다. 사이드바는 기존 `truncate` 그대로이고 이름 폭(약 98px)이 칸보다 좁아 말줄임 없이 보인다.
  - OpenAPI JSON(`/openapi.json`)의 `info.title`이 `올웨더 자산관리 API`다.
- 스펙과 다른 점: 없다. 10절의 `/api/docs`는 이 앱에서 404이고 문서는 `/docs`·`/openapi.json`에 있어, 10절이 허용한 OpenAPI JSON `info.title`로 확인했다.
- 남은 일: 없다. docs에 남은 "금융 프로젝트"(`roadmap.md`의 워크트리 경로, `00-master-plan.md`의 폴더 이름, `01-foundation.md` 12.1·이 문서의 옛 이름 기록)는 서비스 이름이 아니라 경로·폴더 이름이거나 변경 이력이라 그대로 뒀다.
