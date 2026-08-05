====================================================
SPECIALITY SERVICE DOCUMENTATION
====================================================


1. SPECIALITY SERVICE OVERVIEW
====================================================

The Speciality Service is responsible for handling speciality-specific logic and routing within Doctor Assist.

This service manages functions based on different doctor specialities and provides speciality-specific processing capabilities.



====================================================
2. FOLDER STRUCTURE
====================================================


speciality/

│
├── services/
│   │
│   └── speciality_rule_router.py
│       - Contains speciality-based routing logic and functions.
│
├── vector_index.faiss
│   - Vector index used for speciality-related data retrieval.
│
├── vector_metadata.pkl
│   - Stores metadata information related to vector data.
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
3. SPECIALITY RULE ROUTER
====================================================


speciality_rule_router.py


Purpose:

This is the main processing file of the Speciality Service.


Contains:

- Doctor speciality-specific functions.
- Speciality-based routing rules.
- Logic to handle different medical specialities.
- Processing based on speciality requirements.



Responsibilities:

- Identify required speciality flow.
- Apply speciality-specific rules.
- Route requests according to doctor speciality.
- Provide speciality-specific responses and processing.



====================================================
4. VECTOR DATA
====================================================


vector_index.faiss

Purpose:

- Stores vector embeddings used for speciality-based search and retrieval.



vector_metadata.pkl

Purpose:

- Stores metadata information associated with vector embeddings.



====================================================
5. REQUEST FLOW
====================================================


Request

    |
    v

Speciality Service

    |
    v

speciality_rule_router.py

    |
    v

Speciality-specific Processing

    |
    v

Response



====================================================
6. DEVELOPMENT NOTES
====================================================


For developers:


- All speciality-related functions should be added inside speciality_rule_router.py.
- New doctor speciality logic should follow the existing routing structure.
- Maintain separate speciality rules for different medical domains.
- Vector index and metadata files should be updated when speciality knowledge data changes.
- Avoid adding unrelated AI or business logic inside this service.



====================================================
END OF SPECIALITY SERVICE DOCUMENTATION
====================================================