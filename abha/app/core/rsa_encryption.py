from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import base64


def rsa_encrypt_oaep_sha1(plaintext: str, public_key_b64: str) -> str:
    public_key_der = base64.b64decode(public_key_b64)

    public_key = serialization.load_der_public_key(
        public_key_der
    )

    ciphertext = public_key.encrypt(
        plaintext.encode(),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA1()),
            algorithm=hashes.SHA1(),
            label=None
        )
    )

    return base64.b64encode(ciphertext).decode()
