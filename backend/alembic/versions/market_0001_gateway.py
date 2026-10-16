"""종목·일별 스냅샷·암호화 증권사 연결."""

import sqlalchemy as sa

from alembic import op

revision = "market_0001"
down_revision = "foundation_0001"
branch_labels = ("market",)
depends_on = None


def upgrade():
    op.create_table(
        "stocks",
        sa.Column("code", sa.String(20), primary_key=True),
        sa.Column("market", sa.String(8), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("sector", sa.String(50)),
        sa.Column("listed", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "market in ('KOSPI','KOSDAQ','KONEX','NASDAQ','NYSE','AMEX','OTHER')", name="market"
        ),
        sa.CheckConstraint("source in ('mock','kiwoom','toss')", name="source"),
    )
    op.create_index("ix_stocks_name", "stocks", ["name"])
    op.create_table(
        "stock_snapshots",
        sa.Column("as_of", sa.Date(), primary_key=True),
        sa.Column("code", sa.String(20), primary_key=True),
        sa.Column("price", sa.Numeric(20, 4), nullable=False),
        sa.Column("change_rate", sa.Numeric(8, 2)),
        *[sa.Column(n, sa.BigInteger()) for n in ("volume", "trading_value", "market_cap")],
        *[sa.Column(n, sa.Numeric(12, 2)) for n in ("per", "pbr", "roe")],
        *[sa.Column(n, sa.Numeric(20, 2)) for n in ("eps", "bps")],
        sa.Column("foreign_ratio", sa.Numeric(6, 2)),
        *[sa.Column(n, sa.Numeric(20, 4)) for n in ("high_52w", "low_52w")],
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_stock_snapshots_as_of", "stock_snapshots", ["as_of"])
    op.create_table(
        "broker_connections",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.String(8), nullable=False),
        sa.Column("environment", sa.String(4), nullable=False),
        sa.Column("label", sa.String(30), nullable=False),
        sa.Column("app_key_enc", sa.Text(), nullable=False),
        sa.Column("app_secret_enc", sa.Text(), nullable=False),
        sa.Column("account_no_enc", sa.Text()),
        sa.Column("app_key_masked", sa.String(30)),
        sa.Column("account_no_masked", sa.String(30)),
        sa.Column("status", sa.String(12), nullable=False, server_default="unverified"),
        sa.Column("last_verified_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_code", sa.String(40)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("provider in ('mock','kiwoom','toss')", name="provider"),
        sa.CheckConstraint("environment in ('real','mock')", name="environment"),
        sa.CheckConstraint("status in ('unverified','active','error')", name="status"),
        sa.UniqueConstraint("user_id", "label", name="uq_broker_connections_user_label"),
    )
    op.create_index("ix_broker_connections_user_id", "broker_connections", ["user_id"])


def downgrade():
    op.drop_table("broker_connections")
    op.drop_table("stock_snapshots")
    op.drop_table("stocks")
