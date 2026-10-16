"""모든 모듈의 메타데이터를 수집한다."""

from app.modules.allocation import models as allocation_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.chat import models as chat_models  # noqa: F401
from app.modules.connectors import models as connectors_models  # noqa: F401
from app.modules.dashboard import models as dashboard_models  # noqa: F401
from app.modules.estate import models as estate_models  # noqa: F401
from app.modules.imports import models as imports_models  # noqa: F401
from app.modules.journal import models as journal_models  # noqa: F401
from app.modules.learn import models as learn_models  # noqa: F401
from app.modules.ledger import models as ledger_models  # noqa: F401
from app.modules.market import models as market_models  # noqa: F401
from app.modules.screener import models as screener_models  # noqa: F401
from app.modules.watchlist import models as watchlist_models  # noqa: F401
