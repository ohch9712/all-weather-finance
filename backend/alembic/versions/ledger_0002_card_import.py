"""카드 명세서와 가맹점 분류 규칙."""

import sqlalchemy as sa

from alembic import op

revision = "ledger_0002"
down_revision = "ledger_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ledger_entries", sa.Column("card_name", sa.String(50)))
    op.add_column("ledger_entries", sa.Column("approval_no", sa.String(30)))
    op.add_column(
        "ledger_entries",
        sa.Column("is_cancellation", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("ledger_entries", sa.Column("import_batch_id", sa.UUID()))
    op.create_index(
        "ix_ledger_entries_user_id_import_batch_id",
        "ledger_entries",
        ["user_id", "import_batch_id"],
    )
    op.create_table(
        "ledger_merchant_rules",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("merchant_key", sa.String(100), nullable=False),
        sa.Column(
            "category_id",
            sa.UUID(),
            sa.ForeignKey("ledger_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "user_id", "merchant_key", name="uq_ledger_merchant_rules_user_id_merchant_key"
        ),
    )


def downgrade() -> None:
    op.drop_table("ledger_merchant_rules")
    op.drop_index("ix_ledger_entries_user_id_import_batch_id", "ledger_entries")
    for column in ("import_batch_id", "is_cancellation", "approval_no", "card_name"):
        op.drop_column("ledger_entries", column)
