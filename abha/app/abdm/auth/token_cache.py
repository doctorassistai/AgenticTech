import time

_token = None
_token_expiry = 0

_public_key = None
_public_key_expiry = 0

PUBLIC_KEY_TTL = 90 * 24 * 60 * 60  # 3 months in seconds


def get_token():
    if _token and time.time() < _token_expiry:
        return _token
    return None


def set_token(token, expires_in):
    global _token, _token_expiry
    _token = token
    _token_expiry = time.time() + expires_in - 60


def get_public_key():
    global _public_key, _public_key_expiry
    if _public_key and time.time() < _public_key_expiry:
        return _public_key
    return None


def set_public_key(public_key: str):
    global _public_key, _public_key_expiry
    _public_key = public_key
    _public_key_expiry = time.time() + PUBLIC_KEY_TTL