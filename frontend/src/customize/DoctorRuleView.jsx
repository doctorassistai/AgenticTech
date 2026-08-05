import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const DoctorRuleView = () => {

  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  // 🔥 Backend keys
  const agentTypes = [
    "brief",
    "hypothesis",
    "prognosis",
    "risk",
    "functional",
    "treatment",
    "trajectory",
    "identity"
  ];

  // 🔥 Display names (Frontend labels)
  const agentLabels = {
    brief: "Next Visit Brief",
    hypothesis: "Clinical Hypothesis",
    prognosis: "Prognosis Layer",
    risk: "Risk Analysis",
    functional: "Functional Status",
    treatment: "Treatment Memory",
    trajectory: "Disease Trajectory",
    identity: "Disease Identity"
  };

  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState("");

  // =====================================================
  // FETCH RULES
  // =====================================================
  useEffect(() => {

    if (!doctorId) return;

    const fetchRules = async () => {
      try {

        const formData = new FormData();
        formData.append("doctor_id", doctorId);

        const res = await fetch(
          `${API_BASE_URL}hms/users/data/context/doctor-agent-rules/get-by-doctor`,
          {
            method: "POST",
            body: formData
          }
        );

        const data = await res.json();

        if (data.status === "success") {
          setRules(data.rules || {});
        }

      } catch (err) {
        console.error("Failed loading agent rules", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRules();

  }, [doctorId]);

  // =====================================================
  // AGENT CHANGE
  // =====================================================
  const handleAgentChange = (agent) => {
    setSelectedAgent(agent);
    setEditing(false);
    setEditedText(rules?.[agent] || "");
  };

  // =====================================================
  // SAVE
  // =====================================================
  const saveAgentRule = async () => {
    try {

      if (!selectedAgent) return;

      const formData = new FormData();
      formData.append("doctor_id", doctorId);
      formData.append("agent", selectedAgent);
      formData.append("rule", editedText);

      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/doctor-agent-rules/save-single`,
        {
          method: "POST",
          body: formData
        }
      );

      if (!res.ok) throw new Error();

      setRules(prev => ({
        ...prev,
        [selectedAgent]: editedText
      }));

      setEditing(false);

      alert("✅ Agent rule saved");

    } catch (err) {
      console.error(err);
      alert("❌ Failed saving rule");
    }
  };

  // =====================================================
  // UI
  // =====================================================
  return (
    <div className="min-h-screen bg-white text-black p-10">

      <h2 className="text-3xl font-bold mb-8">
        Doctor Agent Rule Dashboard
      </h2>

      {loading ? (
        <p className="text-gray-500">Loading rules...</p>
      ) : (
        <div className="max-w-3xl">

          {/* ============================= */}
          {/* AGENT DROPDOWN */}
          {/* ============================= */}
          <select
            value={selectedAgent}
            onChange={(e)=>handleAgentChange(e.target.value)}
            className="
              w-full mb-6 p-3 rounded-xl
              border border-gray-300
              bg-white text-black font-semibold
              focus:outline-none focus:ring-2 focus:ring-black
            "
          >
            <option value="">Select Agent</option>

            {agentTypes.map(a=>(
              <option key={a} value={a}>
                {agentLabels[a]}
              </option>
            ))}
          </select>

          {/* ============================= */}
          {/* RULE EDITOR */}
          {/* ============================= */}
          {selectedAgent && (

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">

              {/* HEADER */}
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-lg font-semibold">
                  {agentLabels[selectedAgent]}
                </h4>

                {!editing && (
                  <button
                    onClick={()=>setEditing(true)}
                    className="px-4 py-1 rounded-lg bg-black text-white font-semibold"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <>
                  <textarea
                    rows={10}
                    value={editedText}
                    onChange={(e)=>setEditedText(e.target.value)}
                    className="
                      w-full border border-gray-300 rounded-xl p-4
                      text-black bg-gray-50
                      focus:outline-none focus:ring-2 focus:ring-black
                    "
                  />

                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={saveAgentRule}
                      className="px-5 py-2 rounded-xl bg-black text-white font-semibold"
                    >
                      Save
                    </button>

                    <button
                      onClick={()=>setEditing(false)}
                      className="px-5 py-2 rounded-xl border border-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm whitespace-pre-wrap">
                  {rules?.[selectedAgent] || "No rule configured"}
                </div>
              )}

            </div>
          )}

        </div>
      )}

    </div>
  );
};

export default DoctorRuleView;