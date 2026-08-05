from pydantic import BaseModel

class AbhaInitRequest(BaseModel):
    mobile: str

class AbhaConfirmRequest(BaseModel):
    txnId: str
    otp: str
