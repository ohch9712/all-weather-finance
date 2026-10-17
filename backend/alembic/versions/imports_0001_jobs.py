"""공통 파일 임포트 작업과 정제 셀 표."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "imports_0001"
down_revision = "foundation_0001"
branch_labels = ("imports",)
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(8), nullable=False),
        sa.Column(
            "sheet_names", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("sheet_name", sa.String(100)),
        sa.Column("header_row", sa.Integer(), nullable=False),
        sa.Column("columns", postgresql.JSONB(), nullable=False),
        sa.Column("rows", postgresql.JSONB(), nullable=False),
        sa.Column("skipped_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mapping", postgresql.JSONB(), nullable=False),
        sa.Column("mapping_source", sa.String(8), nullable=False),
        sa.Column(
            "warnings", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("result", postgresql.JSONB()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("status in ('parsed','mapped','committed')", name="status"),
        sa.CheckConstraint("file_type in ('csv','xlsx','xls','html')", name="file_type"),
        sa.CheckConstraint(
            "mapping_source in ('preset','synonym','llm','user')", name="mapping_source"
        ),
    )
    op.create_index(
        "ix_import_jobs_user_created", "import_jobs", ["user_id", sa.text("created_at desc")]
    )
    op.create_index("ix_import_jobs_expires_at", "import_jobs", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_import_jobs_expires_at", "import_jobs")
    op.drop_index("ix_import_jobs_user_created", "import_jobs")
    op.drop_table("import_jobs")
