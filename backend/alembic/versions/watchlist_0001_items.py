"""관심종목 항목."""

import sqlalchemy as sa

from alembic import op

revision = "watchlist_0001"
down_revision = "foundation_0001"
branch_labels = ("watchlist",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("stock_code", sa.String(20), nullable=False),
        sa.Column("group_name", sa.String(20), nullable=False, server_default="기본"),
        sa.Column("memo", sa.String(200)),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("user_id", "stock_code", name="uq_watchlist_items_user_code"),
    )
    op.create_index(
        "ix_watchlist_items_user_group_order",
        "watchlist_items",
        ["user_id", "group_name", "sort_order"],
    )


def downgrade() -> None:
    op.drop_index("ix_watchlist_items_user_group_order", table_name="watchlist_items")
    op.drop_table("watchlist_items")
