# 샘플 종목

코드·종목명·시장·업종은 국내 상장 종목의 식별 정보이며, 가격·지표·잔고·체결·조건식은 고정 시드 8로 생성한 가상 데이터다. 실제 투자 자료로 사용하지 않는다.

종목 식별 정보는 KRX KIND의 [상장법인 목록](https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13)과 대조했다(2026-10-17). 회사명과 업종은 해당 목록 기준이며, 가격과 재무지표는 실제 값이 아니다.

## 국내 ETF 10개

삼성자산운용 [ETF 찾기](https://www.samsungfund.com/etf/product/list.do)의 코드·상품명(`stkTicker`, `fNm`)을 대조했다(2026-10-17). 해외지수 ETF도 KRX에 상장된 국내 ETF다. ETF 지표는 별도의 고정 시드 8로 만든 가상값이며 PER·PBR·ROE·EPS·BPS·외국인 비율은 NULL이다.

| 구분 | 코드 | 상품명·공식 출처 |
| --- | --- | --- |
| 국내 대표지수 | 069500 | [KODEX 200](https://www.samsungfund.com/etf/product/view.do?id=2ETF01) |
| 국내 대표지수 | 229200 | [KODEX 코스닥 150](https://www.samsungfund.com/etf/product/view.do?id=2ETF54) |
| 해외지수 | 379800 | [KODEX 미국S&P500](https://www.samsungfund.com/etf/product/view.do?id=2ETFE4) |
| 해외지수 | 379810 | [KODEX 미국나스닥100](https://www.samsungfund.com/etf/product/view.do?id=2ETFE3) |
| 채권 | 114260 | [KODEX 국고채3년](https://www.samsungfund.com/etf/product/view.do?id=2ETF19) |
| 채권 | 273130 | [KODEX 종합채권(AA-이상) 액티브](https://www.samsungfund.com/etf/product/view.do?id=2ETF88) |
| 금 | 132030 | [KODEX 골드선물(H)](https://www.samsungfund.com/etf/product/view.do?id=2ETF24) |
| 인버스 | 114800 | [KODEX 인버스](https://www.samsungfund.com/etf/product/view.do?id=2ETF20) |
| 레버리지 | 122630 | [KODEX 레버리지](https://www.samsungfund.com/etf/product/view.do?id=2ETF25) |
| 배당 | 489250 | [KODEX 미국배당다우존스](https://www.samsungfund.com/etf/product/view.do?id=2ETFN9) |
