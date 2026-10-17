"""CODEF 연결 계정과 동기화 이력."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "connectors_0001"
down_revision = "foundation_0001"
branch_labels = ("connectors",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "connector_accounts",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.String(8), nullable=False),
        sa.Column("kind", sa.String(4), nullable=False),
        sa.Column("organization", sa.String(8), nullable=False),
        sa.Column("label", sa.String(30), nullable=False),
        sa.Column("connected_id_enc", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("provider = 'codef'", name="ck_connector_accounts_provider"),
        sa.CheckConstraint("kind in ('card','bank')", name="ck_connector_accounts_kind"),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "kind",
            "organization",
            name="uq_connector_accounts_user_provider_kind_org",
        ),
    )
    op.create_index("ix_connector_accounts_user_id", "connector_accounts", ["user_id"])
    op.create_table(
        "connector_syncs",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "account_id",
            sa.UUID(),
            sa.ForeignKey("connector_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("range_start", sa.Date()),
        sa.Column("range_end", sa.Date()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("summary", postgresql.JSONB()),
        sa.Column("error_code", sa.String(40)),
        sa.CheckConstraint(
            "kind in ('card_approvals','bank_balances')", name="ck_connector_syncs_kind"
        ),
        sa.CheckConstraint(
            "status in ('running','succeeded','failed')", name="ck_connector_syncs_status"
        ),
    )
    op.create_index(
        "ix_connector_syncs_user_account_started",
        "connector_syncs",
        ["user_id", "account_id", "started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_connector_syncs_user_account_started", table_name="connector_syncs")
    op.drop_table("connector_syncs")
    op.drop_index("ix_connector_accounts_user_id", table_name="connector_accounts")
    op.drop_table("connector_accounts")
