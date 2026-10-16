"""매매 기록과 매매 노트."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "journal_0001"
down_revision = "foundation_0001"
branch_labels = ("journal",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trades",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("traded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("time_known", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("market", sa.String(8), nullable=False),
        sa.Column("symbol_code", sa.String(20), nullable=False),
        sa.Column("symbol_name", sa.String(100), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("price", sa.Numeric(20, 6), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("fee", sa.Numeric(20, 6), nullable=False, server_default="0"),
        sa.Column("tax", sa.Numeric(20, 6), nullable=False, server_default="0"),
        sa.Column("broker", sa.String(10)),
        sa.Column("account_label", sa.String(30)),
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
        sa.Column("dedup_hash", sa.String(64)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("market in ('KRX','US','OTHER')", name="market"),
        sa.CheckConstraint("side in ('buy','sell')", name="side"),
        sa.CheckConstraint("currency in ('KRW','USD')", name="currency"),
        sa.CheckConstraint("quantity > 0", name="quantity"),
        sa.CheckConstraint("price > 0", name="price"),
        sa.CheckConstraint("fee >= 0", name="fee"),
        sa.CheckConstraint("tax >= 0", name="tax"),
        sa.CheckConstraint("broker in ('kiwoom','toss','other')", name="broker"),
        sa.CheckConstraint("source in ('manual','import','kiwoom','toss')", name="source"),
    )
    op.create_index("ix_trades_user_traded", "trades", ["user_id", "traded_at"])
    op.create_index("ix_trades_user_symbol", "trades", ["user_id", "symbol_code"])
    op.create_index(
        "uq_trades_user_dedup",
        "trades",
        ["user_id", "dedup_hash"],
        unique=True,
        postgresql_where=sa.text("dedup_hash IS NOT NULL"),
    )
    op.create_table(
        "trade_notes",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("trade_id", sa.UUID(), sa.ForeignKey("trades.id", ondelete="SET NULL")),
        sa.Column("symbol_code", sa.String(20)),
        sa.Column("noted_on", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "tags", postgresql.ARRAY(sa.String(20)), nullable=False, server_default=sa.text("'{}'")
        ),
        sa.Column("emotion", sa.String(12)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("kind in ('plan','review','memo')", name="kind"),
        sa.CheckConstraint("char_length(content) between 1 and 5000", name="content"),
        sa.CheckConstraint("cardinality(tags) <= 10", name="tags"),
        sa.CheckConstraint(
            "emotion in ('confident','calm','anxious','impulsive','greedy','fearful','regret')",
            name="emotion",
        ),
    )
    op.create_index(
        "ix_trade_notes_user_noted", "trade_notes", ["user_id", sa.text("noted_on DESC")]
    )
    op.create_index("ix_trade_notes_user_trade", "trade_notes", ["user_id", "trade_id"])


def downgrade() -> None:
    op.drop_table("trade_notes")
    op.drop_table("trades")
