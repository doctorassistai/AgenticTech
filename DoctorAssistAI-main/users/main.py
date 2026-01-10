from fastapi import FastAPI, Request
from .patient_data.data import router as patient_data_router
from .patient_data.watsapp import router as watsapp_router


app = FastAPI()

app.include_router(patient_data_router)
app.include_router(watsapp_router)

@app.get("/health")
def health():
    return {"status": "healthy"}