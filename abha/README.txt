====================================================
ABHA INTEGRATION SERVICE DOCUMENTATION
====================================================


1. ABHA SERVICE OVERVIEW
====================================================

The ABHA service is responsible for integrating with ABHA APIs.

It handles:

- ABHA authentication.
- OTP verification.
- Patient ABHA profile management.
- Secure communication with ABHA servers.



====================================================
2. FOLDER STRUCTURE
====================================================


abha/

 ├── app/
 │
 │   ├── abdm/
 │   │    └── abha/
 │   │
 │   │        - auth.py
 │   │        - profile.py
 │   │        - schemas.py
 │   │        - service.py
 │
 │   ├── auth/
 │   │    - gateway_auth.py
 │   │    - token_cache.py
 │
 │   ├── core/
 │        - config.py
 │        - logging.py
 │        - rsa_encryption.py
 │        - security.py
 │
 ├── main.py
 └── Dockerfile



====================================================
3. FILE RESPONSIBILITIES
====================================================


auth.py
----------------------------------------------------

Handles ABHA authentication flow.

Functions include:

- Requesting OTP.
- Confirming OTP.
- Authentication-related API operations.



profile.py
----------------------------------------------------

Handles ABHA patient profile operations.

Functions include:

- Fetching ABHA profile details.
- Getting ABHA QR codes.
- Fetching patient photos.
- Retrieving ABHA card details.



schemas.py
----------------------------------------------------

Contains data schemas/models used for:

- Request validation.
- Response structures.
- ABHA data formatting.



service.py
----------------------------------------------------

Contains ABHA service layer functions.

Responsibilities:

- Encrypting OTP requests.
- Preparing API requests.
- Calling ABHA server APIs.
- Handling ABHA communication logic.



gateway_auth.py
----------------------------------------------------

Handles authentication with ABHA gateway.

Functions include:

- Fetching public keys.
- Getting gateway authentication keys.
- Managing gateway-level authentication.



token_cache.py
----------------------------------------------------

Manages ABHA token expiry and validity.

Responsibilities:

- Store token expiry time.
- Manage token lifetime limits.
- Control token reuse based on expiration.



====================================================
4. CORE MODULE
====================================================


core/

Contains common security and configuration utilities.

Includes:

- Application configuration.
- Logging setup.
- RSA encryption handling.
- Security functions.



====================================================
5. MAIN APPLICATION FLOW
====================================================


Request Flow:


Application

    |
    v

ABHA Service

    |
    v

Authentication

    |
    v

ABHA Gateway

    |
    v

ABHA Server APIs



====================================================
END OF ABHA SERVICE DOCUMENTATION
====================================================