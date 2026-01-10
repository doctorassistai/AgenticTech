import React, { useEffect, useState } from "react";
import { LayoutDashboard, FileText, Settings, Users, TrendingUp, Activity, AlertCircle, CheckCircle, Menu, X, Building, Stethoscope, ChevronDown, ChevronUp } from "lucide-react";
import { Terminal } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const HEALTH_SERVICES = [
  { name: "Gateway", url: "/health" },
  { name: "Orchestration", url: "/hms/users/orchestration/health" },
  { name: "Speciality", url: "/hms/users/speciality/health" },
  { name: "Data Service", url: "/hms/users/data/health" },
  { name: "AI Service", url: "/hms/users/aiservice/health" },
  { name: "Audit Service", url: "/hms/users/auditservice/health" },
  { name: "Workflow Engine", url: "/hms/users/workflowengine/health" },
];

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState("home");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState(null);
  const [totalUsers, setTotalUsers] = useState(0);
  const [statsLoading, setStatsLoading] = useState(false);
  const [activeUsers, setActiveUsers] = useState(0);
  const [errorLogsCount, setErrorLogsCount] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [showUnhealthyServices, setShowUnhealthyServices] = useState(false);

  const [liveLogs, setLiveLogs] = useState([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const wsRef = React.useRef(null);

  // New state for hospitals and doctors
  const [hospitals, setHospitals] = useState([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(false);
  const [hospitalsError, setHospitalsError] = useState(null);
  const [expandedHospital, setExpandedHospital] = useState(null);
  const [hospitalDoctors, setHospitalDoctors] = useState({});
  const [doctorsLoading, setDoctorsLoading] = useState({});

  // filters
  const [filters, setFilters] = useState({
    level: "",
    service: "",
    actor_id: "",
    action_type: "",
    endpoint: "",
  });

  const [userFilters, setUserFilters] = useState({
    username: "",
    email: "",
    role: "",
    status: "",
    sys_user_id: "",
    created_from: "",
    created_to: "",
  });

  const [systemHealth, setSystemHealth] = useState({
    percentage: 0,
    healthy: 0,
    total: HEALTH_SERVICES.length,
    services: [],
  });

  const [liveFilters, setLiveFilters] = useState({
    container: "",
    level: "",
    endpoint: "",
  });

  // pagination
  const [page, setPage] = useState(0);
  const limit = 20;

  const [capturedLogs, setCapturedLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = React.useRef(null);
  const logsContainerRef = React.useRef(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        ...filters,
        skip: page * limit,
        limit,
      });

      const response = await fetch(
        `${API_BASE_URL}/hms/admin/audits/search?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch logs");
      }

      const data = await response.json();
      setLogs(data.audits || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const params = new URLSearchParams({
        ...Object.fromEntries(
          Object.entries(userFilters).filter(
            ([_, v]) => v !== "" && v !== null && v !== undefined
          )
        ),
        skip: page * limit,
        limit,
      });

      const response = await fetch(
        `${API_BASE_URL}/hms/users/auth/users/search?${params.toString()}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();

      setUsers(data.users || []);
      setTotalUsers(data.total || 0);

    } catch (err) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  };


  // Fetch hospitals with stats
  const fetchHospitals = async () => {
    setHospitalsLoading(true);
    setHospitalsError(null);
    
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/admin/get_hospitals_with_stats`,
        { credentials: "include" }
      );
      
      if (!response.ok) {
        throw new Error("Failed to fetch hospitals");
      }
      
      const data = await response.json();
      setHospitals(data.hospitals || []);
    } catch (err) {
      setHospitalsError(err.message);
    } finally {
      setHospitalsLoading(false);
    }
  };

  // Fetch doctors for a specific hospital
  const fetchHospitalDoctors = async (hospitalId) => {
    setDoctorsLoading(prev => ({ ...prev, [hospitalId]: true }));
    
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/admin/get_hospital_doctors/${hospitalId}`,
        { credentials: "include" }
      );
      
      if (!response.ok) {
        throw new Error("Failed to fetch doctors");
      }
      
      const data = await response.json();
      setHospitalDoctors(prev => ({
        ...prev,
        [hospitalId]: {
          doctors: data.doctors || [],
          hospitalName: data.hospital_name,
          totalDoctors: data.total_doctors
        }
      }));
    } catch (err) {
      console.error(`Error fetching doctors for hospital ${hospitalId}:`, err);
    } finally {
      setDoctorsLoading(prev => ({ ...prev, [hospitalId]: false }));
    }
  };

  // Handle hospital expansion
  const toggleHospitalExpansion = async (hospitalId) => {
    if (expandedHospital === hospitalId) {
      setExpandedHospital(null);
    } else {
      setExpandedHospital(hospitalId);
      if (!hospitalDoctors[hospitalId]) {
        await fetchHospitalDoctors(hospitalId);
      }
    }
  };

  const fetchDashboardStats = async () => {
    setStatsLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/users/auth/get_all_users`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch dashboard stats");
      }

      const data = await response.json();

      const users = data.users || [];

      // ✅ COUNT ACTIVE USERS
      const activeCount = users.filter(
        (user) => user.status === "active"
      ).length;

      setTotalUsers(data.total_users || 0);
      setActiveUsers(activeCount);
    } catch (err) {
      console.error("Dashboard stats error:", err);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleLogsClick = () => {
    setActiveSection("logs");
    setPage(0);
  };

  const handleScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;

    const isAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 10;

    setAutoScroll(isAtBottom);
  };

  const filteredLiveLogs = liveLogs.filter((log) => {
    if (liveFilters.container && log.container !== liveFilters.container)
      return false;

    if (liveFilters.level && !log.message.includes(liveFilters.level))
      return false;

    if (liveFilters.endpoint && !log.message.includes(liveFilters.endpoint))
      return false;

    return true;
  });

  const captureLogs = () => {
    setCapturedLogs([...filteredLiveLogs]);
  };

  const levelColor = (msg) => {
    if (msg.includes("ERROR")) return "#ef4444";
    if (msg.includes("WARN")) return "#f59e0b";
    if (msg.includes("INFO")) return "#38bdf8";
    return "#e5e7eb";
  };

  const containerColor = {
    gateway: "#22c55e",
    users: "#3b82f6",
    "audit-service": "#a855f7",
    orchestration: "#f97316",
  };

  useEffect(() => {
    if (activeSection === "total-users") {
      fetchUsers();
    }
  }, [activeSection, page]);

  useEffect(() => {
    const verifyAdmin = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/hms/admin/verify`,
          { credentials: "include" }
        );

        if (!res.ok) throw new Error("Not authenticated");

        const data = await res.json();

        if (data.admin.role !== "system_admin") {
          throw new Error("Not admin");
        }

        setAuthenticated(true);
      } catch (err) {
        console.error("Admin auth failed", err);
        window.location.href = "/login";
      } finally {
        setAuthChecked(true);
      }
    };

    verifyAdmin();
  }, []);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveLogs, autoScroll]);

  useEffect(() => {
    if (activeSection === "logs") {
      fetchLogs();
    }
  }, [activeSection, page]);

  useEffect(() => {
    if (activeSection === "total-users") {
      fetchUsers();
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "live-users") {
      fetchHospitals();
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "home") {
      fetchDashboardStats();
      fetchSystemHealth();
      fetchErrorLogsCount();
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "live-logs") {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const WS_PROTOCOL =
      window.location.protocol === "https:" ? "wss" : "ws";

    const WS_URL = `${WS_PROTOCOL}://${window.location.host}/api/hms/users/livelogs/ws/logs`;

    const ws = new WebSocket(WS_URL);    
    wsRef.current = ws;

    ws.onopen = () => {
      setLiveConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      setLiveLogs((prev) => {
        const next = [...prev, data];
        return next.length > 500 ? next.slice(-500) : next;
      });
    };

    ws.onerror = () => {
      setLiveConnected(false);
    };

    ws.onclose = () => {
      setLiveConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [activeSection]);

  const fetchErrorLogsCount = async () => {
    try {
      const params = new URLSearchParams({
        level: "ERROR",
        skip: 0,
        limit: 1
      });

      const res = await fetch(
        `${API_BASE_URL}/hms/admin/audits/search?${params}`
      );

      if (!res.ok) return;

      const data = await res.json();
      setErrorLogsCount(data.total || 0);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSystemHealth = async () => {
    try {
      const results = await Promise.allSettled(
        HEALTH_SERVICES.map(async (service) => {
          const res = await fetch(`${API_BASE_URL}${service.url}`);
          if (!res.ok) throw new Error("Unhealthy");

          const data = await res.json();

          return {
            name: service.name,
            status: data.status === "ok" || data.status === "healthy",
          };
        })
      );

      const servicesStatus = results.map((r, i) => ({
        name: HEALTH_SERVICES[i].name,
        status: r.status === "fulfilled" && r.value.status,
      }));

      const healthyCount = servicesStatus.filter(s => s.status).length;

      setSystemHealth({
        percentage: Math.round((healthyCount / HEALTH_SERVICES.length) * 100),
        healthy: healthyCount,
        total: HEALTH_SERVICES.length,
        services: servicesStatus,
      });

    } catch (err) {
      console.error("System health fetch failed", err);
    }
  };

  const StatCard = ({ icon: Icon, title, value, change, trend }) => (
    <div style={styles.statCard}>
      <div style={styles.statHeader}>
        <div style={styles.statIconWrapper}>
          <Icon size={24} style={styles.statIcon} />
        </div>
        <span style={styles.statTrend(trend)}>{change}</span>
      </div>
      <h3 style={styles.statValue}>{value}</h3>
      <p style={styles.statTitle}>{title}</p>
    </div>
  );

  const ActivityItem = ({ title, time, status }) => (
    <div style={styles.activityItem}>
      <div style={styles.activityDot(status)} />
      <div style={styles.activityContent}>
        <p style={styles.activityTitle}>{title}</p>
        <span style={styles.activityTime}>{time}</span>
      </div>
    </div>
  );

  if (!authChecked) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600
      }}>
        Verifying admin session...
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* SIDEBAR */}
      <aside style={styles.sidebar(sidebarOpen)}>
        <div style={styles.sidebarHeader}>
          <h2 style={styles.logo}>Admin Panel</h2>
          <button style={styles.menuButton} onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        
        <nav style={styles.nav}>
          <button
            style={styles.navButton(activeSection === "home")}
            onClick={() => setActiveSection("home")}
          >
            <LayoutDashboard size={20} />
            {sidebarOpen && <span>Dashboard</span>}
          </button>
          
          <button
            style={styles.navButton(activeSection === "logs")}
            onClick={handleLogsClick}
          >
            <FileText size={20} />
            {sidebarOpen && <span>Audit Logs</span>}
          </button>
          
          <button
            style={styles.navButton(activeSection === "total-users")}
            onClick={() => setActiveSection("total-users")}
          >
            <Users size={20} />
            {sidebarOpen && <span>Total Users</span>}
          </button>
          
          <button
            style={styles.navButton(activeSection === "live-users")}
            onClick={() => setActiveSection("live-users")}
          >
            <Building size={20} />
            {sidebarOpen && <span>Hospitals & Doctors</span>}
          </button>
          
          <button
            style={styles.navButton(activeSection === "live-logs")}
            onClick={() => setActiveSection("live-logs")}
          >
            <Terminal size={20} />
            {sidebarOpen && <span>Live Logs</span>}
          </button>
          
          <button
            style={styles.navButton(activeSection === "settings")}
            onClick={() => setActiveSection("settings")}
          >
            <Settings size={20} />
            {sidebarOpen && <span>Settings</span>}
          </button>
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main style={styles.main}>
        {/* HOME PAGE */}
        {activeSection === "home" && (
          <div style={styles.dashboardWrapper}>

            {/* HEADER */}
            <div style={styles.dashboardHeader}>
              <h1 style={styles.pageTitle}>System Overview</h1>
              <p style={styles.pageSubtitle}>
                Real-time visibility into users, services, and platform health
              </p>
            </div>

            {/* KPI ROW */}
            <div style={styles.kpiGrid}>
              <StatCard
                icon={Users}
                title="Total Users"
                value={statsLoading ? "—" : totalUsers.toLocaleString()}
                change="Registered"
                trend="up"
              />

              <StatCard
                icon={Activity}
                title="Active Users"
                value={statsLoading ? "—" : activeUsers}
                change={`${activeUsers}/${totalUsers}`}
                trend={activeUsers > 0 ? "up" : "down"}
              />

              <StatCard
                icon={TrendingUp}
                title="System Health"
                value={`${systemHealth.percentage}%`}
                change={`${systemHealth.healthy}/${systemHealth.total} services`}
                trend={systemHealth.percentage >= 80 ? "up" : "down"}
              />

              <StatCard
                icon={AlertCircle}
                title="Error Logs"
                value={errorLogsCount}
                change=""
                trend={errorLogsCount > 0 ? "down" : "up"}
              />
            </div>

            {/* SYSTEM HEALTH PANEL */}
            <div style={styles.healthPanel}>
              <div style={styles.healthHeader}>
                <h3>Service Health</h3>
                <button
                  style={styles.toggleButton}
                  onClick={() => setShowUnhealthyServices(v => !v)}
                >
                  {showUnhealthyServices ? "Hide Details" : "View Unhealthy"}
                </button>
              </div>

              <div style={styles.healthBarWrapper}>
                <div style={styles.healthBarBackground}>
                  <div
                    style={{
                      ...styles.healthBarFill,
                      width: `${systemHealth.percentage}%`,
                      background:
                        systemHealth.percentage >= 80 ? "#10b981" : "#ef4444",
                    }}
                  />
                </div>
                <span style={styles.healthLabel}>
                  {systemHealth.percentage}% Healthy
                </span>
              </div>

              {showUnhealthyServices && (
                <div style={styles.unhealthyList}>
                  {systemHealth.services.filter(s => !s.status).length === 0 ? (
                    <p style={{ color: "#10b981", fontWeight: 600 }}>
                      ✅ All services operational
                    </p>
                  ) : (
                    systemHealth.services
                      .filter(s => !s.status)
                      .map(s => (
                        <div key={s.name} style={styles.unhealthyItem}>
                          ❌ {s.name}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>

            {/* QUICK ACTIONS */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Quick Actions</h3>
              <div style={styles.quickActions}>
                <button style={styles.actionButton} onClick={handleLogsClick}>
                  <FileText size={20} />
                  View Audit Logs
                </button>

                <button
                  style={styles.actionButton}
                  onClick={() => setActiveSection("total-users")}
                >
                  <Users size={20} />
                  Manage Users
                </button>

                <button
                  style={styles.actionButton}
                  onClick={() => setActiveSection("live-users")}
                >
                  <Building size={20} />
                  Hospitals & Doctors
                </button>

                <button
                  style={styles.actionButton}
                  onClick={() => setActiveSection("live-logs")}
                >
                  <Terminal size={20} />
                  Live Logs
                </button>
              </div>
            </div>
          </div>
        )}


        {/* AUDIT LOGS PAGE */}
        {activeSection === "logs" && (
          <div style={styles.logsContent}>
            <div style={styles.pageHeader}>
              <h1 style={styles.pageTitle}>Audit Logs</h1>
              <p style={styles.pageSubtitle}>Track and monitor all system activities</p>
            </div>

            {/* FILTERS */}
            <div style={styles.card}>
              <div style={styles.filtersGrid}>
                <select
                  style={styles.filterInput}
                  onChange={(e) =>
                    setFilters({ ...filters, level: e.target.value })
                  }
                >
                  <option value="">All Levels</option>
                  <option value="INFO">INFO</option>
                  <option value="ERROR">ERROR</option>
                </select>

                <input
                  style={styles.filterInput}
                  placeholder="Service"
                  onChange={(e) =>
                    setFilters({ ...filters, service: e.target.value })
                  }
                />

                <input
                  style={styles.filterInput}
                  placeholder="Actor ID"
                  onChange={(e) =>
                    setFilters({ ...filters, actor_id: e.target.value })
                  }
                />

                <input
                  style={styles.filterInput}
                  placeholder="Action Type"
                  onChange={(e) =>
                    setFilters({ ...filters, action_type: e.target.value })
                  }
                />

                <input
                  style={styles.filterInput}
                  placeholder="Endpoint"
                  onChange={(e) =>
                    setFilters({ ...filters, endpoint: e.target.value })
                  }
                />

                <button style={styles.searchButton} onClick={() => fetchLogs()}>
                  Search
                </button>
              </div>
            </div>

            {/* STATES */}
            {loading && (
              <div style={styles.loadingState}>
                <div style={styles.spinner} />
                <p>Loading logs...</p>
              </div>
            )}
            
            {error && (
              <div style={styles.errorState}>
                <AlertCircle size={48} />
                <p>{error}</p>
              </div>
            )}

            {!loading && logs.length === 0 && (
              <div style={styles.emptyState}>
                <FileText size={48} />
                <p>No logs found</p>
              </div>
            )}

            {/* TABLE */}
            {!loading && logs.length > 0 && (
              <div style={styles.card}>
                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Timestamp</th>
                        <th style={styles.th}>Level</th>
                        <th style={styles.th}>Service</th>
                        <th style={styles.th}>Component</th>
                        <th style={styles.th}>Action</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Actor</th>
                        <th style={styles.th}>Endpoint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log._id} style={styles.tr}>
                          <td style={styles.td}>
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td style={styles.td}>
                            <span style={styles.badge(log.level)}>
                              {log.level}
                            </span>
                          </td>
                          <td style={styles.td}>{log.source?.service || '-'}</td>
                          <td style={styles.td}>{log.source?.component || '-'}</td>
                          <td style={styles.td}>{log.action?.type || '-'}</td>
                          <td style={styles.td}>
                            <span style={styles.statusBadge(log.action?.status)}>
                              {log.action?.status || '-'}
                            </span>
                          </td>
                          <td style={styles.td}>{log.actor?.id || '-'}</td>
                          <td style={styles.td}>{log.context?.endpoint || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* PAGINATION */}
                <div style={styles.pagination}>
                  <button
                    style={styles.paginationButton(page === 0)}
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>

                  <span style={styles.pageInfo}>Page {page + 1}</span>

                  <button
                    style={styles.paginationButton(false)}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TOTAL USERS SECTION */}
        {activeSection === "total-users" && (
          <div style={styles.usersWrapper}>

            {/* HEADER */}
            <div style={styles.pageHeader}>
              <div>
                <h1 style={styles.pageTitle}>User Management</h1>
                <p style={styles.pageSubtitle}>
                  Search, filter, and manage all system users
                </p>
              </div>
            </div>

            {/* FILTER PANEL */}
            <div style={styles.filterCard}>
              <div style={styles.filterGrid}>

                <input
                  style={styles.filterInput}
                  placeholder="Username"
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, username: e.target.value })
                  }
                />

                <input
                  style={styles.filterInput}
                  placeholder="Email"
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, email: e.target.value })
                  }
                />

                <select
                  style={styles.filterInput}
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, role: e.target.value })
                  }
                >
                  <option value="">All Roles</option>
                  <option value="system_admin">System Admin</option>
                  <option value="hospital_admin">Hospital Admin</option>
                  <option value="doctor">Doctor</option>
                  <option value="user">User</option>
                </select>

                <select
                  style={styles.filterInput}
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, status: e.target.value })
                  }
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="blocked">Blocked</option>
                </select>

                <input
                  style={styles.filterInput}
                  placeholder="Sys User ID"
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, sys_user_id: e.target.value })
                  }
                />

                <input
                  type="date"
                  style={styles.filterInput}
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, created_from: e.target.value })
                  }
                />

                <input
                  type="date"
                  style={styles.filterInput}
                  onChange={(e) =>
                    setUserFilters({ ...userFilters, created_to: e.target.value })
                  }
                />
              </div>

              <div style={styles.filterActions}>
                <button
                  style={styles.primaryButton}
                  onClick={fetchUsers}
                >
                  Apply Filters
                </button>

                <button
                  style={styles.secondaryButton}
                  onClick={() => {
                    setUserFilters({
                      username: "",
                      email: "",
                      role: "",
                      status: "",
                      sys_user_id: "",
                      created_from: "",
                      created_to: "",
                    });
                    setPage(0);
                    fetchUsers();

                  }}
                >
                  Reset
                </button>
              </div>
            </div>

            {/* TABLE */}
            <div style={styles.card}>
              {usersLoading && <p>Loading users...</p>}
              {usersError && <p style={{ color: "#ef4444" }}>{usersError}</p>}

              {!usersLoading && users.length === 0 && (
                <div style={styles.emptyState}>
                  <Users size={48} />
                  <p>No users found</p>
                </div>
              )}

              {!usersLoading && users.length > 0 && (
                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Username</th>
                        <th style={styles.th}>Email</th>
                        <th style={styles.th}>Role</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Sys User ID</th>
                        <th style={styles.th}>Created At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user._id} style={styles.tr}>
                          <td style={styles.tdStrong}>{user.username}</td>
                          <td style={styles.td}>{user.email || "—"}</td>

                          <td style={styles.td}>
                            <span style={styles.roleBadge(user.role)}>
                              {user.role}
                            </span>
                          </td>

                          <td style={styles.td}>
                            <span style={styles.statusPill(user.status)}>
                              {user.status}
                            </span>
                          </td>

                          <td style={styles.tdMono}>{user.sys_user_id}</td>

                          <td style={styles.td}>
                            {user.created_at
                              ? new Date(user.created_at).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}


        {/* HOSPITALS & DOCTORS SECTION */}
        {activeSection === "live-users" && (
          <div style={styles.logsContent}>
            <div style={styles.pageHeader}>
              <h1 style={styles.pageTitle}>Hospitals & Doctors</h1>
              <p style={styles.pageSubtitle}>View all hospitals and their associated doctors</p>
            </div>

            {hospitalsLoading && (
              <div style={styles.loadingState}>
                <div style={styles.spinner} />
                <p>Loading hospitals...</p>
              </div>
            )}
            
            {hospitalsError && (
              <div style={styles.errorState}>
                <AlertCircle size={48} />
                <p>{hospitalsError}</p>
              </div>
            )}

            {!hospitalsLoading && hospitals.length === 0 && (
              <div style={styles.emptyState}>
                <Building size={48} />
                <p>No hospitals found</p>
              </div>
            )}

            {!hospitalsLoading && hospitals.length > 0 && (
              <div style={styles.hospitalsList}>
                {hospitals.map((hospital) => (
                  <div key={hospital.sys_user_id} style={styles.hospitalCard}>
                    <div 
                      style={styles.hospitalHeader}
                      onClick={() => toggleHospitalExpansion(hospital.sys_user_id)}
                    >
                      <div style={styles.hospitalInfo}>
                        <Building size={24} style={{ marginRight: '12px' }} />
                        <div>
                          <h3 style={styles.hospitalName}>{hospital.name}</h3>
                          <p style={styles.hospitalDetails}>
                            {hospital.address && `${hospital.address} • `}
                            ID: {hospital.hospital_id}
                          </p>
                        </div>
                      </div>
                      <div style={styles.hospitalStats}>
                        <div style={styles.statBadge}>
                          <Stethoscope size={16} />
                          <span>{hospital.doctors_count || 0} Doctors</span>
                        </div>
                        <div style={styles.statBadge}>
                          <Users size={16} />
                          <span>{hospital.patients_count || 0} Patients</span>
                        </div>
                        <div style={styles.statBadge}>
                          <FileText size={16} />
                          <span>{hospital.appointments_count || 0} Appointments</span>
                        </div>
                        <div style={styles.expandButton}>
                          {expandedHospital === hospital.sys_user_id ? (
                            <ChevronUp size={20} />
                          ) : (
                            <ChevronDown size={20} />
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {expandedHospital === hospital.sys_user_id && (
                      <div style={styles.doctorsSection}>
                        {doctorsLoading[hospital.sys_user_id] ? (
                          <div style={styles.loadingDoctors}>
                            <div style={styles.smallSpinner} />
                            <p>Loading doctors...</p>
                          </div>
                        ) : hospitalDoctors[hospital.sys_user_id]?.doctors?.length > 0 ? (
                          <div style={styles.doctorsTable}>
                            <table style={styles.table}>
                              <thead>
                                <tr>
                                  <th style={styles.th}>Name</th>
                                  <th style={styles.th}>Specialization</th>
                                  <th style={styles.th}>Phone</th>
                                  <th style={styles.th}>Patients</th>
                                  <th style={styles.th}>Total Appointments</th>
                                  <th style={styles.th}>Today's Appointments</th>
                                  <th style={styles.th}>Registration No.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {hospitalDoctors[hospital.sys_user_id].doctors.map((doctor) => (
                                  <tr key={doctor.sys_user_id} style={styles.tr}>
                                    <td style={styles.td}>
                                      <strong>{doctor.name}</strong>
                                    </td>
                                    <td style={styles.td}>{doctor.specialization}</td>
                                    <td style={styles.td}>{doctor.phone_number}</td>
                                    <td style={styles.td}>
                                      <span style={styles.countBadge}>
                                        {doctor.patients_count || 0}
                                      </span>
                                    </td>
                                    <td style={styles.td}>
                                      <span style={styles.countBadge}>
                                        {doctor.total_appointments || 0}
                                      </span>
                                    </td>
                                    <td style={styles.td}>
                                      <span style={styles.todayBadge(doctor.today_appointments > 0)}>
                                        {doctor.today_appointments || 0}
                                      </span>
                                    </td>
                                    <td style={styles.td}>{doctor.registeration_number || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={styles.noDoctors}>
                            <Stethoscope size={32} />
                            <p>No doctors registered in this hospital</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LIVE LOGS PAGE */}
        {activeSection === "live-logs" && (
          <div style={styles.logsContent}>
            <div style={styles.pageHeader}>
              <h1 style={styles.pageTitle}>Live Logs</h1>
              <p style={styles.pageSubtitle}>
                Real-time logs from running containers
              </p>
            </div>

            {/* Connection Status */}
            <div
              style={{
                marginBottom: "12px",
                color: liveConnected ? "#10b981" : "#ef4444",
                fontWeight: 600,
              }}
            >
              {liveConnected ? "● Connected" : "● Disconnected"}
            </div>

            {/* Live Log Filters + Capture */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginBottom: "12px",
                flexWrap: "wrap",
              }}
            >
              <select
                style={styles.filterInput}
                onChange={(e) =>
                  setLiveFilters((f) => ({ ...f, container: e.target.value }))
                }
              >
                <option value="">All Containers</option>
                <option value="gateway">Gateway</option>
                <option value="users">Users</option>
                <option value="audit-service">Audit</option>
                <option value="orchestration">Orchestration</option>
                <option value="ai_service">AI Service</option>
                <option value="speciality">Speciality</option>
              </select>

              <select
                style={styles.filterInput}
                onChange={(e) =>
                  setLiveFilters((f) => ({ ...f, level: e.target.value }))
                }
              >
                <option value="">All Levels</option>
                <option value="ERROR">ERROR</option>
                <option value="WARN">WARN</option>
                <option value="INFO">INFO</option>
              </select>

              <input
                style={styles.filterInput}
                placeholder="Endpoint (/health, /login)"
                onChange={(e) =>
                  setLiveFilters((f) => ({ ...f, endpoint: e.target.value }))
                }
              />

              <button style={styles.searchButton} onClick={captureLogs}>
                📸 Capture
              </button>
            </div>

            {/* Live Logs Container */}
            <div
              ref={logsContainerRef}
              onScroll={handleScroll}
              style={{
                background: "#020617",
                color: "#e5e7eb",
                borderRadius: "12px",
                padding: "16px",
                height: "60vh",
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: "13px",
                lineHeight: "1.5",
                border: "1px solid #0f172a",
              }}
            >
              {filteredLiveLogs.length === 0 && (
                <div style={{ color: "#64748b" }}>
                  Waiting for logs…
                </div>
              )}

              {filteredLiveLogs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    whiteSpace: "pre-wrap",
                    color: levelColor(log.message),
                    marginBottom: "2px",
                  }}
                >
                  <span
                    style={{
                      color: containerColor[log.container] || "#94a3b8",
                      fontWeight: 600,
                    }}
                  >
                    [{log.container}]
                  </span>{" "}
                  {log.message}
                </div>
              ))}

              <div ref={logsEndRef} />
            </div>

            {/* Captured Logs Section */}
            {capturedLogs.length > 0 && (
              <div
                style={{
                  marginTop: "24px",
                  background: "#0f172a",
                  color: "#e5e7eb",
                  padding: "16px",
                  borderRadius: "12px",
                  border: "1px solid #1e293b",
                }}
              >
                <h3 style={{ marginBottom: "12px" }}>
                  Captured Logs (Snapshot)
                </h3>

                {capturedLogs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      whiteSpace: "pre-wrap",
                      marginBottom: "2px",
                      color: levelColor(log.message),
                    }}
                  >
                    <span
                      style={{
                        color: containerColor[log.container] || "#94a3b8",
                        fontWeight: 600,
                      }}
                    >
                      [{log.container}]
                    </span>{" "}
                    {log.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SETTINGS PAGE */}
        {activeSection === "settings" && (
          <div style={styles.placeholderSection}>
            <Settings size={64} style={{ color: "#94a3b8" }} />
            <h2>Settings</h2>
            <p>Configuration options coming soon</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;

/* ---------------- STYLES ---------------- */

const styles = {
  container: {
    display: "flex",
    height: "100vh",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  sidebar: (open) => ({
    width: open ? "280px" : "80px",
    background: "rgba(255, 255, 255, 0.98)",
    backdropFilter: "blur(20px)",
    borderRight: "1px solid rgba(0, 0, 0, 0.05)",
    padding: "24px 16px",
    transition: "width 0.3s ease",
    boxShadow: "0 0 40px rgba(0, 0, 0, 0.1)",
  }),
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "32px",
    paddingBottom: "16px",
    borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
  },
  logo: {
    fontSize: "20px",
    fontWeight: "700",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: 0,
  },
  menuButton: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "8px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
    color: "#64748b",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  navButton: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    background: active ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "transparent",
    color: active ? "#fff" : "#64748b",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: active ? "600" : "500",
    transition: "all 0.2s ease",
    boxShadow: active ? "0 4px 12px rgba(102, 126, 234, 0.4)" : "none",
    textAlign: "left",
  }),
  main: {
    flex: 1,
    padding: "32px",
    overflowY: "auto",
    background: "#f8fafc",
  },
  pageHeader: {
    marginBottom: "32px",
  },
  pageTitle: {
    fontSize: "32px",
    fontWeight: "700",
    color: "#0f172a",
    margin: "0 0 8px 0",
  },
  pageSubtitle: {
    fontSize: "16px",
    color: "#64748b",
    margin: 0,
  },
  homeContent: {
    maxWidth: "1400px",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "24px",
    marginBottom: "32px",
  },
  statCard: {
    background: "#fff",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    border: "1px solid rgba(0, 0, 0, 0.05)",
    transition: "transform 0.2s, box-shadow 0.2s",
    cursor: "pointer",
  },
  statHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  },
  statIconWrapper: {
    width: "48px",
    height: "48px",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  statIcon: {
    color: "#fff",
  },
  statTrend: (trend) => ({
    fontSize: "14px",
    fontWeight: "600",
    color: trend === "up" ? "#10b981" : "#ef4444",
  }),
  statValue: {
    fontSize: "32px",
    fontWeight: "700",
    color: "#0f172a",
    margin: "0 0 4px 0",
  },
  statTitle: {
    fontSize: "14px",
    color: "#64748b",
    margin: 0,
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
    gap: "24px",
  },
  card: {
    background: "#fff",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    border: "1px solid rgba(0, 0, 0, 0.05)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "20px",
    paddingBottom: "16px",
    borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
  },
  cardTitle: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#0f172a",
    margin: 0,
  },
  viewAllButton: {
    background: "transparent",
    border: "none",
    color: "#667eea",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    padding: "6px 12px",
    borderRadius: "8px",
    transition: "background 0.2s",
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  activityItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
  },
  activityDot: (status) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    marginTop: "6px",
    flexShrink: 0,
    background:
      status === "success"
        ? "#10b981"
        : status === "error"
        ? "#ef4444"
        : status === "warning"
        ? "#f59e0b"
        : "#3b82f6",
  }),
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: "14px",
    color: "#0f172a",
    margin: "0 0 4px 0",
    fontWeight: "500",
  },
  activityTime: {
    fontSize: "13px",
    color: "#94a3b8",
  },
  quickActions: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "12px",
  },
  actionButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    padding: "20px",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    border: "1px solid rgba(0, 0, 0, 0.05)",
    borderRadius: "12px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500",
    color: "#0f172a",
    transition: "all 0.2s",
  },
  logsContent: {
    maxWidth: "1600px",
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
  },
  filterInput: {
    padding: "12px 16px",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.2s",
    background: "#fff",
  },
  searchButton: {
    padding: "12px 24px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "600",
    transition: "transform 0.2s, box-shadow 0.2s",
    boxShadow: "0 4px 12px rgba(102, 126, 234, 0.3)",
  },
  tableWrapper: {
    overflowX: "auto",
    marginTop: "16px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    padding: "12px 16px",
    textAlign: "left",
    fontSize: "13px",
    fontWeight: "600",
    color: "#64748b",
    borderBottom: "2px solid #f1f5f9",
    background: "#f8fafc",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
    transition: "background 0.2s",
  },
  td: {
    padding: "16px",
    fontSize: "14px",
    color: "#334155",
  },
  badge: (level) => ({
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
    background: level === "ERROR" ? "#fee2e2" : "#dbeafe",
    color: level === "ERROR" ? "#dc2626" : "#2563eb",
  }),
  statusBadge: (status) => ({
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
    background: status === "success" ? "#d1fae5" : "#fef3c7",
    color: status === "success" ? "#059669" : "#d97706",
  }),
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    marginTop: "24px",
    paddingTop: "24px",
    borderTop: "1px solid #f1f5f9",
  },
  paginationButton: (disabled) => ({
    padding: "10px 20px",
    background: disabled ? "#f1f5f9" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: disabled ? "#94a3b8" : "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "14px",
    fontWeight: "600",
    transition: "all 0.2s",
    opacity: disabled ? 0.5 : 1,
  }),
  pageInfo: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#0f172a",
  },
  loadingState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "64px",
    color: "#64748b",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "4px solid #f1f5f9",
    borderTop: "4px solid #667eea",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    marginBottom: "16px",
  },
  errorState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "64px",
    color: "#ef4444",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "64px",
    color: "#94a3b8",
  },
  placeholderSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#64748b",
    textAlign: "center",
  },
  
  // New styles for Hospitals & Doctors section
  hospitalsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  
  hospitalCard: {
    background: '#fff',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
    border: '1px solid rgba(0, 0, 0, 0.05)',
    transition: 'all 0.3s ease',
  },
  
  hospitalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    padding: '8px 0',
  },
  
  hospitalInfo: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
  },
  
  hospitalName: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#0f172a',
    margin: '0 0 4px 0',
  },
  
  hospitalDetails: {
    fontSize: '14px',
    color: '#64748b',
    margin: 0,
  },
  
  hospitalStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  
  statBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: '#f8fafc',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#475569',
    fontWeight: '500',
  },
  
  expandButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
    marginLeft: '12px',
  },
  
  doctorsSection: {
    marginTop: '24px',
    paddingTop: '24px',
    borderTop: '1px solid #f1f5f9',
  },
  
  loadingDoctors: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: '#64748b',
  },
  
  smallSpinner: {
    width: '24px',
    height: '24px',
    border: '3px solid #f1f5f9',
    borderTop: '3px solid #667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '12px',
  },
  
  noDoctors: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: '#94a3b8',
    textAlign: 'center',
  },
  
  doctorsTable: {
    overflowX: 'auto',
    marginTop: '16px',
  },
  
  countBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    background: '#dbeafe',
    color: '#2563eb',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
  },
  
  todayBadge: (hasAppointments) => ({
    display: 'inline-block',
    padding: '4px 12px',
    background: hasAppointments ? '#d1fae5' : '#fef3c7',
    color: hasAppointments ? '#059669' : '#d97706',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
  }),
  
  // Add keyframes for spinner animation
  '@keyframes spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
  dashboardWrapper: {
  maxWidth: "1400px",
},

