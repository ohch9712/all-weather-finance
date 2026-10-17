"""종목 마스터에 주식·ETF 구분을 추가한다."""

import sqlalchemy as sa

from alembic import op

revision = "market_0002"
down_revision = "market_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("stocks", sa.Column("kind", sa.String(5), nullable=False, server_default="stock"))
    op.create_check_constraint("kind", "stocks", "kind IN ('stock', 'etf')")


def downgrade():
    op.drop_constraint("kind", "stocks", type_="check")
    op.drop_column("stocks", "kind")
