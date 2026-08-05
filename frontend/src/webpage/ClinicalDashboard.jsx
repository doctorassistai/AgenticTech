import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom"; // Add this import
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  TrendingUp,
  Settings,
  Bell,
  Search,
  Menu,
  X,
  Activity,
  DollarSign,
  Package,
  CreditCard,
  ArrowUp,
  ArrowDown,
  Zap,
} from "lucide-react";

function ClinicDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [gpuUsage] = useState(73);
  const [storageUsage] = useState(58);
  const [clinicId, setClinicId] = useState("");
  
  // Get clinic_id from URL
  const [searchParams] = useSearchParams();
  
  useEffect(() => {
    const id = searchParams.get("clinic_id");
    if (id) {
      setClinicId(id);
      console.log("Clinic ID loaded:", id);
    } else {
      console.error("No clinic_id found in URL");
    }
  }, [searchParams]);

  const SpeedMeter = ({ value, label, color, icon: Icon }) => {
    const circumference = 2 * Math.PI * 70;
    const offset = circumference - (value / 100) * circumference;

    return (
      <div
        style={{
          background: "rgba(20, 20, 30, 0.6)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "24px",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "2px",
            background: `linear-gradient(90deg, ${color}, transparent)`,
          }}
        />

        <div
          style={{
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <Icon size={24} style={{ color }} />
          <h3
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: "#fff",
              margin: 0,
            }}
          >
            {label}
          </h3>
        </div>

        <div style={{ position: "relative", width: "180px", height: "180px" }}>
          <svg width="180" height="180" style={{ transform: "rotate(-90deg)" }}>
            <circle
              cx="90"
              cy="90"
              r="70"
              fill="none"
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth="12"
            />
            <circle
              cx="90"
              cy="90"
              r="70"
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{
                transition: "stroke-dashoffset 1s ease",
                filter: `drop-shadow(0 0 8px ${color})`,
              }}
            />
          </svg>

          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "36px", fontWeight: "700", color: "#fff" }}>
              {value}%
            </div>
            <div
              style={{
                fontSize: "14px",
                color: "rgba(255, 255, 255, 0.6)",
                marginTop: "4px",
              }}
            >
              Used
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "24px",
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            padding: "16px",
            background: "rgba(255, 255, 255, 0.03)",
            borderRadius: "12px",
            marginBottom: "20px",
          }}
        >
          <div>
            <div
              style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)" }}
            >
              Available
            </div>
            <div style={{ fontSize: "18px", fontWeight: "600", color: "#fff" }}>
              {100 - value}%
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)" }}
            >
              Total
            </div>
            <div style={{ fontSize: "18px", fontWeight: "600", color: "#fff" }}>
              100%
            </div>
          </div>
        </div>

        <button
          style={{
            width: "100%",
            padding: "14px 24px",
            background: `linear-gradient(135deg, ${color}, ${color}dd)`,
            border: "none",
            borderRadius: "12px",
            color: "#fff",
            fontSize: "16px",
            fontWeight: "600",
            cursor: "pointer",
            transition: "all 0.3s ease",
            boxShadow: `0 4px 16px ${color}40`,
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = `0 6px 20px ${color}60`;
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = `0 4px 16px ${color}40`;
          }}
        >
          Upgrade Now
        </button>
      </div>
    );
  };

  const StatCard = ({ title, value, change, icon: Icon, trend }) => (
    <div
      style={{
        background: "rgba(20, 20, 30, 0.6)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "20px",
        padding: "24px",
        transition: "all 0.3s ease",
        cursor: "pointer",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <p
            style={{
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "14px",
              margin: "0 0 8px 0",
            }}
          >
            {title}
          </p>
          <h3
            style={{
              color: "#fff",
              fontSize: "28px",
              fontWeight: "700",
              margin: "0 0 12px 0",
            }}
          >
            {value}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {trend === "up" ? (
              <ArrowUp size={16} style={{ color: "#10b981" }} />
            ) : (
              <ArrowDown size={16} style={{ color: "#ef4444" }} />
            )}
            <span
              style={{
                color: trend === "up" ? "#10b981" : "#ef4444",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              {change}
            </span>
          </div>
        </div>
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "rgba(59, 130, 246, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={24} style={{ color: "#3b82f6" }} />
        </div>
      </div>
    </div>
  );

  const MenuItem = ({ icon: Icon, label, active, onClick }) => (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "12px",
        background: active ? "rgba(59, 130, 246, 0.15)" : "transparent",
        color: active ? "#3b82f6" : "rgba(255, 255, 255, 0.7)",
        cursor: "pointer",
        transition: "all 0.2s ease",
        margin: "4px 0",
      }}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
          e.currentTarget.style.color = "#fff";
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
        }
      }}
    >
      <Icon size={20} />
      {sidebarOpen && (
        <span style={{ fontSize: "15px", fontWeight: "500" }}>{label}</span>
      )}
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)",
        display: "flex",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: sidebarOpen ? "280px" : "80px",
          background: "rgba(20, 20, 30, 0.4)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "24px",
          transition: "all 0.3s ease",
          position: "relative",
          boxShadow: "4px 0 24px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "100%",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.1), transparent)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "32px",
            position: "relative",
            zIndex: 1,
          }}
          >
          {sidebarOpen && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Zap size={24} style={{ color: "#fff" }} />
              </div>
              <span
                style={{ fontSize: "20px", fontWeight: "700", color: "#fff" }}
              >
                Clinical Hub
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
              transition: "all 0.2s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
            }}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <MenuItem icon={LayoutDashboard} label="Overview" active={true} />
          <MenuItem 
            icon={Users} 
            label="Add Doctors" 
            onClick={() => {
              if (clinicId) {
                window.location.href = `/clinic-doctor-register?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
          />
          <MenuItem 
            icon={Users} 
            label="Add Nurse" 
            onClick={() => {
              if (clinicId) {
                window.location.href = `/clinical-nurse-register?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
          />
          <MenuItem 
            icon={Activity} 
            label="Clinical Engine" 
            onClick={() => {
              window.location.href = `/login`;
            }}
          />

          <MenuItem 
            icon={Users} 
            label="Comunication node" 
            onClick={() => {
              if (clinicId) {
                window.location.href = `/appointment-dashboard?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
          />
          <MenuItem 
            icon={Users} 
            label="Opd Doctor Schedule" 
            onClick={() => {
              if (clinicId) {
                window.location.href = `/opd-time-schedule-hospital?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
          />
          <MenuItem 
            icon={Users} 
            label="Pre Screening Questions" 
            onClick={() => {
              if (clinicId) {
                window.location.href = `/pre-screening-questions?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
          />


          <MenuItem icon={Settings} label="Settings" />
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div
          style={{
            padding: "24px 32px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(20, 20, 30, 0.3)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h1
                style={{
                  color: "#fff",
                  fontSize: "28px",
                  fontWeight: "700",
                  margin: "0 0 4px 0",
                }}
              >
                Clinical Dashboard
              </h1>
              <p style={{ color: "rgba(255, 255, 255, 0.6)", margin: 0 }}>
                System performance and resource monitoring
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Search
                  size={20}
                  style={{
                    position: "absolute",
                    left: "16px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                />
                <input
                  placeholder="Search patients..."
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "12px",
                    padding: "10px 16px 10px 48px",
                    color: "#fff",
                    fontSize: "14px",
                    width: "240px",
                    outline: "none",
                  }}
                />
              </div>
              <button
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "12px",
                  width: "44px",
                  height: "44px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  position: "relative",
                }}
              >
                <Bell size={20} />
                <div
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ef4444",
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: "32px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "24px",
              marginBottom: "32px",
            }}
          >
            <StatCard
              title="Active Patients"
              value="2,847"
              change="+12.5%"
              icon={Users}
              trend="up"
            />
            <StatCard
              title="Critical Alerts"
              value="23"
              change="-8.2%"
              icon={Activity}
              trend="down"
            />
            <StatCard
              title="Appointments"
              value="156"
              change="+15.3%"
              icon={ShoppingCart}
              trend="up"
            />
            <StatCard
              title="System Health"
              value="98.2%"
              change="+2.1%"
              icon={TrendingUp}
              trend="up"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
              gap: "32px",
              marginBottom: "32px",
            }}
          >
            <SpeedMeter
              value={gpuUsage}
              label="GPU Usage"
              color="#8b5cf6"
              icon={Activity}
            />
            <SpeedMeter
              value={storageUsage}
              label="Storage"
              color="#06b6d4"
              icon={Package}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "24px",
            }}
          >
            <div
              style={{
                background: "rgba(20, 20, 30, 0.6)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "20px",
                padding: "24px",
              }}
            >
              <h3
                style={{
                  color: "#fff",
                  fontSize: "18px",
                  fontWeight: "600",
                  marginTop: 0,
                }}
              >
                Recent Activity
              </h3>
              {[
                { action: "Patient admitted to ICU", time: "2 minutes ago" },
                { action: "Lab results processed", time: "15 minutes ago" },
                { action: "Medication dispensed", time: "1 hour ago" },
                { action: "System backup completed", time: "2 hours ago" },
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px",
                    background: "rgba(255, 255, 255, 0.03)",
                    borderRadius: "10px",
                    marginBottom: "8px",
                    borderLeft: "3px solid #3b82f6",
                  }}
                >
                  <div
                    style={{
                      color: "#fff",
                      fontSize: "14px",
                      marginBottom: "4px",
                    }}
                  >
                    {item.action}
                  </div>
                  <div
                    style={{
                      color: "rgba(255, 255, 255, 0.5)",
                      fontSize: "12px",
                    }}
                  >
                    {item.time}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                background: "rgba(20, 20, 30, 0.6)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "20px",
                padding: "24px",
              }}
            >
              <h3
                style={{
                  color: "#fff",
                  fontSize: "18px",
                  fontWeight: "600",
                  marginTop: 0,
                }}
              >
                Department Status
              </h3>
              {[
                { name: "Emergency", capacity: 87, color: "#ef4444" },
                { name: "ICU", capacity: 92, color: "#f59e0b" },
                { name: "Surgery", capacity: 65, color: "#10b981" },
                { name: "General Ward", capacity: 73, color: "#3b82f6" },
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: "rgba(255, 255, 255, 0.03)",
                    borderRadius: "10px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: item.color,
                      }}
                    />
                    <span style={{ color: "#fff", fontSize: "14px" }}>
                      {item.name}
                    </span>
                  </div>
                  <span
                    style={{
                      color: "rgba(255, 255, 255, 0.7)",
                      fontSize: "14px",
                      fontWeight: "600",
                    }}
                  >
                    {item.capacity}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClinicDashboard;