import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children, allowedRoles }) {

  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/" replace />;
  }

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const role = payload.role;

    if (allowedRoles && !allowedRoles.includes(role)) {
      return <Navigate to="/" replace />;
    }

    return children;

  } catch {
    return <Navigate to="/" replace />;
  }
}