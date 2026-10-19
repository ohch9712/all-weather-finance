"""증권사 연결별 자동 동기화 설정과 마지막 결과를 추가한다."""

import sqlalchemy as sa

from alembic import op

revision = "market_0003"
down_revision = "market_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "broker_connections",
        sa.Column("auto_sync", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "broker_connections",
        sa.Column("last_auto_sync_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "broker_connections", sa.Column("last_auto_sync_status", sa.String(8), nullable=True)
    )
    op.add_column(
        "broker_connections", sa.Column("last_auto_sync_error_code", sa.String(40), nullable=True)
    )
    op.create_check_constraint(
        "last_auto_sync_status",
        "broker_connections",
        "last_auto_sync_status IN ('ok', 'partial', 'failed')",
    )


def downgrade():
    op.drop_constraint("last_auto_sync_status", "broker_connections", type_="check")
    for name in (
        "last_auto_sync_error_code",
        "last_auto_sync_status",
        "last_auto_sync_at",
        "auto_sync",
    ):
        op.drop_column("broker_connections", name)
