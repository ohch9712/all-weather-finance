"""매매 수수료·세금 요율과 추정 표시."""

import sqlalchemy as sa

from alembic import op

revision = "journal_0002"
down_revision = "journal_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trade_cost_settings",
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("krx_commission_rate", sa.Numeric(6, 4), nullable=False),
        sa.Column("krx_sell_tax_rate", sa.Numeric(6, 4), nullable=False),
        sa.Column("us_commission_rate", sa.Numeric(6, 4), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        *[
            sa.CheckConstraint(f"{name} >= 0 AND {name} <= 5", name=name)
            for name in ("krx_commission_rate", "krx_sell_tax_rate", "us_commission_rate")
        ],
    )
    op.add_column(
        "trades",
        sa.Column("cost_estimated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("trades", "cost_estimated")
    op.drop_table("trade_cost_settings")
