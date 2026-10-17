"""증권사 잔고 동기화 메타데이터와 Mock 원천을 추가한다."""

import sqlalchemy as sa

from alembic import op

revision = "allocation_0002"
down_revision = "allocation_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("holdings", sa.Column("external_ref", sa.String(64), nullable=True))
    op.add_column("holdings", sa.Column("connection_id", sa.UUID(), nullable=True))
    op.add_column("holdings", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "holdings",
        sa.Column("class_override", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "uq_holdings_user_connection_external_ref",
        "holdings",
        ["user_id", "connection_id", "external_ref"],
        unique=True,
        postgresql_where=sa.text("external_ref IS NOT NULL"),
    )
    op.drop_constraint(op.f("ck_holdings_source"), "holdings", type_="check")
    op.create_check_constraint(
        "source", "holdings", "source in ('manual','kiwoom','toss','codef','mock')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM holdings WHERE source = 'mock'")
    op.drop_constraint(op.f("ck_holdings_source"), "holdings", type_="check")
    op.create_check_constraint("source", "holdings", "source in ('manual','kiwoom','toss','codef')")
    op.drop_index("uq_holdings_user_connection_external_ref", "holdings")
    for column in ("class_override", "synced_at", "connection_id", "external_ref"):
        op.drop_column("holdings", column)
