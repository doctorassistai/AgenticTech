import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const InfoCell = ({ label, value }) => (
  <div className="info-cell">
    <div className="info-cell-label">{label}</div>
    <div className="info-cell-value">{value || "—"}</div>
  </div>
);

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [qrCode, setQrCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [abhaCardUrl, setAbhaCardUrl] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [cardType, setCardType] = useState(""); // "pdf" or "image"
  const [qrLoading, setQrLoading] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  const [sharesOpen, setSharesOpen] = useState(false);
  const [incomingShares, setIncomingShares] = useState([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [sharesError, setSharesError] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSetting, setActiveSetting] = useState(null); // "mobile" | "email" | "deactivate" | "delete" | "reactivate" | null
  const [activeMethod, setActiveMethod] = useState(null); // "aadhaar" | "mobile" | "password" | null
  const [settingStep, setSettingStep] = useState("input"); // "method" | "input" | "otp" | "password" | "done"
  const [settingValue, setSettingValue] = useState("");
  const [settingPassword, setSettingPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
const [newPassword, setNewPassword] = useState("");
  const [settingOtp, setSettingOtp] = useState("");
  const [settingTxnId, setSettingTxnId] = useState("");
  const [settingLoading, setSettingLoading] = useState(false);
  const [settingError, setSettingError] = useState("");
  const [settingMessage, setSettingMessage] = useState("");

  const ACTIONS_WITH_METHODS = ["deactivate", "delete", "reactivate"];

  const xToken = localStorage.getItem("xToken");
  const txnId = localStorage.getItem("txnId");
  const headers = {
    "X-Token": `Bearer ${xToken}`,
    "Content-Type": "application/json",
  };

  // ── Re-KYC ──
  const [rekycRequired, setRekycRequired] = useState(false);
  const [rekycOpen, setRekycOpen] = useState(false);
  const [rekycStep, setRekycStep] = useState("confirm"); // "confirm" | "otp" | "done"
  const [rekycAbhaNumber, setRekycAbhaNumber] = useState("");
  const [rekycTxnId, setRekycTxnId] = useState("");
  const [rekycOtp, setRekycOtp] = useState("");
  const [rekycLoading, setRekycLoading] = useState(false);
  const [rekycError, setRekycError] = useState("");

  // ── Silent token refresh ──
  const refreshXToken = async () => {
    const storedRefreshToken = localStorage.getItem("refreshToken");
    if (!storedRefreshToken) return null;
    try {
      // Backend reads the refresh token off an "R-Token" header on a GET —
      // not a JSON body (GET requests can't carry one in fetch anyway).
      const res = await fetch(`${API_BASE_URL}abha/profile/refresh-token`, {
        method: "GET",
        headers: { "R-Token": `Bearer ${storedRefreshToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newXToken = data["X-token"] || data.token;
      if (!newXToken) return null;
      localStorage.setItem("xToken", newXToken);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      if (data.expiresIn) {
        localStorage.setItem("tokenIssuedAt", Date.now().toString());
        localStorage.setItem("tokenExpiresIn", data.expiresIn.toString());
      }
      return newXToken;
    } catch {
      return null;
    }
  };

  // Retries once with a refreshed token on 401; forces re-login if refresh fails.
  const authFetch = async (url, options = {}) => {
    let res = await fetch(url, options);
    if (res.status === 401) {
      const newToken = await refreshXToken();
      if (newToken) {
        const retryHeaders = { ...(options.headers || {}) };
        if (retryHeaders["X-Token"]) retryHeaders["X-Token"] = `Bearer ${newToken}`;
        res = await fetch(url, { ...options, headers: retryHeaders });
      } else {
        localStorage.clear();
        navigate("/login-abha", { replace: true });
      }
    }
    return res;
  };

  // Proactively refresh a minute before expiry so the session never lapses mid-use.
  useEffect(() => {
    const issuedAt = Number(localStorage.getItem("tokenIssuedAt"));
    const expiresIn = Number(localStorage.getItem("tokenExpiresIn"));
    if (!issuedAt || !expiresIn) return;
    const msUntilRefresh = Math.max((issuedAt + expiresIn * 1000) - Date.now() - 60000, 0);
    const timer = setTimeout(() => { refreshXToken(); }, msUntilRefresh);
    return () => clearTimeout(timer);
  }, [xToken]);

  useEffect(() => {
    if (!xToken) { 
      navigate("/login-abha", { replace: true }); 
      return;
    }
    loadProfile();
  }, []);

  // Revoke the blob URL whenever it changes or the component unmounts,
  // using the current value instead of the stale one captured at mount.
  useEffect(() => {
    return () => {
      if (abhaCardUrl) {
        URL.revokeObjectURL(abhaCardUrl);
      }
    };
  }, [abhaCardUrl]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_BASE_URL}abha/profile`, {
        headers: { "X-Token": `Bearer ${localStorage.getItem("xToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      const profileData = await res.json();
      setProfile(profileData);

      // ABDM flags Re-KYC either as a boolean or inside verificationStatus — check both.
      const needsRekyc = profileData.reKycRequired === true
        || /re-?kyc/i.test(profileData.verificationStatus || "");
      setRekycRequired(needsRekyc);
      if (needsRekyc) setRekycAbhaNumber(profileData.ABHANumber || "");

      // Automatically download ABHA card after profile loads
      await autoDownloadAbhaCard();
    } catch (err) { 
      setError(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

    // Scans a canvas and crops away any blank/white border, so only the
  // actual printed card content remains.
  const trimWhitespace = (canvas, threshold = 250) => {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);

    let top = 0, bottom = height - 1, left = 0, right = width - 1;

    const isRowBlank = (y) => {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) return false;
      }
      return true;
    };
    const isColBlank = (x) => {
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) return false;
      }
      return true;
    };

    while (top < bottom && isRowBlank(top)) top++;
    while (bottom > top && isRowBlank(bottom)) bottom--;
    while (left < right && isColBlank(left)) left++;
    while (right > left && isColBlank(right)) right--;

    const trimmedWidth = right - left + 1;
    const trimmedHeight = bottom - top + 1;

    const trimmedCanvas = document.createElement("canvas");
    trimmedCanvas.width = trimmedWidth;
    trimmedCanvas.height = trimmedHeight;
    trimmedCanvas.getContext("2d").drawImage(
      canvas, left, top, trimmedWidth, trimmedHeight, 0, 0, trimmedWidth, trimmedHeight
    );
    return trimmedCanvas;
  };

  // The ABHA card image has the front card on the top half and the
  // instructions/back card on the bottom half, with blank space around
  // and between them. Split down the middle, then trim each half's own
  // whitespace so each side fills its own page cleanly.
  const splitCardImageIntoPages = (img) => {
    const midpoint = Math.floor(img.height / 2);

    const topCanvas = document.createElement("canvas");
    topCanvas.width = img.width;
    topCanvas.height = midpoint;
    topCanvas.getContext("2d").drawImage(img, 0, 0, img.width, midpoint, 0, 0, img.width, midpoint);

    const bottomCanvas = document.createElement("canvas");
    bottomCanvas.width = img.width;
    bottomCanvas.height = img.height - midpoint;
    bottomCanvas.getContext("2d").drawImage(
      img, 0, midpoint, img.width, img.height - midpoint, 0, 0, img.width, img.height - midpoint
    );

    return [trimWhitespace(topCanvas), trimWhitespace(bottomCanvas)];
  };

  const imageUrlToPdfUrl = (imageUrl) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const pages = splitCardImageIntoPages(img);

          // Scale each trimmed card up to a comfortable, consistent print
          // width while keeping its own aspect ratio.
          const TARGET_WIDTH_PT = 560;

          let pdf;
          pages.forEach((canvas, index) => {
            const aspect = canvas.height / canvas.width;
            const pageWidth = TARGET_WIDTH_PT;
            const pageHeight = TARGET_WIDTH_PT * aspect;
            const orientation = pageWidth > pageHeight ? "landscape" : "portrait";

            if (index === 0) {
              pdf = new jsPDF({ unit: "pt", format: [pageWidth, pageHeight], orientation });
            } else {
              pdf.addPage([pageWidth, pageHeight], orientation);
            }

            pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, pageHeight);
          });

          const pdfBlob = pdf.output("blob");
          resolve(URL.createObjectURL(pdfBlob));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = imageUrl;
    });

  const [cardError, setCardError] = useState("");

  const autoDownloadAbhaCard = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}abha/profile/abha-card`, {
        headers: { "X-Token": `Bearer ${xToken}` },
      });

      console.log("[ABHA Card] HTTP status:", res.status);
      console.log("[ABHA Card] Content-Type:", res.headers.get("content-type"));
      console.log("[ABHA Card] Content-Length:", res.headers.get("content-length"));

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[ABHA Card] Error response body:", text);
        throw new Error(`Failed to download card (status ${res.status})`);
      }

      const blob = await res.blob();
      console.log("[ABHA Card] Blob type:", blob.type, "| size:", blob.size, "bytes");

      // ABDM's sandbox can return the card as either a PDF or a PNG image —
      // accept both instead of hard-requiring PDF.
      const isPdf = blob.type === "application/pdf";
      const isImage = blob.type.startsWith("image/");
      if ((!isPdf && !isImage) || blob.size === 0) {
        const preview = await blob.text().catch(() => "");
        console.error("[ABHA Card] Unexpected payload preview:", preview.slice(0, 500));
        throw new Error(`Server did not return a valid ABHA card (got "${blob.type}", ${blob.size} bytes)`);
      }

      const url = URL.createObjectURL(blob);
      setAbhaCardUrl(url);
      setCardType(isPdf ? "pdf" : "image");
      setCardError("");
    } catch (err) { 
      console.error("Auto download failed:", err);
      setCardError(err.message || "Could not load ABHA card");
    }
  };

  const downloadAbhaCard = async () => {
    try {
      setIsDownloading(true);

      const triggerDownload = (url, ext) => {
        const link = document.createElement("a");
        link.href = url;
        link.download = `ABHA-Card-${profile?.ABHANumber || "profile"}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };

      const downloadAsPdf = async (imageUrl) => {
        const pdfUrl = await imageUrlToPdfUrl(imageUrl);
        triggerDownload(pdfUrl, "pdf");
        // Clean up the temporary PDF blob URL shortly after triggering the download
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 5000);
      };

      if (abhaCardUrl) {
        if (cardType === "pdf") {
          triggerDownload(abhaCardUrl, "pdf");
        } else {
          await downloadAsPdf(abhaCardUrl);
        }
      } else {
        const res = await fetch(`${API_BASE_URL}abha/profile/abha-card`, {
          headers: { "X-Token": `Bearer ${xToken}` },
        });
        if (!res.ok) throw new Error("Failed to download card");

        const blob = await res.blob();
        const isPdf = blob.type === "application/pdf";
        const url = URL.createObjectURL(blob);
        setAbhaCardUrl(url);
        setCardType(isPdf ? "pdf" : "image");

        if (isPdf) {
          triggerDownload(url, "pdf");
        } else {
          await downloadAsPdf(url);
        }
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const loadQrCode = async () => {
    try {
      setQrLoading(true);
      // Clear any previously loaded QR so a stale image can never be shown
      // while the fresh one is being fetched, or if this fetch fails.
      setQrCode("");
      const res = await fetch(`${API_BASE_URL}abha/profile/qrcode`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load QR code");
      const data = await res.json();
      setQrCode(data.qrCode);
      setShowQr(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setQrLoading(false);
    }
  };

  const loadIncomingShares = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}abha/profile/share/incoming`);
      if (!res.ok) throw new Error("Failed to load incoming shares");
      const data = await res.json();
      setIncomingShares(data.shares || []);
      setSharesError("");
    } catch (err) {
      setSharesError(err.message);
    } finally {
      setSharesLoading(false);
    }
  };

  useEffect(() => {
    if (!sharesOpen) return;
    setSharesLoading(true);
    loadIncomingShares();
    const interval = setInterval(loadIncomingShares, 5000);
    return () => clearInterval(interval);
  }, [sharesOpen]);

  const copyAbhaAddress = async () => {
    if (!profile?.preferredAbhaAddress) return;
    try {
      await navigator.clipboard.writeText(profile.preferredAbhaAddress);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch (err) {
      alert("Could not copy address");
    }
  };

  const shareAbhaProfile = async () => {
    if (!profile?.preferredAbhaAddress) return;
    const shareText = `Here is my ABHA address: ${profile.preferredAbhaAddress}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "My ABHA Profile", text: shareText });
      } catch (err) {
        // user cancelled the share sheet — no-op
      }
    } else {
      copyAbhaAddress();
    }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        setLoading(true);
        const base64 = reader.result.split(",")[1];
        const res = await fetch(`${API_BASE_URL}abha/profile/photo`, {
          method: "PUT", headers,
          body: JSON.stringify({ profilePhoto: base64 }),
        });
        if (!res.ok) throw new Error("Upload failed");
        loadProfile();
      } catch (err) { alert(err.message); }
      finally { setLoading(false); }
    };
    reader.readAsDataURL(file);
  };

  const resetSettingForm = () => {
    setSettingStep("input");
    setActiveMethod(null);
    setSettingValue("");
    setSettingPassword("");
    setSettingOtp("");
    setSettingTxnId("");
    setSettingError("");
    setSettingMessage("");
  };

  const openSetting = (type) => {
    setActiveSetting(type);
    resetSettingForm();
    setSettingStep(ACTIONS_WITH_METHODS.includes(type) ? "method" : "input");
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    setActiveSetting(null);
    resetSettingForm();
  };

  const chooseMethod = (method) => {
    setActiveMethod(method);
    setSettingError("");
    setSettingStep(method === "password" ? "password" : "input");
  };

  const handleBack = () => {
    if (ACTIONS_WITH_METHODS.includes(activeSetting) && activeMethod) {
      setActiveMethod(null);
      setSettingValue("");
      setSettingPassword("");
      setSettingOtp("");
      setSettingError("");
      setSettingStep("method");
    } else {
      setActiveSetting(null);
      resetSettingForm();
    }
  };

  const finishSettingAction = (data) => {
    setSettingMessage(data.message || "Done");
    setSettingStep("done");

    if (activeSetting === "deactivate" || activeSetting === "delete") {
      setTimeout(() => logout(), 1500);
    } else if (activeSetting === "reactivate" && data.token) {
      localStorage.setItem("xToken", data.token);
    } else if (activeSetting === "mobile" || activeSetting === "email") {
      loadProfile();
    }
  };
const changePassword = async () => {
  if (!oldPassword.trim()) {
    setSettingError("Enter your current password");
    return;
  }

  if (!newPassword.trim()) {
    setSettingError("Enter your new password");
    return;
  }

  if (oldPassword === newPassword) {
    setSettingError(
      "New password must be different from current password"
    );
    return;
  }

  try {
    setSettingLoading(true);
    setSettingError("");
    setSettingMessage("");

    const res = await fetch(
      `${API_BASE_URL}abha/profile/change-password`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          oldPassword: oldPassword.trim(),
          newPassword: newPassword.trim(),
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error(
        data.detail ||
        data.message ||
        "Failed to change password"
      );
    }

    setSettingMessage(
      data.message || "Password changed successfully"
    );

    setOldPassword("");
    setNewPassword("");

    setSettingStep("done");

  } catch (err) {
    setSettingError(err.message);
  } finally {
    setSettingLoading(false);
  }
};
  const sendSettingOtp = async () => {
    if ((activeSetting === "mobile" || activeSetting === "email" || activeSetting === "reactivate") && !settingValue.trim()) {
      setSettingError(
        activeSetting === "mobile" ? "Enter a mobile number" :
        activeSetting === "email" ? "Enter an email address" :
        "Enter an ABHA number"
      );
      return;
    }
    try {
      setSettingLoading(true);
      setSettingError("");

      let endpoint, body;
      if (activeSetting === "mobile") {
        endpoint = "abha/profile/mobile/request-otp";
        body = { mobile_number: settingValue.trim() };
      } else if (activeSetting === "email") {
        endpoint = "abha/profile/email/request-otp";
        body = { email: settingValue.trim() };
      } else if (activeSetting === "deactivate") {
        endpoint = `abha/profile/deactivate/${activeMethod}/request-otp`;
        body = { abha_number: profile.ABHANumber };
      } else if (activeSetting === "delete") {
        endpoint = `abha/profile/delete/${activeMethod}/request-otp`;

        body = { abha_number: profile.ABHANumber };
        console.log("DELETE REQUEST");
        console.log("Endpoint:", endpoint);
        console.log("Payload:", body);
        console.log("Headers:", headers);
      } else {
        endpoint = `abha/auth/reactivate/${activeMethod}/request-otp`;
        body = { abha_number: settingValue.trim() };
      }

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || "Failed to send OTP");
      setSettingTxnId(data.txnId);
      setSettingMessage(data.message || "OTP sent");
      setSettingStep("otp");
    } catch (err) {
      setSettingError(err.message);
    } finally {
      setSettingLoading(false);
    }
  };

  const verifySettingOtp = async () => {
    if (!settingOtp.trim()) {
      setSettingError("Enter the OTP");
      return;
    }
    try {
      setSettingLoading(true);
      setSettingError("");

      let endpoint, body;
      if (activeSetting === "mobile") {
        endpoint = "abha/profile/mobile/verify-otp";
        body = { txnId: settingTxnId, otp: settingOtp.trim() };
      } else if (activeSetting === "email") {
        endpoint = "abha/profile/email/verify-otp";
        body = { txnId: settingTxnId, otp: settingOtp.trim() };
      } else if (activeSetting === "deactivate") {
        endpoint = `abha/profile/deactivate/${activeMethod}/verify-otp`;
        body = { txnId: settingTxnId, otp: settingOtp.trim(), reasons: [settingValue.trim() || "User requested"] };
      } else if (activeSetting === "delete") {
        endpoint = `abha/profile/delete/${activeMethod}/verify-otp`;
        body = { txnId: settingTxnId, otp: settingOtp.trim(), reasons: [settingValue.trim() || "User requested"] };
      } else {
        endpoint = `abha/auth/reactivate/${activeMethod}/verify-otp`;
        body = { txnId: settingTxnId, otp: settingOtp.trim() };
      }

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || "Verification failed");
      finishSettingAction(data);
    } catch (err) {
      setSettingError(err.message);
    } finally {
      setSettingLoading(false);
    }
  };

  const submitSettingPassword = async () => {
    if (!settingPassword.trim()) {
      setSettingError("Enter your password");
      return;
    }
    if (activeSetting === "reactivate" && !settingValue.trim()) {
      setSettingError("Enter an ABHA number");
      return;
    }
    try {
      setSettingLoading(true);
      setSettingError("");

      let endpoint, body;
      if (activeSetting === "deactivate") {
        endpoint = "abha/profile/deactivate/password";
        body = { password: settingPassword.trim(), reasons: [settingValue.trim() || "User requested"] };
      } else if (activeSetting === "delete") {
        endpoint = "abha/profile/delete/password";
        body = { password: settingPassword.trim(), reasons: [settingValue.trim() || "User requested"] };
      } else {
        endpoint = "abha/auth/reactivate/password";
        body = { abha_number: settingValue.trim(), password: settingPassword.trim() };
      }

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || "Verification failed");
      finishSettingAction(data);
    } catch (err) {
      setSettingError(err.message);
    } finally {
      setSettingLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (xToken) {
        await fetch(`${API_BASE_URL}abha/profile/logout`, {
          method: "POST",
          headers: { "X-Token": `Bearer ${xToken}` },
        });
      }
    } catch (err) {
      console.error("Logout call failed, clearing session locally anyway:", err);
    }
    // Clean up object URL before logging out
    if (abhaCardUrl) {
      URL.revokeObjectURL(abhaCardUrl);
    }
    localStorage.clear();
    navigate("/login-abha", { replace: true });
  };

  /* ── Re-KYC flow ── */
  const resetRekycForm = () => {
    setRekycStep("confirm");
    setRekycTxnId(""); setRekycOtp(""); setRekycError("");
  };

  const openRekyc = () => { resetRekycForm(); setRekycAbhaNumber(profile?.ABHANumber || ""); setRekycOpen(true); };
  const closeRekyc = () => { setRekycOpen(false); resetRekycForm(); };

  const rekycRequestOtp = async () => {
    if (!rekycAbhaNumber.trim()) { setRekycError("Enter your ABHA number"); return; }
    setRekycLoading(true); setRekycError("");
    try {
      const res = await authFetch(`${API_BASE_URL}abha/profile/rekyc/request-otp`, {
        method: "POST", headers,
        body: JSON.stringify({ abha_number: rekycAbhaNumber.replace(/\D/g, "") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || "Failed to send OTP");
      setRekycTxnId(data.txnId);
      setRekycStep("otp");
    } catch (err) {
      setRekycError(err.message);
    } finally {
      setRekycLoading(false);
    }
  };

  const rekycVerifyOtp = async () => {
    if (!rekycOtp.trim()) { setRekycError("Enter the OTP"); return; }
    setRekycLoading(true); setRekycError("");
    try {
      const res = await authFetch(`${API_BASE_URL}abha/profile/rekyc/verify-otp`, {
        method: "POST", headers,
        body: JSON.stringify({ txnId: rekycTxnId, otp: rekycOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || "Re-KYC verification failed");
      setRekycStep("done");
      setRekycRequired(false);
      loadProfile();
    } catch (err) {
      setRekycError(err.message);
    } finally {
      setRekycLoading(false);
    }
  };

  const initials = profile?.name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const dob = profile ? `${profile.dayOfBirth}-${profile.monthOfBirth}-${profile.yearOfBirth}` : "—";
  const gender = profile?.gender === "M" ? "Male" : profile?.gender === "F" ? "Female" : "Other";

  if (loading) return (
    <div className="state-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Open Sans',system-ui,sans-serif;font-weight:300;background:#fafafa;color:#000;}
        .state-screen{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#fafafa;}
        .spinner{width:24px;height:24px;border:1px solid #e0e0e0;border-top-color:#000;border-radius:50%;animation:spin 0.8s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .state-label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.15em;color:#888;}
      `}</style>
      <div className="spinner" />
      <p className="state-label">Loading profile</p>
    </div>
  );

  if (error) return (
    <div className="state-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Open Sans',system-ui,sans-serif;font-weight:300;background:#fafafa;color:#000;}
        .state-screen{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#fafafa;padding:2rem;}
        .error-box{border:1px solid #e0e0e0;background:#fff;padding:2rem;max-width:400px;width:100%;}
        .error-eyebrow{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.15em;color:#c00;margin-bottom:0.75rem;}
        .error-msg{font-size:0.875rem;color:#444;margin-bottom:1.5rem;line-height:1.7;}
        .btn-primary{display:block;width:100%;padding:0.875rem;background:#000;color:#fff;font-family:'Open Sans',system-ui,sans-serif;font-size:0.875rem;font-weight:400;border:1px solid #000;cursor:pointer;transition:all 0.2s;}
        .btn-primary:hover{background:transparent;color:#000;}
      `}</style>
      <div className="error-box">
        <p className="error-eyebrow">Error</p>
        <p className="error-msg">{error}</p>
        <button className="btn-primary" onClick={logout}>Login again →</button>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body { font-family: 'Open Sans', system-ui, sans-serif; font-weight: 300; background: #fafafa; color: #000; -webkit-font-smoothing: antialiased; }

        /* ── Nav ── */
        .profile-nav { padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e0e0e0; background: #fff; position: sticky; top: 0; z-index: 100; }
        .nav-logo { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; color: #000; }
        .nav-right { display: flex; align-items: center; gap: 1.5rem; }
        .nav-tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; color: #888; }
        .btn-logout { padding: 0.5rem 1rem; background: transparent; border: 1px solid #e0e0e0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.75rem; font-weight: 400; cursor: pointer; color: #000; transition: all 0.2s; }
        .btn-logout:hover { border-color: #000; }

        /* ── Layout ── */
        .profile-main { max-width: 1100px; margin: 0 auto; padding: 2.5rem 2rem; }

        /* ── Hero ── */
        .profile-hero { display: grid; grid-template-columns: auto 1fr; gap: 2rem; align-items: center; border: 1px solid #e0e0e0; background: #fff; padding: 2rem; margin-bottom: 2.5rem; }
        .avatar { width: 96px; height: 96px; background: #000; display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 400; color: #fff; flex-shrink: 0; position: relative; cursor: pointer; overflow: hidden; }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-overlay { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.65); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.08em; color: #fff; text-align: center; padding: 4px 0; opacity: 0; transition: opacity 0.2s; }
        .avatar:hover .avatar-overlay { opacity: 1; }
        .profile-name { font-size: 1.75rem; font-weight: 300; letter-spacing: -0.02em; margin-bottom: 0.35rem; }
        .abha-number { font-size: 0.78rem; color: #888; letter-spacing: 0.08em; margin-bottom: 0.75rem; font-family: monospace; }
        .verified-badge { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; padding: 0.25rem 0.65rem; border: 1px solid #000; color: #000; }
        .badge-dot { width: 5px; height: 5px; background: #000; border-radius: 50%; flex-shrink: 0; }

        /* ── Section label ── */
        .section-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 1rem; font-weight: 400; }

        /* ── Info grid ── */
        .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); border: 1px solid #e0e0e0; background: #fff; margin-bottom: 2.5rem; }
        .info-cell { padding: 1.25rem; border-right: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; transition: background 0.15s; }
        .info-cell:hover { background: #fafafa; }
        .info-cell-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.4rem; }
        .info-cell-value { font-size: 0.875rem; color: #000; font-weight: 400; word-break: break-word; }

        /* ── Address ── */
        .address-block { border: 1px solid #e0e0e0; background: #fff; padding: 1.5rem; margin-bottom: 2.5rem; }
        .address-text { font-size: 0.875rem; color: #444; line-height: 1.8; }

        /* ── ABHA Card Preview ── */
        .card-preview { border: 1px solid #e0e0e0; background: #fff; margin-bottom: 2.5rem; overflow: hidden; }
        .card-header { background: #000; color: #fff; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; }
        .card-header h3 { font-size: 0.875rem; font-weight: 400; letter-spacing: 0.05em; margin: 0; }
        .card-badge { font-size: 0.7rem; background: rgba(255,255,255,0.2); padding: 0.25rem 0.75rem; border-radius: 2px; }
        .card-content { padding: 2rem; background: #f9f9f9; text-align: center; }
        .card-content.no-padding { padding: 0; }
        .card-content iframe, .card-content embed { width: 100%; height: 500px; border: none; border: 1px solid #e0e0e0; background: #fff; }
        .card-download-btn { margin-top: 1rem; display: inline-block; padding: 0.75rem 1.5rem; background: #000; color: #fff; border: none; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; cursor: pointer; transition: opacity 0.2s; }
        .card-download-btn:hover { opacity: 0.9; }
        .card-download-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Actions ── */
        .actions { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #e0e0e0; margin-bottom: 2.5rem; }
        .action-btn { padding: 1.5rem 2rem; background: #fff; border: none; border-right: 1px solid #e0e0e0; cursor: pointer; text-align: left; transition: background 0.15s; font-family: 'Open Sans', system-ui, sans-serif; }
        .action-btn:last-child { border-right: none; }
        .action-btn:hover { background: #fafafa; }
        .action-btn-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.35rem; }
        .action-btn-title { font-size: 0.95rem; font-weight: 400; color: #000; margin-bottom: 0.25rem; }
        .action-btn-arrow { font-size: 0.75rem; color: #888; }

        /* ── QR modal ── */
        .qr-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem; }
        .qr-modal { background: #fff; border: 1px solid #e0e0e0; padding: 2.5rem; max-width: 400px; width: 100%; position: relative; }
        .qr-close { position: absolute; top: 1rem; right: 1rem; background: transparent; border: 1px solid #e0e0e0; width: 32px; height: 32px; cursor: pointer; font-size: 0.875rem; font-family: inherit; transition: border-color 0.2s; display: flex; align-items: center; justify-content: center; }
        .qr-close:hover { border-color: #000; }
        .qr-eyebrow { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 1.5rem; }
        .qr-image { width: 100%; display: block; border: 1px solid #e0e0e0; }
        .qr-note { font-size: 0.72rem; color: #888; margin-top: 1.25rem; line-height: 1.7; }
        .qr-address-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-top: 1.25rem; padding: 0.75rem; border: 1px solid #e0e0e0; background: #fafafa; }
        .qr-address-text { font-size: 0.78rem; font-family: monospace; color: #000; word-break: break-all; }
        .qr-copy-btn { flex-shrink: 0; padding: 0.4rem 0.75rem; background: transparent; border: 1px solid #000; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.68rem; cursor: pointer; transition: all 0.2s; }
        .qr-copy-btn:hover { background: #000; color: #fff; }
        .qr-share-btn { width: 100%; margin-top: 0.75rem; padding: 0.75rem; background: #000; color: #fff; border: none; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.82rem; cursor: pointer; transition: opacity 0.2s; }
        .qr-share-btn:hover { opacity: 0.9; }

        /* ── Incoming shares drawer ── */
        .shares-drawer { width: 480px; }
        .shares-empty { padding: 2.5rem 1rem; text-align: center; color: #888; font-size: 0.85rem; }
        .shares-error-text { color: #c00; font-size: 0.82rem; padding: 1rem 0; }
        .share-card { border: 1px solid #e0e0e0; padding: 1rem 1.25rem; margin-bottom: 0.75rem; }
        .share-card-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
        .share-card-name { font-size: 0.9rem; font-weight: 400; }
        .share-card-time { font-size: 0.65rem; color: #888; }
        .share-card-row { font-size: 0.78rem; color: #444; margin-top: 0.2rem; }
        .share-card-row span { color: #888; }

        /* ── Settings sidebar ── */
        .settings-trigger { padding: 0.5rem 1rem; background: transparent; border: 1px solid #e0e0e0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.75rem; font-weight: 400; cursor: pointer; color: #000; transition: all 0.2s; }
        .settings-trigger:hover { border-color: #000; }
        .settings-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.35); z-index: 1000; }
        .settings-drawer { position: fixed; top: 0; right: 0; height: 100%; width: 380px; max-width: 90vw; background: #fff; border-left: 1px solid #e0e0e0; z-index: 1001; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,0.06); }
        .settings-header { padding: 1.5rem 1.75rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e0e0e0; }
        .settings-title { font-size: 0.95rem; font-weight: 400; }
        .settings-close { background: transparent; border: 1px solid #e0e0e0; width: 30px; height: 30px; cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; transition: border-color 0.2s; }
        .settings-close:hover { border-color: #000; }
        .settings-body { padding: 1.75rem; overflow-y: auto; flex: 1; }
        .settings-list { display: flex; flex-direction: column; border: 1px solid #e0e0e0; }
        .settings-item { padding: 1rem 1.25rem; background: #fff; border: none; border-bottom: 1px solid #e0e0e0; text-align: left; cursor: pointer; font-family: 'Open Sans', system-ui, sans-serif; transition: background 0.15s; }
        .settings-item:last-child { border-bottom: none; }
        .settings-item:hover { background: #fafafa; }
        .settings-item-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.3rem; }
        .settings-item-value { font-size: 0.875rem; color: #000; }
        .settings-item-desc { font-size: 0.72rem; color: #888; margin-top: 0.25rem; line-height: 1.5; }
        .settings-back { font-size: 0.72rem; color: #888; background: none; border: none; cursor: pointer; margin-bottom: 1.25rem; padding: 0; font-family: inherit; }
        .settings-back:hover { color: #000; }
        .settings-field-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 0.5rem; display: block; }
        .settings-input { width: 100%; padding: 0.75rem; border: 1px solid #e0e0e0; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; margin-bottom: 1rem; }
        .settings-input:focus { outline: none; border-color: #000; }
        .settings-submit { width: 100%; padding: 0.85rem; background: #000; color: #fff; border: none; font-family: 'Open Sans', system-ui, sans-serif; font-size: 0.875rem; cursor: pointer; transition: opacity 0.2s; }
        .settings-submit:hover { opacity: 0.9; }
        .settings-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .settings-error { font-size: 0.78rem; color: #c00; margin: -0.5rem 0 1rem; line-height: 1.6; }
        .settings-success { font-size: 0.78rem; color: #444; margin: -0.5rem 0 1rem; line-height: 1.6; }
        .settings-done-icon { width: 40px; height: 40px; border: 1px solid #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem; font-size: 1rem; }

        /* ── Responsive ── */
        @media (max-width: 640px) {
          .profile-hero { grid-template-columns: 1fr; justify-items: center; text-align: center; }
          .actions { grid-template-columns: 1fr; }
          .action-btn { border-right: none; border-bottom: 1px solid #e0e0e0; }
          .action-btn:last-child { border-bottom: none; }
          .profile-main { padding: 1.5rem 1rem; }
          .info-grid { grid-template-columns: 1fr 1fr; }
          .card-content embed, .card-content iframe { height: 300px; }
        }
      `}</style>

      <div>
        {/* Nav */}
        <nav className="profile-nav">
          <span className="nav-logo">Doctorassist.AI</span>
          <div className="nav-right">
            <span className="nav-tag">ABHA Profile</span>
            <button className="settings-trigger" onClick={() => setSharesOpen(true)}>Incoming Shares</button>
            <button className="settings-trigger" onClick={() => setSettingsOpen(true)}>Settings</button>
            <button className="btn-logout" onClick={logout}>Logout</button>
          </div>
        </nav>

        <div className="profile-main">
          {profile && (
            <>
              {/* Hero */}
              <div className="profile-hero">
                <label className="avatar" style={{ cursor: "pointer" }}>
                  {profile.kycPhoto ? (
                    <img src={`data:image/jpeg;base64,${profile.kycPhoto}`} alt="Profile" />
                  ) : (
                    <span>{initials}</span>
                  )}
                  <span className="avatar-overlay">Change photo</span>
                  <input type="file" accept="image/*" hidden onChange={e => uploadPhoto(e.target.files[0])} />
                </label>
                <div>
                  <h1 className="profile-name">{profile.name}</h1>
                  <p className="abha-number">{profile.ABHANumber}</p>
                  <div className="verified-badge">
                    <span className="badge-dot" />
                    {profile.verificationStatus}
                  </div>
                </div>
              </div>

              {/* Re-KYC banner */}
              {rekycRequired && (
                <div className="error" style={{ marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                  <span>Your ABHA account needs Re-KYC verification to stay active.</span>
                  <button className="btn-logout" onClick={openRekyc} style={{ flexShrink: 0 }}>Complete Re-KYC →</button>
                </div>
              )}

              {/* Info grid */}
              <p className="section-label">Personal details</p>
              <div className="info-grid">
                <InfoCell label="Gender" value={gender} />
                <InfoCell label="Date of birth" value={dob} />
                <InfoCell label="Mobile" value={profile.mobile} />
                <InfoCell label="ABHA address" value={profile.preferredAbhaAddress} />
                <InfoCell label="Verification type" value={profile.verificationType} />
                <InfoCell label="State" value={profile.stateName} />
                <InfoCell label="District" value={profile.districtName} />
                <InfoCell label="Town" value={profile.townName} />
                <InfoCell label="Pincode" value={profile.pincode} />
              </div>

              {/* Address */}
              <p className="section-label">Address</p>
              <div className="address-block">
                <p className="address-text">{profile.address || "—"}</p>
              </div>

              {/* ABHA Card Preview */}
              {abhaCardUrl && (
                <div className="card-preview">
                  <div className="card-header">
                    <h3>ABHA Card</h3>
                    <span className="card-badge">Downloaded</span>
                  </div>
                  <div className={`card-content ${cardType === "image" ? "no-padding" : ""}`}>
                    {cardType === "pdf" ? (
                      <embed 
                        src={`${abhaCardUrl}#toolbar=0&navpanes=0&scrollbar=0`} 
                        type="application/pdf"
                        width="100%"
                        height="500px"
                      />
                    ) : (
                      <img
                        src={abhaCardUrl}
                        alt="ABHA Card"
                        style={{ width: "100%", height: "auto", display: "block", border: "1px solid #e0e0e0" }}
                      />
                    )}
                    <div>
                      <button 
                        className="card-download-btn" 
                        onClick={downloadAbhaCard}
                        disabled={isDownloading}
                      >
                        {isDownloading ? "Downloading..." : "Download ABHA Card ↓"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <p className="section-label">Actions</p>
              <div className="actions">
                <button className="action-btn" onClick={loadQrCode} disabled={qrLoading}>
                  <div className="action-btn-label">Share profile</div>
                  <div className="action-btn-title">{qrLoading ? "Loading..." : "View QR Code"}</div>
                  <div className="action-btn-arrow">→</div>
                </button>
                <button className="action-btn" onClick={downloadAbhaCard} disabled={isDownloading}>
                  <div className="action-btn-label">Export</div>
                  <div className="action-btn-title">{isDownloading ? "Downloading..." : "Download ABHA Card"}</div>
                  <div className="action-btn-arrow">→</div>
                </button>
              </div>

              {/* QR Modal */}
              {qrCode && showQr && (
                <div className="qr-overlay" onClick={() => { setShowQr(false); setQrCode(""); }}>
                  <div className="qr-modal" onClick={e => e.stopPropagation()}>
                    <button className="qr-close" onClick={() => { setShowQr(false); setQrCode(""); }}>✕</button>
                    <p className="qr-eyebrow">ABHA QR code</p>
                    <img
                      src={`data:image/png;base64,${qrCode}`}
                      alt="QR Code"
                      className="qr-image"
                    />
                    <p className="qr-note">Scan this code to share your health profile with any ABDM-registered provider.</p>

                    {profile?.preferredAbhaAddress && (
                      <div className="qr-address-row">
                        <span className="qr-address-text">{profile.preferredAbhaAddress}</span>
                        <button className="qr-copy-btn" onClick={copyAbhaAddress}>
                          {addressCopied ? "Copied ✓" : "Copy"}
                        </button>
                      </div>
                    )}

                    <button className="qr-share-btn" onClick={shareAbhaProfile}>
                      Share ABHA address →
                    </button>
                  </div>
                </div>
              )}

              {/* Re-KYC modal */}
              {rekycOpen && (
                <div className="qr-overlay" onClick={closeRekyc}>
                  <div className="qr-modal" onClick={e => e.stopPropagation()}>
                    <button className="qr-close" onClick={closeRekyc}>✕</button>
                    <p className="qr-eyebrow">Re-KYC verification</p>

                    {rekycStep === "confirm" && (
                      <>
                        <p className="form-desc" style={{ marginBottom: "1.25rem" }}>Confirm your ABHA number to receive a verification OTP.</p>
                        <label className="settings-field-label">ABHA number</label>
                        <input className="settings-input" type="text" placeholder="XX-XXXX-XXXX-XXXX" value={rekycAbhaNumber} onChange={e => setRekycAbhaNumber(e.target.value)} />
                        {rekycError && <p className="settings-error">{rekycError}</p>}
                        <button className="settings-submit" onClick={rekycRequestOtp} disabled={rekycLoading}>
                          {rekycLoading ? "Sending..." : "Send OTP"}
                        </button>
                      </>
                    )}

                    {rekycStep === "otp" && (
                      <>
                        <p className="form-desc" style={{ marginBottom: "1.25rem" }}>Enter the OTP sent to your registered mobile.</p>
                        <label className="settings-field-label">One-time password</label>
                        <input className="settings-input" type="text" inputMode="numeric" placeholder="6-digit OTP" value={rekycOtp} onChange={e => setRekycOtp(e.target.value.replace(/\D/g, ""))} />
                        {rekycError && <p className="settings-error">{rekycError}</p>}
                        <button className="settings-submit" onClick={rekycVerifyOtp} disabled={rekycLoading}>
                          {rekycLoading ? "Verifying..." : "Verify & Complete"}
                        </button>
                      </>
                    )}

                    {rekycStep === "done" && (
                      <div style={{ textAlign: "center", paddingTop: "1rem" }}>
                        <div className="settings-done-icon">✓</div>
                        <p className="settings-success" style={{ textAlign: "center" }}>Re-KYC completed successfully.</p>
                        <button className="settings-submit" onClick={closeRekyc}>Done</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Settings sidebar */}
              {settingsOpen && (
                <>
                  <div className="settings-overlay" onClick={closeSettings} />
                  <div className="settings-drawer">
                    <div className="settings-header">
                      <span className="settings-title">Settings</span>
                      <button className="settings-close" onClick={closeSettings}>✕</button>
                    </div>
                    <div className="settings-body">
                      {!activeSetting && (
                        <div className="settings-list">
                          <button className="settings-item" onClick={() => openSetting("mobile")}>
                            <div className="settings-item-label">Update</div>
                            <div className="settings-item-value">Mobile number</div>
                          </button>
                          <button className="settings-item" onClick={() => openSetting("email")}>
                            <div className="settings-item-label">Update</div>
                            <div className="settings-item-value">Email address</div>
                          </button>
                          <button
                            className="settings-item"
                            onClick={() => openSetting("change-password")}
                          >
                            <div className="settings-item-label">Security</div>
                            <div className="settings-item-value">Change password</div>
                            <div className="settings-item-desc">
                              Update your ABHA account password
                            </div>
                          </button>
                          <button className="settings-item" onClick={() => openSetting("deactivate")}>
                            <div className="settings-item-label">Account</div>
                            <div className="settings-item-value">Deactivate ABHA</div>
                          </button>
                          <button className="settings-item" onClick={() => openSetting("reactivate")}>
                            <div className="settings-item-label">Account</div>
                            <div className="settings-item-value">Reactivate ABHA</div>
                          </button>
                          <button className="settings-item" onClick={() => openSetting("delete")}>
                            <div className="settings-item-label">Account</div>
                            <div className="settings-item-value" style={{ color: "#c00" }}>Delete ABHA</div>
                          </button>
                        </div>
                      )}

                      {activeSetting && settingStep === "method" && (
                        <>
                          <button className="settings-back" onClick={handleBack}>← Back</button>
                          <p className="settings-field-label">Choose verification method</p>
                          <div className="settings-list">
                            <button className="settings-item" onClick={() => chooseMethod("aadhaar")}>
                              <div className="settings-item-value">Aadhaar OTP</div>
                              <div className="settings-item-desc">OTP sent by UIDAI to your Aadhaar-linked mobile</div>
                            </button>
                            <button className="settings-item" onClick={() => chooseMethod("mobile")}>
                              <div className="settings-item-value">Mobile / ABHA OTP</div>
                              <div className="settings-item-desc">OTP sent to your ABHA-registered mobile number</div>
                            </button>
                            <button className="settings-item" onClick={() => chooseMethod("password")}>
                              <div className="settings-item-value">Password</div>
                              <div className="settings-item-desc">Use your ABHA account password instead</div>
                            </button>
                          </div>
                        </>
                      )}

                      {activeSetting && settingStep === "input" && (
                        <>
                          <button className="settings-back" onClick={handleBack}>← Back</button>
                          {activeSetting === "change-password" && (
  <>
    <button className="settings-back" onClick={handleBack}>
      ← Back
    </button>

    <label className="settings-field-label">
      Current password
    </label>

    <input
      className="settings-input"
      type="password"
      placeholder="Current ABHA password"
      value={oldPassword}
      onChange={e => setOldPassword(e.target.value)}
    />

    <label className="settings-field-label">
      New password
    </label>

    <input
      className="settings-input"
      type="password"
      placeholder="New ABHA password"
      value={newPassword}
      onChange={e => setNewPassword(e.target.value)}
    />

    {settingError && (
      <p className="settings-error">
        {settingError}
      </p>
    )}

    <button
      className="settings-submit"
      onClick={changePassword}
      disabled={settingLoading}
    >
      {settingLoading
        ? "Changing..."
        : "Change Password"}
    </button>
  </>
)}
                          {activeSetting === "mobile" && (
                            <>
                              <label className="settings-field-label">New mobile number</label>
                              <input
                                className="settings-input"
                                type="tel"
                                placeholder="10-digit mobile number"
                                value={settingValue}
                                onChange={e => setSettingValue(e.target.value)}
                              />
                            </>
                          )}

                          {activeSetting === "email" && (
                            <>
                              <label className="settings-field-label">New email address</label>
                              <input
                                className="settings-input"
                                type="email"
                                placeholder="name@example.com"
                                value={settingValue}
                                onChange={e => setSettingValue(e.target.value)}
                              />
                            </>
                          )}

                          {(activeSetting === "deactivate" || activeSetting === "delete") && (
                            <>
                              <p className={activeSetting === "delete" ? "settings-error" : "settings-success"}>
                                {activeSetting === "delete"
                                  ? "This permanently deletes your ABHA account. This cannot be undone."
                                  : "Your account will be temporarily deactivated. You can reactivate it later."}
                              </p>
                              <label className="settings-field-label">Reason (optional)</label>
                              <input
                                className="settings-input"
                                type="text"
                                placeholder={`Why are you ${activeSetting === "delete" ? "deleting" : "deactivating"}?`}
                                value={settingValue}
                                onChange={e => setSettingValue(e.target.value)}
                              />
                            </>
                          )}

                          {activeSetting === "reactivate" && (
                            <>
                              <label className="settings-field-label">ABHA number</label>
                              <input
                                className="settings-input"
                                type="text"
                                placeholder="XX-XXXX-XXXX-XXXX"
                                value={settingValue}
                                onChange={e => setSettingValue(e.target.value)}
                              />
                            </>
                          )}
                          
                          {settingError && <p className="settings-error">{settingError}</p>}
                          <button className="settings-submit" onClick={sendSettingOtp} disabled={settingLoading}>
                            {settingLoading ? "Sending..." : "Send OTP"}
                          </button>
                        </>
                      )}

                      {activeSetting && settingStep === "otp" && (
                        <>
                          <button className="settings-back" onClick={handleBack}>← Back</button>
                          <p className="settings-success">{settingMessage}</p>
                          <label className="settings-field-label">Enter OTP</label>
                          <input
                            className="settings-input"
                            type="text"
                            inputMode="numeric"
                            placeholder="6-digit OTP"
                            value={settingOtp}
                            onChange={e => setSettingOtp(e.target.value)}
                          />
                          {settingError && <p className="settings-error">{settingError}</p>}
                          <button className="settings-submit" onClick={verifySettingOtp} disabled={settingLoading}>
                            {settingLoading ? "Verifying..." : "Verify & Continue"}
                          </button>
                        </>
                      )}

                      {activeSetting && settingStep === "password" && (
                        <>
                          <button className="settings-back" onClick={handleBack}>← Back</button>

                          {activeSetting === "reactivate" && (
                            <>
                              <label className="settings-field-label">ABHA number</label>
                              <input
                                className="settings-input"
                                type="text"
                                placeholder="XX-XXXX-XXXX-XXXX"
                                value={settingValue}
                                onChange={e => setSettingValue(e.target.value)}
                              />
                            </>
                          )}

                          {(activeSetting === "deactivate" || activeSetting === "delete") && (
                            <>
                              <label className="settings-field-label">Reason (optional)</label>
                              <input
                                className="settings-input"
                                type="text"
                                placeholder={`Why are you ${activeSetting === "delete" ? "deleting" : "deactivating"}?`}
                                value={settingValue}
                                onChange={e => setSettingValue(e.target.value)}
                              />
                            </>
                          )}

                          <label className="settings-field-label">Password</label>
                          <input
                            className="settings-input"
                            type="password"
                            placeholder="Your ABHA password"
                            value={settingPassword}
                            onChange={e => setSettingPassword(e.target.value)}
                          />
                          {settingError && <p className="settings-error">{settingError}</p>}
                          <button className="settings-submit" onClick={submitSettingPassword} disabled={settingLoading}>
                            {settingLoading ? "Verifying..." : "Confirm"}
                          </button>
                        </>
                      )}

                      {settingStep === "done" && (
                        <div style={{ textAlign: "center", paddingTop: "1.5rem" }}>
                          <div className="settings-done-icon">✓</div>
                          <p className="settings-success" style={{ textAlign: "center" }}>{settingMessage}</p>
                          <button className="settings-submit" onClick={closeSettings}>Done</button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Incoming Shares drawer (provider/HIP side — Scan & Share) */}
              {sharesOpen && (
                <>
                  <div className="settings-overlay" onClick={() => setSharesOpen(false)} />
                  <div className="settings-drawer shares-drawer">
                    <div className="settings-header">
                      <span className="settings-title">Incoming Shares</span>
                      <button className="settings-close" onClick={() => setSharesOpen(false)}>✕</button>
                    </div>
                    <div className="settings-body">
                      {sharesLoading && <p className="shares-empty">Loading…</p>}
                      {sharesError && <p className="shares-error-text">{sharesError}</p>}
                      {!sharesLoading && !sharesError && incomingShares.length === 0 && (
                        <p className="shares-empty">No profile shares received yet.</p>
                      )}
                      {!sharesLoading && incomingShares.map((s, i) => (
                        <div className="share-card" key={s.requestId || i}>
                          <div className="share-card-top">
                            <span className="share-card-name">{s.name || "Unknown"}</span>
                            <span className="share-card-time">{s.receivedAt}</span>
                          </div>
                          <div className="share-card-row"><span>ABHA Address: </span>{s.abhaAddress || "—"}</div>
                          <div className="share-card-row"><span>Mobile: </span>{s.phoneNumber || "—"}</div>
                          <div className="share-card-row">
                            <span>DOB / Gender: </span>
                            {s.dayOfBirth && s.monthOfBirth && s.yearOfBirth
                              ? `${s.dayOfBirth}-${s.monthOfBirth}-${s.yearOfBirth}`
                              : "—"} · {s.gender || "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}