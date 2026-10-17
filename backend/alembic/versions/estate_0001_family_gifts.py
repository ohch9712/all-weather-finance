"""가족과 증여 기록 테이블을 만든다."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "estate_0001"
down_revision = "foundation_0001"
branch_labels = ("estate",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "family_members",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("relation", sa.String(16), nullable=False),
        sa.Column("display_name", sa.String(20), nullable=False),
        sa.Column("birth_date", sa.Date()),
        sa.Column("married_on", sa.Date()),
        sa.Column(
            "child_birth_dates", postgresql.ARRAY(sa.Date()), nullable=False, server_default="{}"
        ),
        sa.Column("parent_deceased", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "relation in ('spouse','child','grandchild','parent','other_relative')", name="relation"
        ),
        sa.CheckConstraint("cardinality(child_birth_dates) <= 10", name="child_birth_dates"),
    )
    op.create_index("ix_family_members_user_id", "family_members", ["user_id"])
    op.create_table(
        "gift_records",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "recipient_id",
            sa.UUID(),
            sa.ForeignKey("family_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("donor_group", sa.String(16), nullable=False),
        sa.Column("deduction_category", sa.String(20), nullable=False),
        sa.Column("gifted_on", sa.Date(), nullable=False),
        sa.Column("asset_type", sa.String(16), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("appraisal_fee", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "marriage_birth_claimed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("tax_paid", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("filed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("memo", sa.String(200)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "donor_group in ('parents','grandparents','spouse',"
            "'children','relative','non_relative')",
            name="donor_group",
        ),
        sa.CheckConstraint(
            "deduction_category in ('lineal_ascendant','spouse',"
            "'lineal_descendant','other_relative','none')",
            name="deduction_category",
        ),
        sa.CheckConstraint(
            "asset_type in ('cash','listed_stock','real_estate','other')", name="asset_type"
        ),
        sa.CheckConstraint("amount > 0 and amount <= 1000000000000", name="amount"),
        sa.CheckConstraint("appraisal_fee >= 0 and tax_paid >= 0", name="expenses"),
    )
    op.create_index(
        "ix_gift_records_user_id_recipient_id_gifted_on",
        "gift_records",
        ["user_id", "recipient_id", "gifted_on"],
    )


def downgrade() -> None:
    op.drop_table("gift_records")
    op.drop_table("family_members")
