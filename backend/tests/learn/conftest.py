import pytest
from sqlalchemy import delete

from app.modules.learn.models import Post


@pytest.fixture(autouse=True)
def empty_posts(db):
    """개발용 시드가 워크트리 DB에 있어도 테스트는 빈 게시판에서 시작한다(트랜잭션째 롤백된다)."""
    db.execute(delete(Post))
    db.flush()
