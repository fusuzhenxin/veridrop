"""Seal operator passwords and station test keys. Stdlib only."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path


def load_secret(path: Path) -> bytes:
    raw = os.environ.get("OPS_SECRET", "").strip()
    if raw:
        return hashlib.sha256(raw.encode("utf-8")).digest()
    if path.exists():
        stored = path.read_bytes()
        if len(stored) >= 32:
            return stored[:32]
    path.parent.mkdir(parents=True, exist_ok=True)
    stored = secrets.token_bytes(32)
    path.write_bytes(stored)
    return stored


def hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return base64.b64encode(digest).decode("ascii")


def check_password(password: str, salt: bytes, encoded: str) -> bool:
    try:
        current = hash_password(password, salt)
    except Exception:
        return False
    return hmac.compare_digest(current, encoded)


def _stream(secret: bytes, nonce: bytes, size: int) -> bytes:
    chunks = []
    counter = 0
    filled = 0
    while filled < size:
        block = hmac.new(secret, b"ks" + nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        chunks.append(block)
        filled += len(block)
        counter += 1
    return b"".join(chunks)[:size]


def encrypt(secret: bytes, text: str) -> str:
    nonce = secrets.token_bytes(16)
    plain = text.encode("utf-8")
    cipher = bytes(left ^ right for left, right in zip(plain, _stream(secret, nonce, len(plain))))
    mac = hmac.new(secret, b"mac" + nonce + cipher, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(nonce + mac + cipher).decode("ascii")


def decrypt(secret: bytes, token: str) -> str:
    raw = base64.urlsafe_b64decode(token.encode("ascii"))
    if len(raw) < 48:
        raise ValueError("密钥无法读取")
    nonce, mac, cipher = raw[:16], raw[16:48], raw[48:]
    expect = hmac.new(secret, b"mac" + nonce + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expect):
        raise ValueError("密钥无法读取")
    plain = bytes(left ^ right for left, right in zip(cipher, _stream(secret, nonce, len(cipher))))
    return plain.decode("utf-8")
