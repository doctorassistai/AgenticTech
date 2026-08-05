====================================================
USERS SERVICE DOCUMENTATION
====================================================


1. USERS SERVICE OVERVIEW
====================================================

The Users Service is responsible for handling user-related operations and patient data management within Doctor Assist.

This service contains:

- User-level integrations.
- Patient data management.
- Patient context handling.
- WhatsApp bot integration.
- Specialty-specific patient workflows.
- Supporting backend functionalities.



====================================================
2. FOLDER STRUCTURE
====================================================


users/

│
├── integration/
│   │
│   └── integration_data.py
│       - Contains integration-related APIs and functions.
│
├── patient_data/
│   │
│   ├── uploads/
│   │   - Stores uploaded patient-related files.
│   │
│   ├── data.py
│   │   - Handles patient data-related operations.
│   │
│   ├── patientcontext.py
│   │   - Contains core patient context APIs.
│   │
│   ├── whatsapp.py
│   │   - Handles WhatsApp bot integration.
│   │
│   ├── protocol_master.py
│   │   - Handles protocol master functionalities.
│   │
│   ├── Radiotherapy_protocol_master.py
│   │   - Handles radiotherapy protocol-related operations.
│   │
│   ├── surgical_oncology.py
│   │   - Handles surgical oncology related functionalities.
│   │
│   ├── palliative_assessment_api.py
│   │   - Handles palliative assessment workflows.
│   │
│   └── protocol_master_seed.json
│       - Initial protocol master data.
│
├── celery_client.py
│   - Handles background task execution.
│
├── scheduler.py
│   - Handles scheduled background operations.
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
3. INTEGRATION MODULE
====================================================


Location:

users/integration/


integration_data.py


Purpose:

Handles integration-related functionality that does not require bearer authentication.


Responsibilities:

- External data integrations.
- Integration-specific API handling.
- Processing requests that bypass standard user authentication.



====================================================
4. PATIENT DATA MODULE
====================================================


Location:

users/patient_data/


Purpose:

Contains all patient-related operations and workflows.



====================================================
5. PATIENT CONTEXT MODULE
====================================================


File:

patientcontext.py


Purpose:

This is the main patient data processing module.


Contains:

- GET APIs.
- POST APIs.
- PUT APIs.
- Patient context management functions.
- Patient history retrieval.
- Patient-related workflows.



Responsibilities:

- Store and retrieve patient information.
- Manage patient clinical context.
- Provide patient data required by other services.



====================================================
6. WHATSAPP INTEGRATION
====================================================


File:

whatsapp.py


Purpose:

Handles WhatsApp bot integration with Doctor Assist.


Responsibilities:

- WhatsApp communication flow.
- Patient interaction through WhatsApp.
- Connecting WhatsApp requests with Doctor Assist services.
- Supporting appointment and patient-related workflows.



====================================================
7. SPECIALIZED FUNCTION MODULES
====================================================


The patient_data folder also contains speciality-specific functionality.


Examples:


protocol_master.py

- Handles clinical protocol master operations.


Radiotherapy_protocol_master.py

- Handles radiotherapy-specific protocol workflows.


surgical_oncology.py

- Handles surgical oncology related functionalities.


palliative_assessment_api.py

- Handles palliative care assessment workflows.



====================================================
8. REQUEST FLOW
====================================================


Authenticated Request:


Frontend / Gateway

        |
        v

Users Service

        |
        v

patient_data modules

        |
        v

Patient Data Processing

        |
        v

Response



Integration Request:


External System

        |
        v

integration/integration_data.py

        |
        v

Doctor Assist Services



====================================================
9. DEVELOPMENT NOTES
====================================================


For developers:


- Patient-related APIs should be added inside patient_data modules.
- Core patient context functionality should be maintained in patientcontext.py.
- WhatsApp-related changes should be handled inside whatsapp.py.
- Specialty-specific features should be maintained in their respective files.
- Integration APIs that do not require bearer authentication should be added inside integration_data.py.
- Avoid mixing specialty workflows with common patient context logic.
- Use celery_client.py for background processing tasks.
- Use scheduler.py for scheduled operations.



====================================================
END OF USERS SERVICE DOCUMENTATION
====================================================