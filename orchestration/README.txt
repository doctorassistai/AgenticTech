====================================================
ORCHESTRATION SERVICE DOCUMENTATION
====================================================


1. ORCHESTRATION SERVICE OVERVIEW
====================================================

The Orchestration Service is responsible for managing LLM-based workflows and processing logic within Doctor Assist.

This service contains functions that use Large Language Models (LLMs) directly for different AI operations.

Note:

- This service contains only LLM-based functions.
- Agentic workflows are not handled here.
- Agentic functions are maintained separately in the agentic service/module.



====================================================
2. FOLDER STRUCTURE
====================================================


orchestration/

│
├── celery_client.py
│   - Handles background task execution using Celery.
│
├── nodes.py
│   - Contains all LLM-based processing functions.
│
├── main.py
│   - Application entry point.
│
├── Dockerfile
│   - Docker configuration.
│
└── requirements.txt
    - Python dependencies.



====================================================
3. NODES MODULE
====================================================


nodes.py


Purpose:

This is the main processing file of the Orchestration Service.


Contains:

- LLM-powered functions.
- Prompt execution logic.
- AI processing workflows.
- LLM-based data transformation functions.


Responsibilities:

- Communicate with LLM models.
- Execute AI processing tasks.
- Generate responses using LLMs.
- Handle non-agentic AI workflows.



====================================================
4. CELERY CLIENT
====================================================


celery_client.py


Purpose:

Handles asynchronous task execution.


Responsibilities:

- Sending background processing tasks.
- Managing long-running LLM operations.
- Communicating with Celery workers.



====================================================
5. ORCHESTRATION FLOW
====================================================


Request

    |
    v

Orchestration Service

    |
    v

nodes.py

    |
    v

LLM Processing

    |
    v

Generated Response



====================================================
6. DEVELOPMENT NOTES
====================================================


For developers:


- All new LLM-only functions should be added inside nodes.py.
- Do not add agentic workflows inside this service.
- Agentic reasoning, tool usage, and autonomous flows should be implemented separately.
- Maintain separation between LLM processing and agent-based workflows.
- Use celery_client.py for asynchronous or heavy AI tasks.
- Keep main.py only for service initialization and configuration.



====================================================
END OF ORCHESTRATION SERVICE DOCUMENTATION
====================================================