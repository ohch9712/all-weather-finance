"""매매 체결 연결 정보와 Mock 원천을 추가한다."""

import sqlalchemy as sa

from alembic import op

revision = "journal_0003"
down_revision = "journal_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trades", sa.Column("connection_id", sa.UUID(), nullable=True))
    op.add_column("trades", sa.Column("external_id", sa.String(64), nullable=True))
    op.add_column("trades", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "uq_trades_user_connection_external",
        "trades",
        ["user_id", "connection_id", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )
    op.drop_constraint(op.f("ck_trades_source"), "trades", type_="check")
    op.create_check_constraint(
        "source", "trades", "source in ('manual','import','kiwoom','toss','mock')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM trades WHERE source = 'mock'")
    op.drop_constraint(op.f("ck_trades_source"), "trades", type_="check")
    op.create_check_constraint("source", "trades", "source in ('manual','import','kiwoom','toss')")
    op.drop_index("uq_trades_user_connection_external", table_name="trades")
    for column in ("synced_at", "external_id", "connection_id"):
        op.drop_column("trades", column)
