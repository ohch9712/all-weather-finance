"""사용자별 조건검색 저장."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "screener_0001"
down_revision = "foundation_0001"
branch_labels = ("screener",)
depends_on = None


def upgrade():
    op.create_table(
        "saved_screens",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("query_text", sa.String(300)),
        sa.Column("filter", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("user_id", "name"),
    )
    op.create_index("ix_saved_screens_user_id", "saved_screens", ["user_id"])


def downgrade():
    op.drop_index("ix_saved_screens_user_id", table_name="saved_screens")
    op.drop_table("saved_screens")
