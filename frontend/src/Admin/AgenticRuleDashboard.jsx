import React, { useState, useEffect } from "react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const AgenticRuleDashboard = () => {

    // =====================================================
    // STATE
    // =====================================================
    const [form, setForm] = useState({
        specialty: "",
        agent: "",
        rule: ""
    });

    const [adminRules, setAdminRules] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // =====================================================
    // SPECIALTIES
    // =====================================================
    const specialtyTypes = [
        "Cardiology",
        "Oncology",
        "Gastroenterology",
        "General Medicine"
    ];

    // =====================================================
    // AGENT KEYS
    // =====================================================
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

    // =====================================================
    // DISPLAY LABELS
    // =====================================================
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

    // =====================================================
    // FETCH ADMIN RULES
    // =====================================================
    useEffect(() => {

        const fetchAdminRules = async () => {
            try {

                const res = await fetch(
                    `${API_BASE_URL}hms/users/data/context/admin-agent-rules/get-all`
                );

                const data = await res.json();

                if (data.status === "success") {
                    setAdminRules(data.rules || {});
                }

            } catch (err) {
                console.error("❌ Failed to fetch admin rules", err);
            } finally {
                setLoading(false);
            }
        };

        fetchAdminRules();

    }, []);

    // =====================================================
    // SPECIALTY CHANGE
    // =====================================================
    const handleSpecialtyChange = (specialty) => {

        setForm({
            specialty,
            agent: "",
            rule: ""
        });
    };

    // =====================================================
    // AGENT CHANGE
    // =====================================================
    const handleAgentChange = (agentValue) => {

        const ruleText =
            adminRules?.[form.specialty]?.[agentValue] || "";

        setForm(prev => ({
            ...prev,
            agent: agentValue,
            rule: ruleText
        }));
    };

    // =====================================================
    // SAVE ADMIN RULE
    // =====================================================
    const saveAgentRule = async () => {

        try {

            if (!form.specialty || !form.agent || !form.rule) {
                alert("Fill all fields");
                return;
            }

            setSaving(true);

            const formData = new FormData();
            formData.append("specialty", form.specialty);
            formData.append("agent", form.agent);
            formData.append("rule", form.rule);

            const res = await fetch(
                `${API_BASE_URL}hms/users/data/context/admin-agent-rules/save-single`,
                {
                    method: "POST",
                    body: formData,
                    redirect:"manual",
                    credentials: "same-origin"
                }
            );

            if (!res.ok) throw new Error();

            alert("✅ Agent rule saved");

            // 🔥 Update local cache instantly
            setAdminRules(prev => ({
                ...prev,
                [form.specialty]: {
                    ...(prev[form.specialty] || {}),
                    [form.agent]: form.rule
                }
            }));

        } catch (err) {
            console.error(err);
            alert("❌ Failed saving");
        } finally {
            setSaving(false);
        }
    };

    // =====================================================
    // UI
    // =====================================================
    return (
        <div className="min-h-screen bg-white text-black flex items-center justify-center px-4">

            <div className="w-full max-w-xl p-10 border border-black/10 rounded-3xl shadow-lg">

                <h1 className="text-3xl font-bold mb-8 text-center">
                    Admin Agent Rule Dashboard
                </h1>

                {/* ================= SPECIALTY ================= */}
                <select
                    value={form.specialty}
                    onChange={(e)=>handleSpecialtyChange(e.target.value)}
                    className="w-full mb-4 p-3 border border-black/20 rounded-xl focus:outline-none"
                >
                    <option value="">Select Specialty</option>

                    {specialtyTypes.map(s=>(
                        <option key={s}>{s}</option>
                    ))}
                </select>

                {/* ================= AGENT ================= */}
                <select
                    value={form.agent}
                    disabled={!form.specialty}
                    onChange={(e)=>handleAgentChange(e.target.value)}
                    className="w-full mb-6 p-3 border border-black/20 rounded-xl disabled:opacity-50"
                >
                    <option value="">Select Agent</option>

                    {agentTypes.map(a=>(
                        <option key={a} value={a}>
                            {agentLabels[a]}
                        </option>
                    ))}
                </select>

                {/* ================= TEXTAREA ================= */}
                <textarea
                    rows={10}
                    value={form.rule}
                    placeholder="Enter agent rule prompt..."
                    onChange={(e)=>setForm({...form,rule:e.target.value})}
                    className="w-full mb-6 p-4 border border-black/20 rounded-xl bg-gray-50 focus:outline-none"
                />

                {/* ================= SAVE BUTTON ================= */}
                <button
                    disabled={saving}
                    onClick={saveAgentRule}
                    className="
                        w-full py-3 rounded-xl
                        bg-black text-white font-semibold
                        hover:bg-gray-800 transition
                        disabled:opacity-50
                    "
                >
                    {saving ? "Saving..." : "Save Agent Rule"}
                </button>

                {loading && (
                    <p className="text-sm text-gray-500 text-center mt-4">
                        Loading rules...
                    </p>
                )}

            </div>
        </div>
    );
};

export default AgenticRuleDashboard;