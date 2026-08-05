import requests
from core.config import ABDM_BASE_URL, ABDM_CLIENT_ID, ABDM_CLIENT_SECRET
from core.security import abdm_headers
from .token_cache import get_token, set_token
import uuid
from datetime import datetime, timezone
import requests


def get_gateway_token():
    cached = get_token()
    if cached:
        return cached

    url = f"{ABDM_BASE_URL}/api/hiecm/gateway/v3/sessions"
    headers = abdm_headers(ABDM_CLIENT_ID)

    payload = {
        "clientId": ABDM_CLIENT_ID,
        "clientSecret": ABDM_CLIENT_SECRET,
        "grantType": "client_credentials"
    }

    res = requests.post(url, json=payload, headers=headers, timeout=10)

    data = res.json()

    if "accessToken" not in data:
        raise RuntimeError(
            f"Gateway token not issued by ABDM. Response: {data}"
        )

    set_token(data["accessToken"], data["expiresIn"])
    return data["accessToken"]




def fetch_public_key_from_server() -> str:
    print("Fetching public key from ABDM server")
    token = get_gateway_token()
    print("Token", token)

    # headers = abdm_headers(ABDM_CLIENT_ID)

    headers = {
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
,
              }
    headers["Authorization"] = f"Bearer {token}"


    print("Headers", headers)
    PUBLIC_KEY_URL = "https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate"


    response = requests.get(
        PUBLIC_KEY_URL,
        headers=headers,
        timeout=10
    )

    response.raise_for_status()

    data = response.json()

    print("Data", data)

    public_key = data.get("publicKey")
    if not public_key:
        raise ValueError("Public key missing in response")

    # public_key = "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAstWB95C5pHLXiYW59qyO4Xb+59KYVm9Hywbo77qETZVAyc6VIsxU+UWhd/k/YtjZibCznB+HaXWX9TVTFs9Nwgv7LRGq5uLczpZQDrU7dnGkl/urRA8p0Jv/f8T0MZdFWQgks91uFffeBmJOb58u68ZRxSYGMPe4hb9XXKDVsgoSJaRNYviH7RgAI2QhTCwLEiMqIaUX3p1SAc178ZlN8qHXSSGXvhDR1GKM+y2DIyJqlzfik7lD14mDY/I4lcbftib8cv7llkybtjX1AayfZp4XpmIXKWv8nRM488/jOAF81Bi13paKgpjQUUuwq9tb5Qd/DChytYgBTBTJFe7irDFCmTIcqPr8+IMB7tXA3YXPp3z605Z6cGoYxezUm2Nz2o6oUmarDUntDhq/PnkNergmSeSvS8gD9DHBuJkJWZweG3xOPXiKQAUBr92mdFhJGm6fitO5jsBxgpmulxpG0oKDy9lAOLWSqK92JMcbMNHn4wRikdI9HSiXrrI7fLhJYTbyU3I4v5ESdEsayHXuiwO/1C8y56egzKSw44GAtEpbAkTNEEfK5H5R0QnVBIXOvfeF4tzGvmkfOO6nNXU3o/WAdOyV3xSQ9dqLY5MEL4sJCGY1iJBIAQ452s8v0ynJG5Yq+8hNhsCVnklCzAlsIzQpnSVDUVEzv17grVAw078CAwEAAQ=="
    return public_key
