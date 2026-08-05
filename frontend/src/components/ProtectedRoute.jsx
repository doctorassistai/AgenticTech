import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

export default function ProtectedRoute({ children }) {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}hms/users/auth/verify`, {
      method: "GET",
      credentials: "include",  // IMPORTANT: send HttpOnly cookies!
    })
      .then(res => {
        if (res.status === 200) setAuth(true);
        else setAuth(false);
      })
      .catch(() => setAuth(false));
  }, []);

  if (auth === null) return <p>Checking authentication...</p>;

  return auth ? children : <Navigate to="/login" replace />;
}
