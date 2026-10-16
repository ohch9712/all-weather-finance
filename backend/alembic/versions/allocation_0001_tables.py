"""자산배분: 투자성향 진단, 보유 자산, 점수 스냅샷, 상황, 목표."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "allocation_0001"
down_revision = "foundation_0001"
branch_labels = ("allocation",)
depends_on = None


def _id() -> sa.Column:
    return sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True)


def _user_id(**kwargs) -> sa.Column:
    return sa.Column(
        "user_id",
        sa.UUID(),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        **kwargs,
    )


def _timestamp(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    op.create_table(
        "risk_assessments",
        _id(),
        _user_id(),
        sa.Column("survey_version", sa.SmallInteger(), nullable=False),
        sa.Column("answers", postgresql.JSONB(), nullable=False),
        sa.Column("score", sa.Numeric(4, 1), nullable=False),
        sa.Column("risk_profile", sa.String(16), nullable=False),
        _timestamp("created_at"),
        sa.CheckConstraint("score >= 0 and score <= 100", name="score"),
        sa.CheckConstraint(
            "risk_profile in ('stable','stable_seeking','neutral','active','aggressive')",
            name="risk_profile",
        ),
    )
    op.create_index(
        "ix_risk_assessments_user_id_created_at",
        "risk_assessments",
        ["user_id", sa.text("created_at desc")],
    )

    op.create_table(
        "holdings",
        _id(),
        _user_id(),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("asset_class", sa.String(8), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column(
            "include_in_allocation", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("source", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("memo", sa.String(200), nullable=True),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "asset_class in ('stock','bond','gold','cash','other')", name="asset_class"
        ),
        sa.CheckConstraint("amount >= 0", name="amount"),
        sa.CheckConstraint("source in ('manual','kiwoom','toss','codef')", name="source"),
    )
    op.create_index("ix_holdings_user_id", "holdings", ["user_id"])

    op.create_table(
        "allocation_scores",
        _id(),
        _user_id(),
        sa.Column("scored_on", sa.Date(), nullable=False),
        sa.Column("score", sa.SmallInteger(), nullable=False),
        sa.Column("grade", sa.String(1), nullable=False),
        sa.Column("total_amount", sa.BigInteger(), nullable=False),
        sa.Column("actual_weights", postgresql.JSONB(), nullable=False),
        sa.Column("target_weights", postgresql.JSONB(), nullable=False),
        sa.Column("age_band", sa.String(4), nullable=False),
        sa.Column("risk_profile", sa.String(16), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.UniqueConstraint("user_id", "scored_on", name="uq_allocation_scores_user_id"),
        sa.CheckConstraint("score >= 0 and score <= 100", name="score"),
        sa.CheckConstraint("grade in ('S','A','B','C','D')", name="grade"),
    )

    op.create_table(
        "allocation_situations",
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("monthly_expense", sa.BigInteger(), nullable=False),
        sa.Column("dependents", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("consumer_debt", sa.BigInteger(), nullable=False, server_default="0"),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "monthly_expense >= 0 and monthly_expense <= 100000000", name="monthly_expense"
        ),
        sa.CheckConstraint("dependents >= 0 and dependents <= 10", name="dependents"),
        sa.CheckConstraint(
            "consumer_debt >= 0 and consumer_debt <= 1000000000000", name="consumer_debt"
        ),
    )

    op.create_table(
        "financial_goals",
        _id(),
        _user_id(),
        sa.Column("goal_type", sa.String(16), nullable=False),
        sa.Column("title", sa.String(30), nullable=False),
        sa.Column("target_amount", sa.BigInteger(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "goal_type in ('retirement','home','education','marriage','car','lump_sum','other')",
            name="goal_type",
        ),
        sa.CheckConstraint(
            "target_amount >= 1 and target_amount <= 1000000000000", name="target_amount"
        ),
    )
    op.create_index(
        "ix_financial_goals_user_id_target_date", "financial_goals", ["user_id", "target_date"]
    )


def downgrade() -> None:
    op.drop_index("ix_financial_goals_user_id_target_date", "financial_goals")
    op.drop_table("financial_goals")
    op.drop_table("allocation_situations")
    op.drop_table("allocation_scores")
    op.drop_index("ix_holdings_user_id", "holdings")
    op.drop_table("holdings")
    op.drop_index("ix_risk_assessments_user_id_created_at", "risk_assessments")
    op.drop_table("risk_assessments")
