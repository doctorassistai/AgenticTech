====================================================
GATEWAY ROUTING SERVICE DOCUMENTATION
====================================================


1. GATEWAY OVERVIEW
====================================================

The Gateway service acts as the central routing layer between the frontend application and backend Docker services.

All API requests from the frontend first reach the Gateway.

The main responsibility of the Gateway is:

- Receive incoming API requests.
- Identify the required service based on the API path.
- Route the request to the respective backend Docker service.
- Return the backend response back to the frontend.


Request Flow:


Frontend
   |
   |
   v
Gateway
   |
   |
   v
Respective Backend Docker Service



====================================================
2. ROUTING STRUCTURE
====================================================


The routing logic is maintained inside the:

gateway/routes/


folder.


Each module/service has its own routing file.

The routing files contain:

- API endpoint definitions.
- Request forwarding logic.
- Backend service mapping.
- Response handling.



Example:


Frontend Request:

/api/integration/...


Gateway receives request:

gateway/routes/integration.py


integration.py forwards the request to:

Integration Docker Service



====================================================
3. ROUTES FOLDER PURPOSE
====================================================


The routes folder acts as the API mapping layer.

Responsibilities:

- Group APIs based on their functionality.
- Connect frontend API requests with the correct backend Docker.
- Maintain clean separation between different services.


Structure example:


gateway/

 └── routes/

      ├── login.py
      ├── doctor.py
      ├── patient.py
      ├── integration.py
      ├── appointment.py
      └── other service routes



Each route file is responsible only for routing requests related to that module.



====================================================
4. REQUEST ROUTING PROCESS
====================================================


When a request comes from frontend:


Step 1:

Frontend sends API request to Gateway.


Step 2:

Gateway checks the requested API path.


Step 3:

The request is redirected to the matching route file inside:

gateway/routes/


Step 4:

The route file forwards the request to the required backend Docker service.


Step 5:

Backend response is received by Gateway.


Step 6:

Gateway sends the response back to frontend.



Flow:


Frontend

   |
   v

Gateway main.py

   |
   v

routes/<service>.py

   |
   v

Backend Docker Service

   |
   v

Response back to Frontend



====================================================
5. ADDING NEW ROUTING
====================================================


To add a new backend service:


Step 1:

Create a new route file inside:

gateway/routes/


Example:

new_service.py



Step 2:

Add API routing logic inside the file.



Step 3:

Connect the route with the respective backend Docker service.



Step 4:

Register the router in main.py.



Step 5:

Restart the Gateway Docker container.



====================================================
6. IMPORTANT NOTES
====================================================


- Gateway is the single entry point for all frontend API requests.
- Frontend communicates only with Gateway.
- Backend Docker services are accessed through Gateway routing.
- Business logic is not handled inside Gateway.
- Gateway only manages API routing and communication between services.
- All service-specific routing logic is maintained inside the routes folder.


====================================================
END OF GATEWAY ROUTING DOCUMENTATION
====================================================