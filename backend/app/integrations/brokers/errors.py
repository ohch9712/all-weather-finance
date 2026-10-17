from app.core.errors import AppError

MESSAGES = {
    "BROKER_AUTH_FAILED": "증권사 앱키와 시크릿을 확인해 주세요.",
    "BROKER_IP_NOT_ALLOWED": "증권사 포털에 이 서버의 IP를 허용 IP로 등록해 주세요.",
    "BROKER_RATE_LIMITED": "증권사 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
    "BROKER_UNAVAILABLE": "증권사 정보를 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
    "BROKER_NOT_SUPPORTED": "이 증권사 연결에서는 지원하지 않는 기능입니다.",
}


class BrokerError(Exception):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        self.message = message or MESSAGES[code]
        super().__init__(self.message)

    def as_app_error(self) -> AppError:
        status = (
            501
            if self.code == "BROKER_NOT_SUPPORTED"
            else 503
            if self.code == "BROKER_RATE_LIMITED"
            else 502
        )
        return AppError(status, self.code, self.message)


class UnsupportedBroker:
    capabilities = frozenset()

    def _unsupported(self, *args, **kwargs):
        raise BrokerError("BROKER_NOT_SUPPORTED")

    list_etfs = _unsupported
    list_stocks = _unsupported
    get_fundamentals = _unsupported
    get_quotes = _unsupported
    get_daily_candles = _unsupported
    get_holdings = _unsupported
    get_executions = _unsupported
    list_conditions = _unsupported
    run_condition = _unsupported
