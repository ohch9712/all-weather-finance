"""AI 챗봇 대화와 대화 기록 행."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "chat_0001"
down_revision = "foundation_0001"
branch_labels = ("chat",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(100), nullable=False, server_default="새 대화"),
        sa.Column("provider", sa.String(10), nullable=False),
        sa.Column("model", sa.String(60), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("provider in ('gemini','ollama')", name="provider"),
    )
    op.create_index(
        "ix_chat_conversations_user_id_last_message_at",
        "chat_conversations",
        ["user_id", sa.text("last_message_at desc")],
    )
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "conversation_id",
            sa.UUID(),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("turn_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("text_preview", sa.String(500), nullable=False, server_default=""),
        sa.Column(
            "cards", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("model", sa.String(60)),
        sa.Column("stop_reason", sa.String(20)),
        sa.Column("usage", postgresql.JSONB()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("role in ('user','assistant')", name="role"),
        sa.CheckConstraint("kind in ('question','response','tool_results')", name="kind"),
        sa.CheckConstraint(
            "stop_reason is null or stop_reason in ('end','tool_use','max_tokens')",
            name="stop_reason",
        ),
        sa.UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conversation_id_seq"),
    )
    op.create_index(
        "ix_chat_messages_user_id_created_at", "chat_messages", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_user_id_created_at", "chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chat_conversations_user_id_last_message_at", "chat_conversations")
    op.drop_table("chat_conversations")
