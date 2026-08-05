====================================================
COMMON SERVICE DOCUMENTATION
====================================================


1. COMMON SERVICE OVERVIEW
====================================================

The Common Service contains shared backend functionalities used across different services in Doctor Assist.

This service mainly handles:

- Celery worker setup and background task execution.
- Common AI/LLM utility functions.
- File upload and processing workflows.
- Shared service-level operations.



====================================================
2. FOLDER STRUCTURE
====================================================


common/

│
├── celery_worker/
│   - Contains all Celery worker tasks.
│
├── llm/
│   - Contains common LLM-based processing functions.
│
├── parsers/
│   - Contains document and data parsing utilities.
│
├── prompts/
│   - Contains reusable AI prompts.
│
├── services/
│   - Contains common service functions.
│
├── save_download.py
│   - Handles file upload, processing, and storage operations.
│
├── main.py
│   - Application entry point.
│
├── Dockerfile
│   - Docker configuration.
│
├── Dockerfile.celery
│   - Celery worker Docker configuration.
│
└── requirements.txt
    - Python dependencies.



====================================================
3. CELERY WORKER MODULE
====================================================


Location:

common/celery_worker/


Purpose:

Contains background processing tasks executed asynchronously using Celery.


Responsibilities:

- Execute long-running processes.
- Handle background AI tasks.
- Process documents asynchronously.
- Run scheduled and queued operations.


The Celery worker handles tasks such as:

- Document processing.
- PDF processing.
- Image/handwritten processing.
- Mobile parsing.
- Summary generation.
- MongoDB-related background operations.



====================================================
4. LLM MODULE
====================================================


Location:

common/llm/


Purpose:

Contains shared LLM-related functionalities used across services.


Responsibilities:

- LLM processing utilities.
- Knowledge graph handling.
- Hospital rule-based AI processing.
- Oncology pipeline processing.
- Lab-related AI processing.



====================================================
5. SERVICES MODULE
====================================================


Location:

common/services/


Purpose:

Contains reusable service-level functions.


Responsibilities:

- Text extraction.
- Prompt enhancement.
- Lab biomarker processing.
- Lab context synchronization.
- Common AI processing utilities.



====================================================
6. SAVE DOWNLOAD MODULE
====================================================


File:

save_download.py


Purpose:

Handles all file upload, processing, and storage workflows.


Responsibilities:

- Receive uploaded files.
- Process uploaded documents.
- Save files into required locations.
- Manage file download operations.
- Provide APIs related to upload/download functionality.



Request Flow:


User Upload

      |
      v

Common Service

      |
      v

save_download.py

      |
      v

File Processing

      |
      v

Storage / Processing Pipeline



====================================================
7. REQUEST FLOW
====================================================


Application Request

        |
        v

Common Service

        |
        +----------------+
        |                |
        v                v

Celery Worker       Common Services

        |
        v

Background Processing



====================================================
8. DEVELOPMENT NOTES
====================================================


For developers:


- Common reusable functionalities should be added inside this service.
- Background tasks should be implemented using Celery workers.
- New asynchronous processing tasks should be added inside celery_worker.
- Shared LLM utilities should be maintained inside llm.
- File upload/download related changes should be handled inside save_download.py.
- Avoid duplicating common functionality in individual services.
- This service should contain only reusable components shared across the system.



====================================================
END OF COMMON SERVICE DOCUMENTATION
====================================================