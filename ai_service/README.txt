====================================================
AI SERVICE DOCUMENTATION
====================================================


1. AI SERVICE OVERVIEW
====================================================

The AI Service is responsible for handling all AI-related operations in the system.

This service manages:

- LLM integrations.
- AI model communication.
- Voice AI integrations.
- AI response processing.
- AI security and safety layers.


This service is mainly used by developers for managing and extending AI functionalities.



====================================================
2. FOLDER STRUCTURE
====================================================


ai_service/

│
├── cache/
│   - Stores temporary AI-related cache data.
│
├── common_llm/
│   - Contains common LLM related implementations.
│
├── elevenlabs/
│   - Handles ElevenLabs voice AI integration.
│
├── guardian_layer/
│   - Contains AI safety and validation layers.
│
├── layers/
│   - Contains AI processing layers.
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
3. COMMON LLM MODULE
====================================================


Location:

common_llm/


Purpose:

Contains common Large Language Model related functionalities.


Files:


nodes_llm.py
----------------------------------------------------

Handles LLM processing nodes and AI workflow execution.



speciality_llm.py
----------------------------------------------------

Contains speciality-based LLM handling logic.



====================================================
4. ELEVENLABS MODULE
====================================================


Location:

elevenlabs/


Purpose:

Handles ElevenLabs voice AI integration.


File:

elevenlabs.py


Responsibilities:

- ElevenLabs API communication.
- Voice processing.
- Webhook handling.
- Voice AI related operations.



====================================================
5. GUARDIAN LAYER
====================================================


Location:

guardian_layer/


Purpose:

Provides AI safety and validation mechanisms.


Responsibilities:

- Prevent unsafe AI responses.
- Validate AI generated content.
- Improve reliability of AI outputs.



Files:


clinical_safety_rules_engine.py

- Applies clinical safety rules.
- Validates healthcare-related AI responses.



factuality_confidence_scorer.py

- Evaluates confidence and factual reliability of AI responses.



guideline_checker.py

- Checks AI responses against predefined guidelines.



hallucination_cross_check.py

- Detects possible hallucinations.
- Performs validation against expected information.



====================================================
6. AI PROCESSING LAYERS
====================================================


Location:

layers/


Purpose:

Contains AI request processing and security layers.



Files:


intent_classifier.py

- Identifies user intent.
- Routes requests based on detected intent.



prompt_injection_defence.py

- Protects AI models from prompt injection attacks.
- Filters malicious instructions.



sanitizer.py

- Cleans and validates input data before AI processing.



====================================================
7. AI REQUEST FLOW
====================================================


Request Flow:


User Request

      |
      v

AI Service

      |
      v

Input Sanitization

      |
      v

Intent Classification

      |
      v

Prompt Injection Protection

      |
      v

LLM Processing

      |
      v

Guardian Layer Validation

      |
      v

Final AI Response



====================================================
8. DEVELOPMENT NOTES
====================================================


For developers:


- New AI models or LLM integrations should be added inside common_llm.
- New voice AI integrations should be maintained inside elevenlabs.
- AI safety checks should be implemented inside guardian_layer.
- Input validation and security changes should be handled inside layers.
- Avoid adding business logic directly in main.py.
- Maintain separation between AI processing, security, and integrations.


====================================================
END OF AI SERVICE DOCUMENTATION
====================================================