import os
import base64
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class EncryptionService:
    _key = None

    @classmethod
    def _get_key(cls) -> bytes:
        if cls._key is None:
            key_hex = os.getenv("ENCRYPTION_KEY")
            if not key_hex:
                raise RuntimeError("ENCRYPTION_KEY not set")
            cls._key = bytes.fromhex(key_hex)  # 32 bytes hex
        return cls._key

    @classmethod
    def encrypt(cls, plaintext: str) -> str:
        if plaintext is None:
            return None

        key = cls._get_key()
        aesgcm = AESGCM(key)
        nonce = secrets.token_bytes(12)  # GCM standard
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)

        return base64.b64encode(nonce + ciphertext).decode()

    @classmethod
    def decrypt(cls, ciphertext: str) -> str:
        if ciphertext is None:
            return None

        key = cls._get_key()
        raw = base64.b64decode(ciphertext.encode())

        nonce = raw[:12]
        encrypted = raw[12:]

        aesgcm = AESGCM(key)
        plaintext = aesgcm.decrypt(nonce, encrypted, None)

        return plaintext.decode()



#EXAMPLE USAGE:
# from middlewares.encryption import EncryptionService

# user_doc = {
#     "name": EncryptionService.encrypt(name),
#     "email": EncryptionService.encrypt(email),
#     "phone": EncryptionService.encrypt(phone),
#     "created_at": datetime.utcnow()
# }

# collection_users_hms.insert_one(user_doc)

# user = collection_users_hms.find_one({"_id": ObjectId(user_id)})

# response = {
#     "name": EncryptionService.decrypt(user["name"]),
#     "email": EncryptionService.decrypt(user["email"]),
# }


SENSITIVE_PATIENT_FIELDS = {
    "name",
    "email",
    "phone_number",
    "address",
    "date_of_birth",
    "family_history",
    "education",
    "occupation",
    "annual_income",
}

def encrypt_data(data: dict) -> dict:
    encrypted = data.copy()
    for field in SENSITIVE_PATIENT_FIELDS:
        if field in encrypted and encrypted[field] is not None:
            encrypted[field] = EncryptionService.encrypt(str(encrypted[field]))
    return encrypted


def decrypt_data(data: dict) -> dict:
    decrypted = data.copy()
    for field in SENSITIVE_PATIENT_FIELDS:
        if field in decrypted and decrypted[field] is not None:
            try:
                decrypted[field] = EncryptionService.decrypt(decrypted[field])
            except Exception:
                # Fail-safe: return original if decryption fails
                pass
    return decrypted

