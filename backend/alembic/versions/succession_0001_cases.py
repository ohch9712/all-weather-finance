"""상속·증여(과제) 입력 저장(사용자당 하나)."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "succession_0001"
down_revision = "foundation_0001"
branch_labels = ("succession",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "succession_cases",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("health_enc", sa.Text()),
        sa.Column("sensitive_consent_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "health_enc IS NULL OR sensitive_consent_at IS NOT NULL", name="health_consent"
        ),
    )


def downgrade() -> None:
    op.drop_table("succession_cases")