dashboardHeader: {
  marginBottom: "32px",
},

kpiGrid: {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "20px",
  marginBottom: "32px",
},

healthPanel: {
  background: "#fff",
  borderRadius: "16px",
  padding: "24px",
  marginBottom: "32px",
  border: "1px solid #e5e7eb",
},

healthHeader: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "16px",
},

toggleButton: {
  padding: "6px 12px",
  borderRadius: "8px",
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  cursor: "pointer",
  fontWeight: 600,
},

healthBarWrapper: {
  display: "flex",
  alignItems: "center",
  gap: "12px",
},

healthBarBackground: {
  flex: 1,
  height: "10px",
  background: "#e5e7eb",
  borderRadius: "6px",
  overflow: "hidden",
},

healthBarFill: {
  height: "100%",
  transition: "width 0.4s ease",
},

healthLabel: {
  fontWeight: 600,
  fontSize: "14px",
},

unhealthyList: {
  marginTop: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
},

unhealthyItem: {
  color: "#ef4444",
  fontWeight: 600,
},


usersWrapper: {
  maxWidth: "1600px",
},

filterCard: {
  background: "#ffffff",
  borderRadius: "16px",
  padding: "24px",
  marginBottom: "24px",
  border: "1px solid #e5e7eb",
  boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
},

filterGrid: {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
},

filterActions: {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  marginTop: "16px",
},

primaryButton: {
  padding: "10px 20px",
  background: "linear-gradient(135deg, #667eea, #764ba2)",
  color: "#fff",
  border: "none",
  borderRadius: "10px",
  fontWeight: 600,
  cursor: "pointer",
},

secondaryButton: {
  padding: "10px 20px",
  background: "#f8fafc",
  color: "#0f172a",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  fontWeight: 600,
  cursor: "pointer",
},

tdStrong: {
  padding: "16px",
  fontSize: "14px",
  fontWeight: 600,
  color: "#0f172a",
},

tdMono: {
  padding: "16px",
  fontSize: "13px",
  fontFamily: "monospace",
  color: "#475569",
},

roleBadge: (role) => ({
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  background: "#e0e7ff",
  color: "#3730a3",
}),

statusPill: (status) => ({
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  background:
    status === "active"
      ? "#d1fae5"
      : status === "blocked"
      ? "#fee2e2"
      : "#fef3c7",
  color:
    status === "active"
      ? "#065f46"
      : status === "blocked"
      ? "#991b1b"
      : "#92400e",
}),

};