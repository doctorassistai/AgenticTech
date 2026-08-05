====================================================
FRONTEND APPLICATION REQUIREMENTS DOCUMENTATION
====================================================

Application Type:
- React based frontend application
- Build tool: Vite
- Language: JavaScript / JSX
- Container: Docker

====================================================
1. FRONTEND PROJECT STRUCTURE
====================================================

The frontend application contains the following main folders:

frontend/
│
├── node_modules/
│   - Contains all installed npm dependencies.
│   - Generated automatically after running npm install.
│
├── public/
│   - Contains static HTML pages and public assets.
│   - HTML pages placed inside this folder can be accessed directly using the URL.
│
├── src/
│   - Main React source code folder.
│   - Contains all React components, pages, routing logic, styling, and application logic.
│
├── package.json
│   - Contains project dependencies and npm scripts.
│
├── vite.config.js
│   - Vite configuration file.
│
├── Dockerfile
│   - Used to create the frontend Docker image.
│
└── index.html
    - Main entry HTML file loaded by React.


====================================================
2. PUBLIC FOLDER MANAGEMENT
====================================================

Location:

frontend/public/


Purpose:
- Stores standalone HTML pages used in the application.
- These pages are not handled through React routing.
- They are directly rendered by the browser.


Adding a New HTML Page:

Steps:

1. Add the HTML file inside the public folder.

Example:

public/
    clinical-dashboard.html


2. Access the page directly using:

https://domain-name.com/clinical-dashboard.html


No additional React routing changes are required for public HTML pages.


Example:

If the file name is:

oncology-clinical-workstation.html


The URL will be:

https://domain-name.com/oncology-clinical-workstation.html



====================================================
3. SRC FOLDER STRUCTURE
====================================================

Location:

frontend/src/


The src folder contains all React application code.


Main folders inside src:

----------------------------------------------------

1. Abha/

Purpose:
- Contains ABHA related React components and pages.

----------------------------------------------------

2. Admin/

Purpose:
- Contains admin dashboard related components and pages.

----------------------------------------------------

3. Assets/

Purpose:
- Contains frontend assets.

Examples:
- Images
- Icons
- Static files
- Fonts

----------------------------------------------------

4. Components/

Purpose:
- Contains reusable React components used throughout the application.

Examples:

- Navbar
- Sidebar
- Modals
- Forms
- Common UI components


----------------------------------------------------

5. Customize/

Purpose:
- Contains customization related frontend modules.

----------------------------------------------------

6. Dashboard/

Purpose:
- Contains dashboard related React pages and components.


----------------------------------------------------

7. Insurance_dashboard/

Purpose:
- Contains insurance dashboard modules.


----------------------------------------------------

8. Login/

Purpose:
- Contains login page components and authentication UI.


----------------------------------------------------

9. Patient_portal/

Purpose:
- Contains patient portal related pages and components.


----------------------------------------------------

10. Register/

Purpose:
- Contains user registration related components.


----------------------------------------------------

11. Webpage/

Purpose:
- Contains general webpage components.


----------------------------------------------------

12. Workflow/

Purpose:
- Contains workflow related frontend modules.



====================================================
4. MAIN REACT INITIALIZATION FILES
====================================================


Main files responsible for React initialization:


----------------------------------------------------

main.jsx

Purpose:

- Application entry point.
- Initializes React.
- Loads App.jsx.
- Mounts React application into index.html.


Flow:

index.html
      |
      |
      v
main.jsx
      |
      |
      v
App.jsx


----------------------------------------------------


App.jsx

Purpose:

- Main application routing file.
- Assigns React components/pages to routes.
- Controls which JSX page loads for each URL.

All new React pages must be registered inside App.jsx.


Example:

Component:

src/dashboard/Dashboard.jsx


Route assignment:

<Route 
 path="/dashboard"
 element={<Dashboard />}
/>


After adding the route:

URL:

https://domain-name.com/dashboard

will load:

Dashboard.jsx



====================================================
5. ADDING A NEW REACT PAGE
====================================================


Steps:

1. Create JSX component inside the required folder.

Example:

src/patient_portal/NewPatient.jsx


2. Import the component inside App.jsx.


Example:

import NewPatient from "./patient_portal/NewPatient";


3. Add route in App.jsx.


Example:

<Route
 path="/new-patient"
 element={<NewPatient />}
/>


4. Restart frontend container if required.



====================================================
6. ROUTING MANAGEMENT
====================================================


All React page navigation is managed through:

App.jsx


Responsibilities:

- Importing page components.
- Defining URLs.
- Assigning components to routes.
- Managing protected/private routes if required.


Any new JSX page must have:

1. Component file.
2. Import statement in App.jsx.
3. Route definition in App.jsx.



====================================================
7. FRONTEND DEVELOPMENT FLOW
====================================================


For adding new features:


Step 1:
Create required JSX components inside src folder.


Step 2:
Add required assets inside src/assets.


Step 3:
Import component into App.jsx.


Step 4:
Create route in App.jsx.


Step 5:
Build and deploy frontend Docker image.



====================================================
8. DOCKER FRONTEND REQUIREMENTS
====================================================


Frontend Docker container requires:


Dependencies:

- Node.js
- npm
- React
- Vite


Installation:

npm install


Development:

npm run dev


Production Build:

npm run build



====================================================
9. DEPLOYMENT NOTES
====================================================


After making frontend changes:


1. Rebuild Docker image:

docker build -t frontend .


2. Restart frontend container:

docker compose up -d frontend


3. Verify frontend URL.



====================================================
10. IMPORTANT NOTES
====================================================


- Public HTML pages do not require App.jsx changes.
- React JSX pages always require App.jsx route registration.
- All reusable UI components should be placed inside src/components.
- All static files should be stored inside assets or public depending on usage.
- Routing logic must always be maintained inside App.jsx.
- Any new module should follow the existing folder structure.



====================================================
END OF FRONTEND REQUIREMENTS DOCUMENT
====================================================