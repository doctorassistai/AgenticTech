from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta



class Users(BaseModel):
    sys_user_id: str # long globally unique id
    doctor_assist_id: str # short id unique for doctor assist system
    email: Optional[str]= None
    phone_number: str
    username: str
    password: str
    role: str  # 'doctor', 'staff', 'patient'
    user_type: Optional[str] = None  # 'trial_account', 'paid_account'
    status: str  # 'active', 'inactive'
    created_at: Optional[datetime] = None
    renewed_at: Optional[datetime] = None
    
class Hospital(BaseModel):
    name: str
    address: Optional[str]
    headquarters: Optional[str]
    username: str
    hospital_id: str # short id unique for doctor assist system
    sys_user_id: str # long globally unique id
    email: Optional[str]= None
    phone_number: str
    no_of_staff: int
    no_of_beds: int
    country_code: str
    hospital_user_type: str  # 'hms_integration', 'da user', 'iframe user'
    created_at: Optional[datetime] = None

class Doctor(BaseModel):
    name: str
    hospital_id: str 
    sys_user_id: str # long globally unique id
    doctor_id: str # short id unique for doctor assist system
    email: Optional[str]= None
    phone_number: str
    username: str
    address: Optional[str] = None
    hospital_name: Optional[str] = None
    country_code: str
    qualifications: Optional[str] = None
    specialization: str
    registeration_number: Optional[str] = None
    created_at: Optional[datetime] = None

class PatientDemoGraphic(BaseModel):
    sys_user_id: str # long globally unique id
    patient_id: str # short id unique for doctor assist system
    hospital_id: str
    name: str
    date_of_birth: str
    gender: str
    email: Optional[str] = None
    phone_number: str
    blood_group: Optional[str] = None
    marital_status: Optional[str] = None
    address: Optional[str] = None
    education: Optional[str] = None
    occupation: Optional[str] = None
    annual_income: Optional[str] = None
    family_history: Optional[str] = None
    hms_id: Optional[str] = None
    created_at: Optional[datetime] = None

class SingleAppointment(BaseModel):
    appointment_id: Optional[str]
    doctor_id: str
    scheduled_time: Optional[str]
    date: Optional[str]
    visit_type: Optional[str]
    chief_complaint: Optional[str] = None


class Appointments(BaseModel):
    sys_user_id: str
    patient_id: str
    appointments: List[SingleAppointment] = []


