"""학습 게시판: 게시물, 북마크, 읽음 기록."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "learn_0001"
down_revision = "foundation_0001"
branch_labels = ("learn",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "posts",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("summary", sa.String(200), nullable=False),
        sa.Column("body_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("term", sa.String(50), nullable=True),
        sa.Column("video_url", sa.Text(), nullable=True),
        sa.Column("video_id", sa.String(20), nullable=True),
        sa.Column("level", sa.String(12), nullable=False),
        sa.Column(
            "tags", postgresql.ARRAY(sa.String(20)), nullable=False, server_default=sa.text("'{}'")
        ),
        sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_assisted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "author_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("slug"),
        sa.CheckConstraint("kind in ('article','video','glossary')", name="kind"),
        sa.CheckConstraint("level in ('beginner','basic','intermediate')", name="level"),
        sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug"),
        sa.CheckConstraint("char_length(body_md) <= 20000", name="body_md"),
        sa.CheckConstraint("coalesce(array_length(tags, 1), 0) <= 10", name="tags"),
        sa.CheckConstraint("kind <> 'glossary' or term is not null", name="term"),
        sa.CheckConstraint("kind <> 'video' or video_url is not null", name="video_url"),
    )
    op.create_index(
        "uq_posts_term",
        "posts",
        ["term"],
        unique=True,
        postgresql_where=sa.text("kind = 'glossary'"),
    )
    op.create_index(
        "ix_posts_kind_published_published_at",
        "posts",
        ["kind", "published", sa.text("published_at desc")],
    )
    op.create_table(
        "bookmarks",
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "post_id", sa.UUID(), sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("user_id", "post_id"),
    )
    op.create_table(
        "post_reads",
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "post_id", sa.UUID(), sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("user_id", "post_id"),
    )


def downgrade() -> None:
    op.drop_table("post_reads")
    op.drop_table("bookmarks")
    op.drop_index("ix_posts_kind_published_published_at", table_name="posts")
    op.drop_index("uq_posts_term", table_name="posts")
    op.drop_table("posts")
