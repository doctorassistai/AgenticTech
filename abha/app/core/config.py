import os



ABDM_BASE_URL = os.getenv("ABDM_BASE_URL", "https://abhasbx.abdm.gov.in")
ABDM_CLIENT_ID = os.getenv("ABDM_CLIENT_ID", "SBXID_008249")
ABDM_CLIENT_SECRET = os.getenv("ABDM_CLIENT_SECRET", "4aafbb51-a7a6-47c4-a5a0-c098c6e0420f")
ENV = os.getenv("ENV", "sandbox")

# Required by ABDM's Benefit APIs (Child ABHA, benefit linking/search) — this is
# specific to your organization's ABDM partner registration. Set it in your env.
ABDM_BENEFIT_NAME = os.getenv("ABDM_BENEFIT_NAME", "")

# if not ABDM_CLIENT_ID or not ABDM_CLIENT_SECRET:
#     raise RuntimeError("ABDM credentials are not set")
