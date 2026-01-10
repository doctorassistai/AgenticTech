import { Routes, Route } from "react-router-dom";
import HospitalRegister from "./register/HospitalRegister";
import Customization from "./customize/settings";
import Login from "./login/login";
// import DoctorDashboard from "./dashboard/DoctorDashboard";
import HospitalDashboard from "./dashboard/HospitalDashboard";
import RegisterDoctor from "./register/RegisterDoctor";
import PatientProfile from "./dashboard/patientprofile";
import DoctorDashboard from "./dashboard/doctordashboard";
import RegisterPatient from "./register/patientregister";
import Dashboard from "./components/dashboard";
import Appointments from "./dashboard/Appointments";
import AdminDashboard from "./dashboard/AdminDashboard";
import VoiceAgentPage from "./dashboard/Conversation";
function App() {
  return (
    <Routes>
      <Route path="/" element={<h1>Home Page</h1>} />
      <Route path="/login" element={<Login />} />
      <Route path="/hospital-register" element={<HospitalRegister />} />
      <Route path="/customization" element={<Customization />} />
         {/* <Route path="/doctor-dashboard" element={<DoctorDashboard />} /> */}
      <Route path="/hospital-dashboard" element={<HospitalDashboard />
        // </ProtectedRoute>
        } /> 
        <Route path="/patient-profile" element={<PatientProfile />} />
        <Route path="/register-doctor" element={<RegisterDoctor />} />
        <Route path="/doctor-dashboard" element={<DoctorDashboard />} />
        <Route path="/register-patient" element={<RegisterPatient />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/admin-dashboard" element={<AdminDashboard />} />
        <Route path="/voice-agent" element={<VoiceAgentPage />} />
    </Routes>
  );
}

export default App;  // <-- MUST be here
