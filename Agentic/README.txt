====================================================
AGENTIC SERVICE DOCUMENTATION
====================================================


1. AGENTIC SERVICE OVERVIEW
====================================================

The Agentic Service contains all agent-based AI workflows used in Doctor Assist.

This service is responsible for:

- Running autonomous AI agents.
- Managing multi-step AI workflows.
- Executing task-specific agent logic.
- Handling complex reasoning and decision-making processes.

Each agent is implemented separately based on the functionality it performs.



====================================================
2. FOLDER STRUCTURE
====================================================


Agentic/

│
├── agents/
│   - Contains individual AI agent implementations.
│
├── core/
│   - Contains core agent configurations and utilities.
│
├── Rag/
│   - Contains Retrieval Augmented Generation related components.
│
├── workflow/
│   - Contains agent workflow definitions and execution logic.
│
├── agentic_graph_rag.py
│   - Handles graph-based RAG workflows.
│
├── Agentic.py
│   - Main agentic processing logic.
│
├── client.py
│   - Handles client communication.
│
├── celery_app.py
│   - Handles background agent tasks.
│
├── Dockerfile
│   - Docker configuration.
│
└── Other agent files
    - Contains individual agents for different system functionalities.



====================================================
3. AGENT IMPLEMENTATION
====================================================


Each agent functionality is maintained in a separate Python file.


Examples:

- Diagnostic agents.
- Clinical reasoning agents.
- Document processing agents.
- Emergency workflow agents.
- Discharge-related agents.
- Image processing agents.


Each agent file contains:

- Agent logic.
- Required tools/workflows.
- Input processing.
- AI decision flow.



====================================================
4. AGENTIC WORKFLOW
====================================================


Request

    |
    v

Agentic Service

    |
    v

Required Agent

    |
    v

Agent Workflow Execution

    |
    v

LLM / Tools / RAG Processing

    |
    v

Final Response



====================================================
5. DEVELOPMENT NOTES
====================================================


For developers:


- Each new autonomous AI functionality should be created as a separate agent.
- Agent-specific logic should remain inside its respective file.
- Common agent utilities should be maintained inside core.
- RAG-related changes should be handled inside Rag modules.
- Workflow changes should be maintained inside workflow folder.
- Avoid mixing normal LLM processing with agentic workflows.
- This service is dedicated only to agent-based AI operations.



====================================================
END OF AGENTIC SERVICE DOCUMENTATION
====================================================