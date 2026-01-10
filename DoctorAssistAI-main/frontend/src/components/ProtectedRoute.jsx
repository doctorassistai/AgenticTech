import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";

export default function ProtectedRoute({ children }) {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    fetch("http://demo.doctorassist.ai/api/hms/users/auth/verify", {
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
