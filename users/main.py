from fastapi import FastAPI, Request
from .patient_data.data import router as patient_data_router
from .patient_data.watsapp import router as watsapp_router
from .patient_data.patientcontext import router as patientcontext_router
from .patient_data.surgical_oncology import router as surgical_router
from users.integration.integration_data import router as integration_router
from .patient_data.palliative_assessment_api import router as palliative_router
from .patient_data.protocol_master import router as protocol_master_router
from .patient_data.Radiotherapy_protocol_master import router as radiotherapy_protocol_master_router
from .patient_data.anaesthesia import router as anaesthesia_router
from .patient_data.onco_pathology import router as oncopatho_router
from .patient_data.rheumatology_intake_api import router as rheumatology_router
from .patient_data.rheumatology_joint_map_api import router as rheumatology_joint_map_router
from .patient_data.rheumatology_differential_diagnosis_api import router as differential_router
from .patient_data.rheumatology_investigation_planner_api import router as investigation_planner_router
from .patient_data.rheumatology_lab_trends_api import router as rheumatology_lab_trends_router
from .patient_data.rheumatology_disease_activity_api import router as disease_activity_router
from .patient_data.rheumatology_treatment_decision_api import router as treatment_decision_router
from .patient_data.rheumatology_dmard_safety_api import router as rheumatology_safety_router
from .patient_data.rheumatology_treatment_ledger_api import router as treatment_ledger_router
from .patient_data.rheumatology_flare_prediction_api import router as flare_prediction_router
from .patient_data.rheumatology_comorbidity_risk_api import router as comorbidity_risk_router
from .patient_data.rheumatology_imaging_api import router as rheumatology_imaging_router
from .patient_data.rheumatology_manifestation_api import router as rheumatology_manifestation_router
from .patient_data.rheumatology_steroid_stewardship_api import router as steroid_stewardship_router
from .patient_data.rheumatology_followup_api import router as followup_router
from .patient_data.rheumatology_treat_to_target_api import router as treat_to_target_router
from .patient_data.rheumatology_patient_monitoring_api import router as patient_monitoring_router
from .patient_data.rheumatology_structured_note_api import router as rheumatology_structured_note_router
from .patient_data.rheumatology_biomarker_analysis_api import router as rheumatology_biomarker_router
from .patient_data.rheumatology_correlation_api import router as rheumatology_correlation_router
from .patient_data.rheumatology_treatment_response_api import router as rheumatology_treatment_response_router
from .patient_data.rheumatology_ai_consultation_api import router as rheumatology_ai_consultation_router
from .patient_data.rheumatology_procedure_api import router as rheumatology_procedure_router
from .patient_data.rheumatology_timeline_api import router as rheumatology_timeline_router
from .patient_data.neuropsychiatry import router as neuropsychiatry_router
from .patient_data.nephrology import router as nephrology_router
from .patient_data.microbiology import router as microbiology_router
from .patient_data.pulmonology import router as pulmonology_router

from .scheduler import router as scheduler_router
from fastapi.staticfiles import StaticFiles
import os
from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI, Path, HTTPException
from fastapi.responses import FileResponse
import os, mimetypes

app = FastAPI()

UPLOAD_DIR = "/root/AiEngine/4.1.7_beta/DoctorAssist-AiEngine/users/patient_data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Mount the folder at /uploads URL
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")



@app.get("/view/{file_path:path}")
async def view_file(file_path: str = Path(...)):
    full_path = os.path.join(UPLOAD_DIR, file_path)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    media_type, _ = mimetypes.guess_type(full_path)
    media_type = media_type or "application/octet-stream"
    return FileResponse(full_path, media_type=media_type)

@app.get("/")
def root():
    return {"message": "Access uploaded files at /uploads/<filename>"}

app.include_router(patient_data_router)
app.include_router(watsapp_router)
app.include_router(integration_router)
app.include_router(patientcontext_router)
app.include_router(scheduler_router)
app.include_router(surgical_router)
app.include_router(palliative_router)   # ← ADD THIS
app.include_router(protocol_master_router)
app.include_router(radiotherapy_protocol_master_router)
app.include_router(anaesthesia_router)
app.include_router(oncopatho_router)
app.include_router(rheumatology_router)
app.include_router(rheumatology_joint_map_router)
app.include_router(differential_router)
app.include_router(investigation_planner_router)
app.include_router(rheumatology_lab_trends_router)
app.include_router(disease_activity_router)
app.include_router(treatment_decision_router)
app.include_router(rheumatology_safety_router)
app.include_router(treatment_ledger_router)
app.include_router(flare_prediction_router)
app.include_router(comorbidity_risk_router)
app.include_router(rheumatology_imaging_router)
app.include_router(rheumatology_manifestation_router)
app.include_router(steroid_stewardship_router)
app.include_router(followup_router)
app.include_router(treat_to_target_router)
app.include_router(patient_monitoring_router)
app.include_router(rheumatology_structured_note_router)
app.include_router(rheumatology_biomarker_router)
app.include_router(rheumatology_correlation_router)
app.include_router(rheumatology_treatment_response_router)
app.include_router(rheumatology_ai_consultation_router)
app.include_router(rheumatology_procedure_router)
app.include_router(rheumatology_timeline_router)
app.include_router(neuropsychiatry_router)
app.include_router(nephrology_router)
app.include_router(microbiology_router)
app.include_router(pulmonology_router)

@app.get("/health")
def health():
    return {"status": "healthy"}