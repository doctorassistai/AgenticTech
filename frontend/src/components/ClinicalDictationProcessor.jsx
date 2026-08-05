import React, { useState } from "react";
import { 
  Loader2, 
  Activity, 
  ClipboardList, 
  Pill, 
  FlaskConical,
  AlertCircle,
  CheckCircle2,
  Stethoscope,
  FileText,
  Calendar,
  User,
  Hash
} from "lucide-react";
const API_BASE = import.meta.env.VITE_BACKEND_URL

const API_URL =
  `${API_BASE}hms/users/orchestration/process-clinical-dictation`;

export default function ClinicalDictationProcessor({
  doctorId,
  patientId,
  dictationText,
}) {
  const [loading, setLoading] = useState(false);
  const [clinicalData, setClinicalData] = useState(null);
  const [error, setError] = useState("");

  const handleGenerateClinicalNote = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId,
          patient_id: patientId,
          dictation: dictationText,
        }),
      });

      const data = await response.json();
        console.log("aleena", data);

        if (data.clinical_data) {
        setClinicalData(data.clinical_data);
        } else {
        setError(data.message || "Failed to extract clinical data.");
        }
    } catch (err) {
      setError("Server error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const colorMap = {
  blue: {
    bg: "bg-blue-100",
    text: "text-blue-600"
  },
  purple: {
    bg: "bg-purple-100",
    text: "text-purple-600"
  },
  green: {
    bg: "bg-green-100",
    text: "text-green-600"
  },
  orange: {
    bg: "bg-orange-100",
    text: "text-orange-600"
  },
  indigo: {
    bg: "bg-indigo-100",
    text: "text-indigo-600"
  },
  teal: {
    bg: "bg-teal-100",
    text: "text-teal-600"
  }
};

const SectionHeader = ({ icon: Icon, title, color = "blue" }) => {
  const selectedColor = colorMap[color] || colorMap.blue;

  return (
    <div className="flex items-center space-x-2 mb-4">
      <div className={`p-2 rounded-lg ${selectedColor.bg}`}>
        <Icon className={`w-5 h-5 ${selectedColor.text}`} />
      </div>
      <h3 className="font-semibold text-lg text-gray-800">{title}</h3>
    </div>
  );
};


  const InfoCard = ({ children, className = "" }) => (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 ${className}`}>
      {children}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-2xl border border-blue-100">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Stethoscope className="w-7 h-7 text-blue-600" />
              Clinical Note Generator
            </h2>
            <p className="text-gray-600 mt-1">
              Transform dictation into structured clinical documentation
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <User className="w-4 h-4" />
              <span>ID: {patientId}</span>
            </div>
            <div className="flex items-center gap-1">
              <Hash className="w-4 h-4" />
              <span>Dr: {doctorId}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div className="flex justify-center mb-8">
        <button
          onClick={handleGenerateClinicalNote}
          disabled={loading}
          className={`
            relative px-8 py-4 rounded-xl font-semibold text-white
            transition-all duration-200 transform hover:scale-105
            ${loading 
              ? 'bg-blue-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'
            }
          `}
        >
          {loading ? (
            <div className="flex items-center space-x-3">
              <Loader2 className="animate-spin w-5 h-5" />
              <span>Processing Dictation...</span>
            </div>
          ) : (
            <div className="flex items-center space-x-3">
              <FileText className="w-5 h-5" />
              <span>Generate Clinical Note</span>
            </div>
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Clinical Data Display */}
      {clinicalData && (
        <div className="space-y-8">
          {/* Success Banner */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <p className="text-green-700 font-medium">
              Clinical note successfully generated from dictation
            </p>
          </div>

          {/* Diagnosis Section */}
          <InfoCard>
            <div className="p-6">
              <SectionHeader icon={ClipboardList} title="Diagnosis & Clinical Assessment" color="purple" />
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-sm font-medium text-purple-700 mb-2">Primary Diagnosis</p>
                    <p className="text-gray-800">{clinicalData.primary_diagnosis}</p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm font-medium text-blue-700 mb-2">Differential Diagnoses</p>
                    <ul className="list-disc list-inside space-y-1">
                      {clinicalData.differential_diagnoses?.map((d, i) => (
                        <li key={i} className="text-gray-700">{d}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-700 mb-2">Clinical Assessment</p>
                  <p className="text-gray-800 leading-relaxed">{clinicalData.clinical_assessment}</p>
                </div>
              </div>
            </div>
          </InfoCard>

          {/* Symptoms & Findings */}
          <div className="grid md:grid-cols-2 gap-6">
            <InfoCard>
              <div className="p-6">
                <SectionHeader icon={Activity} title="Symptoms" color="orange" />
                <div className="bg-orange-50 rounded-lg p-4">
                  <ul className="space-y-2">
                    {clinicalData.symptoms?.map((s, i) => (
                      <li key={i} className="flex items-start space-x-2">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mt-2"></span>
                        <span className="text-gray-700">{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </InfoCard>

            <InfoCard>
              <div className="p-6">
                <SectionHeader icon={ClipboardList} title="Clinical Findings" color="green" />
                <div className="bg-green-50 rounded-lg p-4">
                  <ul className="space-y-2">
                    {clinicalData.clinical_findings?.map((f, i) => (
                      <li key={i} className="flex items-start space-x-2">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mt-2"></span>
                        <span className="text-gray-700">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </InfoCard>
          </div>

          {/* SOAP Note */}
          <InfoCard>
            <div className="p-6">
              <SectionHeader icon={FileText} title="SOAP Note" color="indigo" />
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-indigo-50 p-4 rounded-lg">
                  <p className="font-medium text-indigo-700 mb-2">Subjective</p>
                  <p className="text-gray-700">{clinicalData.soap_note?.subjective}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-lg">
                  <p className="font-medium text-indigo-700 mb-2">Objective</p>
                  <p className="text-gray-700">{clinicalData.soap_note?.objective}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-lg">
                  <p className="font-medium text-indigo-700 mb-2">Assessment</p>
                  <p className="text-gray-700">{clinicalData.soap_note?.assessment}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-lg">
                  <p className="font-medium text-indigo-700 mb-2">Plan</p>
                  <p className="text-gray-700">{clinicalData.soap_note?.plan}</p>
                </div>
              </div>
            </div>
          </InfoCard>

          {/* Treatment Plan */}
          <InfoCard>
            <div className="p-6">
              <SectionHeader icon={Activity} title="Treatment Plan" color="teal" />
              <div className="bg-teal-50 p-4 rounded-lg">
                <p className="text-gray-800 leading-relaxed">{clinicalData.treatment_plan}</p>
              </div>
            </div>
          </InfoCard>

          {/* Prescriptions */}
          <InfoCard>
            <div className="p-6">
              <SectionHeader icon={Pill} title="Prescriptions" color="blue" />
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Medicine</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Strength</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dosage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Frequency</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Route</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Instructions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {clinicalData.prescriptions?.map((med, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{med.medicine_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{med.strength}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{med.dosage}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{med.frequency}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{med.route}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{med.special_instructions || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </InfoCard>

          {/* Investigations */}
          <InfoCard>
            <div className="p-6">
              <SectionHeader icon={FlaskConical} title="Investigations" color="purple" />
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Test Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Urgency</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Clinical Reason</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {clinicalData.investigations?.map((test, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{test.test_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{test.category}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            test.urgency === 'STAT' ? 'bg-red-100 text-red-700' :
                            test.urgency === 'Urgent' ? 'bg-orange-100 text-orange-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {test.urgency || 'Routine'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">{test.clinical_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </InfoCard>
        </div>
      )}
    </div>
  );
}