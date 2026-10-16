from cryptography.fernet import Fernet

from app.core.config import get_settings


def encrypt_str(plain: str) -> str:
    return Fernet(get_settings().app_encryption_key.encode()).encrypt(plain.encode()).decode()


def decrypt_str(token: str) -> str:
    return Fernet(get_settings().app_encryption_key.encode()).decrypt(token.encode()).decode()


def mask_tail(value: str, keep: int = 4) -> str:
    if keep < 0:
        raise ValueError("남길 글자 수는 0 이상이어야 합니다.")
    return "*" * max(0, len(value) - keep) + (value[-keep:] if keep else "")
