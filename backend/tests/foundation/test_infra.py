import base64
import shutil
import socket
import subprocess
import sys
from pathlib import Path

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[3]


def setup_env(root: Path):
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/lib/setup_env.py"),
            str(root),
            "finance_02",
            "8002",
            "3002",
        ],
        check=True,
    )


def test_env_slot_idempotent_and_preserves_settings(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    env = backend / ".env"
    key = base64.urlsafe_b64encode(b"1" * 32).decode()
    env.write_text(
        "DATABASE_URL=postgresql+psycopg://tester:local@db.example:5555/finance_00?sslmode=require\n"
        "FRONTEND_ORIGIN=http://localhost:3000\n"
        f'APP_ENCRYPTION_KEY="{key}"\n'
        "GEMINI_API_KEY=fake-preserved-value\n"
        "OLLAMA_MODEL=custom-model\n# 사용자 메모\n"
    )
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / ".env.local").write_text("CUSTOM_VALUE=preserved\n")
    setup_env(tmp_path)
    once = env.read_text()
    setup_env(tmp_path)
    assert env.read_text() == once
    assert "@db.example:5555/finance_02?sslmode=require" in once
    assert "FRONTEND_ORIGIN=http://localhost:3002" in once
    assert f'APP_ENCRYPTION_KEY="{key}"' in once
    assert "GEMINI_API_KEY=fake-preserved-value" in once
    assert "OLLAMA_MODEL=custom-model" in once
    assert "# 사용자 메모" in once
    assert (frontend / ".env.local").read_text().splitlines() == [
        "CUSTOM_VALUE=preserved",
        "NEXT_PUBLIC_API_BASE_URL=http://localhost:8002",
    ]


def test_env_creates_valid_key_and_skips_missing_frontend(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env.example").write_text(
        'DATABASE_URL=postgresql://user@localhost/finance_00\nAPP_ENCRYPTION_KEY=""\n'
    )
    setup_env(tmp_path)
    content = (backend / ".env").read_text()
    value = next(
        line.split("=", 1)[1]
        for line in content.splitlines()
        if line.startswith("APP_ENCRYPTION_KEY=")
    )
    Fernet(value.encode())
    assert not (tmp_path / "frontend").exists()


def test_slot_regex(tmp_path):
    script = tmp_path / "scripts/lib/common.sh"
    script.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / "scripts/lib/common.sh", script)
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    for branch, expected in [
        ("feature/02-allocation", "02"),
        ("ohch9712/feature-12-watchlist", "12"),
        ("develop", "00"),
        ("feature/01-foundation-backend", "01"),
    ]:
        subprocess.run(
            ["git", "-C", str(tmp_path), "symbolic-ref", "HEAD", "refs/heads/" + branch], check=True
        )
        result = subprocess.run(
            ["bash", "-c", '. "$1"\nprintf "%s" "$FINANCE_SLOT"', "test", str(script)],
            text=True,
            capture_output=True,
            check=True,
        )
        assert result.stdout == expected


def test_start_refuses_occupied_port(tmp_path):
    # 외부 서버는 띄우지 않고 소켓 하나로 포트 점유를 재현한다.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        result = subprocess.run(
            [
                "bash",
                "-c",
                """
. "$1/scripts/lib/common.sh"
FINANCE_RUNTIME="$3"
mkdir -p "$FINANCE_RUNTIME"
finance_port() { printf '%s' "$TEST_PORT"; }
TEST_PORT=$2
finance_start backend
""",
                "test",
                str(ROOT),
                str(port),
                str(tmp_path),
            ],
            text=True,
            capture_output=True,
        )
        assert result.returncode == 1
        assert "점유 프로세스는 종료하지 않았습니다" in result.stderr
        # 종료하지 않아 소켓이 그대로 LISTEN 상태다.
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass


def test_stop_preserves_other_worktree_pid(tmp_path):
    process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], cwd=tmp_path)
    try:
        metadata = tmp_path / "backend.pid"
        metadata.write_text(f"pid={process.pid}\nworktree=/different/worktree\nservice=backend\n")
        subprocess.run(
            [
                "bash",
                "-c",
                """
. "$1/scripts/lib/common.sh"
FINANCE_RUNTIME="$2"
finance_stop backend
""",
                "test",
                str(ROOT),
                str(tmp_path),
            ],
            check=True,
            capture_output=True,
        )
        assert process.poll() is None
        assert metadata.exists()
    finally:
        process.terminate()
        process.wait(timeout=5)
