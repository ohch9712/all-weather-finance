"""사용자 설정을 보존하고 슬롯에 해당하는 값만 갱신한다."""

import base64
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def update(path: Path, values: dict[str, str]) -> None:
    content = path.read_text() if path.exists() else ""
    for key, value in values.items():
        pattern = rf"(?m)^(?:export\s+)?{re.escape(key)}=.*$"
        replacement = f"{key}={value}"
        if re.search(pattern, content):
            content = re.sub(pattern, lambda _, text=replacement: text, content)
        else:
            content = content.rstrip("\n") + "\n" + replacement + "\n"
    path.write_text(content)
    path.chmod(0o600)


def main() -> None:
    root = Path(sys.argv[1])
    database, backend_port, frontend_port = sys.argv[2:]
    backend = root / "backend"
    if backend.is_dir():
        env = backend / ".env"
        if not env.exists():
            env.write_text((backend / ".env.example").read_text())
        content = env.read_text()
        match = re.search(r"(?m)^(?:export\s+)?DATABASE_URL=(.*)$", content)
        url = urlsplit(
            match.group(1).strip().strip("\"'")
            if match
            else "postgresql+psycopg://finance:finance_local_password@localhost:5433/finance_00"
        )
        values = {
            "DATABASE_URL": urlunsplit(url._replace(path="/" + database)),
            "FRONTEND_ORIGIN": "http://localhost:" + frontend_port,
        }
        match = re.search(r"(?m)^(?:export\s+)?APP_ENCRYPTION_KEY=(.*)$", content)
        if not match or not match.group(1).split("#", 1)[0].strip().strip("\"'"):
            values["APP_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(os.urandom(32)).decode()
        update(env, values)
    frontend = root / "frontend"
    if frontend.is_dir():
        update(
            frontend / ".env.local",
            {"NEXT_PUBLIC_API_BASE_URL": "http://localhost:" + backend_port},
        )


if __name__ == "__main__":
    main()
