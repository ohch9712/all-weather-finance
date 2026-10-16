"""가계부 카테고리(기본 카테고리 행 포함)와 내역."""

import sqlalchemy as sa

from alembic import op

revision = "ledger_0001"
down_revision = "foundation_0001"
branch_labels = ("ledger",)
depends_on = None

# 스펙 03 4.1의 기본 카테고리. 목록 순서가 sort_order다.
DEFAULT_CATEGORIES = {
    "expense": [
        "식비",
        "카페·간식",
        "교통",
        "주거·관리비",
        "통신",
        "쇼핑",
        "생활용품",
        "의료·건강",
        "교육",
        "문화·여가",
        "여행",
        "경조사·선물",
        "보험",
        "세금·공과금",
        "금융·수수료",
        "기타 지출",
    ],
    "income": ["급여", "상여", "부수입", "금융수입", "용돈·지원", "기타 수입"],
}


def upgrade() -> None:
    categories = op.create_table(
        "ledger_categories",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("name", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("kind in ('income','expense')", name="kind"),
    )
    op.create_index(
        "uq_ledger_categories_default_kind_name",
        "ledger_categories",
        ["kind", "name"],
        unique=True,
        postgresql_where=sa.text("user_id is null"),
    )
    op.create_index(
        "uq_ledger_categories_user_kind_name",
        "ledger_categories",
        ["user_id", "kind", "name"],
        unique=True,
        postgresql_where=sa.text("user_id is not null"),
    )
    op.bulk_insert(
        categories,
        [
            {"kind": kind, "name": name, "sort_order": order}
            for kind, names in DEFAULT_CATEGORIES.items()
            for order, name in enumerate(names, start=1)
        ],
    )
    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column(
            "category_id",
            sa.UUID(),
            sa.ForeignKey("ledger_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("merchant", sa.String(100), nullable=True),
        sa.Column("payment_method", sa.String(10), nullable=False, server_default="other"),
        sa.Column("memo", sa.String(200), nullable=True),
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
        sa.Column("dedup_hash", sa.String(64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("kind in ('income','expense')", name="kind"),
        sa.CheckConstraint("amount > 0", name="amount"),
        sa.CheckConstraint(
            "payment_method in ('card','cash','transfer','other')", name="payment_method"
        ),
        sa.CheckConstraint("source in ('manual','import','codef')", name="source"),
    )
    op.create_index(
        "ix_ledger_entries_user_id_occurred_on",
        "ledger_entries",
        ["user_id", sa.text("occurred_on desc")],
    )
    op.create_index(
        "uq_ledger_entries_user_id_dedup_hash",
        "ledger_entries",
        ["user_id", "dedup_hash"],
        unique=True,
        postgresql_where=sa.text("dedup_hash is not null"),
    )


def downgrade() -> None:
    op.drop_index("uq_ledger_entries_user_id_dedup_hash", "ledger_entries")
    op.drop_index("ix_ledger_entries_user_id_occurred_on", "ledger_entries")
    op.drop_table("ledger_entries")
    op.drop_index("uq_ledger_categories_user_kind_name", "ledger_categories")
    op.drop_index("uq_ledger_categories_default_kind_name", "ledger_categories")
    op.drop_table("ledger_categories")
