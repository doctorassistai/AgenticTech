import React, { useEffect, useRef, useState } from "react";

/**
 * AuthRedirect
 * -------------------------------------------------------------
 * URL is expected to carry three query params, e.g.:
 *   /auth?doctorId=123&hospitalId=456&token=eyJhbGciOi...
 *
 * On mount it:
 *   1. Reads doctorId, hospitalId, token from the URL.
 *   2. Calls POST {API_BASE_URL}/hms/integration/system/login-verify
 *      - Authorization: Bearer <token>
 *      - body: { hospital_id, doctor_id }   <-- snake_case, matches backend
 *   3. On success, reads dashboard_url from the response and does a
 *      hard redirect with window.location.replace(...) so this page
 *      is swapped out of browser history (no "back" into it).
 *   4. On failure, shows an error state (no redirect happens).
 * -------------------------------------------------------------
 */

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api";
const LOGIN_VERIFY_PATH = "/hms/integration/system/login-verify";

const MESSAGE = "Authenticating and redirecting to session";

export default function AuthRedirect() {
  const [status, setStatus] = useState("loading"); // 'loading' | 'error'
  const [errorMsg, setErrorMsg] = useState("");
  const hasRun = useRef(false);

  useEffect(() => {
    // Guard against React 18 StrictMode double-invoking effects in dev
    if (hasRun.current) return;
    hasRun.current = true;

    const params = new URLSearchParams(window.location.search);
    const doctorId = params.get("doctorId");
    const hospitalId = params.get("hospitalId");
    const token = params.get("token");

    if (!doctorId || !hospitalId || !token) {
      setStatus("error");
      setErrorMsg("Missing doctorId, hospitalId, or token in the URL.");
      return;
    }

    const verifyAndRedirect = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}${LOGIN_VERIFY_PATH}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          // NOTE: backend reads hospital_id / doctor_id (snake_case) —
          // this must match request.json() keys in the FastAPI route exactly.
          body: JSON.stringify({
            hospital_id: hospitalId,
            doctor_id: doctorId,
          }),
        });

        let data = null;
        try {
          data = await response.json();
        } catch {
          // response had no/invalid JSON body
        }

        if (!response.ok) {
          const detail = data?.detail || `Request failed with status ${response.status}`;
          throw new Error(detail);
        }

        // Backend returns "dashboard_url" on success.
        const redirectUrl = data?.dashboard_url || data?.redirectUrl || data?.url;

if (!redirectUrl) {
  throw new Error("No redirect URL returned by the server.");
}

// Fetch hospital theme using doctor's sys_user_id
try {
  const themeResponse = await fetch(
    `${API_BASE_URL}/hms/users/data/context/doctor/themes/${doctorId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (themeResponse.ok) {
    const themeData = await themeResponse.json();

    localStorage.setItem(
      "theme",
      themeData.theme_name || "BlackWhite"
    );
  } else {
    localStorage.setItem("theme", "BlackWhite");
  }
} catch (err) {
  console.error("Failed to fetch theme:", err);
  localStorage.setItem("theme", "BlackWhite");
}

// Now redirect
window.location.replace(redirectUrl);
      } catch (err) {
        setStatus("error");
        setErrorMsg(err.message || "Something went wrong. Please try again.");
      }
    };

    verifyAndRedirect();
  }, []);

  return (
    <div style={styles.page}>
      <style>{keyframes}</style>

      {status === "loading" && (
        <div style={styles.textRow} aria-live="polite" aria-busy="true">
          {MESSAGE.split("").map((char, i) => (
            <span
              key={i}
              style={{
                ...styles.letter,
                animationDelay: `${i * 0.045}s`,
              }}
            >
              {char === " " ? "\u00A0" : char}
            </span>
          ))}
        </div>
      )}

      {status === "error" && (
        <div style={styles.errorBox} role="alert">
          <p style={styles.errorTitle}>Unable to authenticate</p>
          <p style={styles.errorDetail}>{errorMsg}</p>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    width: "100vw",
    height: "100vh",
    background: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 0,
    padding: "0 24px",
    boxSizing: "border-box",
  },
  textRow: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: 520,
  },
  letter: {
    display: "inline-block",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: 20,
    fontWeight: 500,
    letterSpacing: "0.02em",
    color: "#1a1a1a",
    animationName: "breathe",
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  errorBox: {
    textAlign: "center",
    maxWidth: 420,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: "#1a1a1a",
    margin: "0 0 8px",
  },
  errorDetail: {
    fontSize: 14,
    color: "#6b6b6b",
    margin: 0,
    lineHeight: 1.5,
  },
};

const keyframes = `
@keyframes breathe {
  0%, 100% { opacity: 0.25; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  span { animation: none !important; opacity: 1 !important; }
}
`;