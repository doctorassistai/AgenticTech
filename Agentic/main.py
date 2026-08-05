from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
import logging
import random
import string
import sys
import pytz
import socket
import platform
import httpx
import asyncio
import json
import queue
import threading
from passlib.context import CryptContext
from functools import wraps, partial
import uuid
import os
import aiofiles
import shutil
import re
import copy
import traceback
from PIL import Image

from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from Agentic.Agentic import router
from Agentic.resuable_agentic import router as reusable_router
from Agentic.reusable_insurance_output_agentic import router as reusable_insurance_output_router
# from Agentic.routes import routers
from Agentic.routes import router as clinical
from langchain_openai import ChatOpenAI
from langchain_groq import ChatGroq
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from Agentic.patient_summary import router as patient_summary_router
from Agentic.Smart_routing_agent import router as smartrouting_router
from Agentic.FinalEDSummary import router as final_ed_summary_router
from Agentic.document_router import router as document_router
from Agentic.summary_clinical import router as summary_router
from Agentic.procedure_agentic import router as procedure_router
import base64
from Agentic.ip_patient_onboarding import router as ip_patient_onboarding_router
from Agentic.diagnostic_agent import router as diagnostic_router
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from Agentic.treatment_plan_agent import router as treatment_plan_router
from Agentic.tumour_board_agent import router as tumour_board_router
from Agentic.emergency import router as emergency_router
from Agentic.ambulance import router as ambulance_router
from Agentic.preprocedure import router as preprocedure
from Agentic.treatmentprogress import router as treatmentprogress
from Agentic.overnight import router as overnight
from Agentic.scoring import router as scoring
from Agentic.Toxicity_surveillance import router as Toxicity_surveillance
from Agentic.document_progress import progress_router as document_progress
from Agentic.genomics import router as genomics
from Agentic.oman import router as oman
from Agentic.document_pipeline import router as document_model
from Agentic.EmergencyStructuredNote import router as emergency_structured_note_router
from Agentic.document_pipeline import router as document_agents
from Agentic.Emergency_Insurance import router as emergency_insurance_router
from Agentic.ambulance_image_extraction import router as ambulance_image_extraction_router
from Agentic.document_pipeline import router as document_pipeline
from Agentic.graph_writer import router as graph_writer_router
from Agentic.evidence_pipeline import router as knowledge_graph_pipeline_router
from Agentic.evidence_graph_writer import router as kg_graph_router
from Agentic.evidence_graph_comparison import router as evidence_graph_comparison 
from Agentic.predictdiseasis import router as predictdiseasis
from Agentic.medicationanalysis import router as medicationanalysis
from Agentic.patienteducation import router as patienteducation
from Agentic.phase1_router import router as phase1_router
# from Agentic.phase2_router import router as phase2_router
# from Agentic.phase3_router import router as phase3_router
from Agentic.discharge_agent import router as discharge_agent
from Agentic.discharge_validation import router as discharge_validation
from Agentic.Discharge_report_agent import router as Discharge_report_agent
from Agentic.soul_router import router as soul_router
from fastapi.middleware.cors import CORSMiddleware
from Agentic.surgical_oncology_summary import router as surgical_oncology_summary
from Agentic.radiation_oncology_summary import router as radiation_oncology_summary
from Agentic.Care_pathway_sequencing_agent import router as care_pathway_sequencing_router
from Agentic.skill_markdown_router import router as skill_markdown_router
from Agentic.preview_skill_markdown_router import router as preview_skill_markdown_router
from Agentic.diagnostics_agent import router as diagnostic_skill_router
from Agentic.treatment_plans_agent import router as treatment_skill_router
from Agentic.followup_agent import router as followup_agent
from Agentic.discharge_summary_synoptic import router as discharge_summary_synoptic
from Agentic.Synoptic import router as Synoptic
from Agentic.longitudinal_summary import router as longitudinal_summary
from Agentic.oncology_case_view_service import router as case_view_router

load_dotenv()


SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")
os.environ['OPENAI_API_KEY']=os.getenv("OPENAI_API_KEY")



app = FastAPI(
    title="Agentic Service",
    description="AI-powered agentic service for DoctorAs",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "service": "Agentic Service",
        "status": "running",
        "version": "1.0.0"
    }

@app.get("/health")
async def health():
    return {"status": "healthy and here"}


@router.post("/chat1")
async def chat(payload: dict):
    return {"reply": "hello from agentic"}






 

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)

model = ChatGroq(
    model="llama-3.1-8b-instant",
    groq_api_key=api_key
)





# Output parser
parser = StrOutputParser()

def translate_text(
    text: str,
    language: str,
    model
) -> str:
    """
    Translate text into the specified language using LangChain + ChatGroq.
    """

    generic_template = "Translate the following into {language}:"

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", generic_template),
            ("user", "{text}")
        ]
    )

    chain = prompt | model | parser

    result = chain.invoke({
        "language": language,
        "text": text
    })

    return result



# groq_api_key = os.getenv("GROQ_API_KEY")

# model = ChatGroq(
#     model="Gemma2-9b-It",
#     groq_api_key=groq_api_key
# )


@app.post("/translate")
def translate_api(
    text: str = Form(...),
    language: str = Form(...)
):
    try:
        translation = translate_text(text, language, model)
        return {"translation": translation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





#Image OCR

# Function to encode the image



# os.environ['OPENAI_API_KEY']=os.getenv("OPENAI_API_KEY")



# ## Langsmith Tracking
# os.environ["LANGCHAIN_API_KEY"]=os.getenv("LANGCHAIN_API_KEY")
# os.environ["LANGCHAIN_TRACING_V2"]="true"
# os.environ["LANGCHAIN_PROJECT"]=os.getenv("LANGCHAIN_PROJECT")


OLLAMA_URL = "http://ollama:11434"




# @app.post("/ollama/chat", response_model=OllamaChatResponse)
# # async def chat_with_ollama(payload: OllamaChatRequest):
#     try:
#         async with httpx.AsyncClient(timeout=60) as client:
#             response = await client.post(
#                 f"{OLLAMA_URL}/api/chat",
#                 json={
#                     "model": payload.model,
#                     "messages": [
#                         {
#                             "role": "user",
#                             "content": payload.prompt
#                         }
#                     ],
#                     "options": {
#                         "temperature": payload.temperature
#                     }
#                 }
#             )

#         if response.status_code != 200:
#             raise HTTPException(
#                 status_code=500,
#                 detail=f"Ollama error: {response.text}"
#             )

#         data = response.json()

#         return OllamaChatResponse(
#             response=data["message"]["content"]
#         )

#     except Exception as e:
#         logging.exception("Ollama chat failed")
#         raise HTTPException(status_code=500, detail=str(e))



# from langchain_text_splitters import RecursiveCharacterTextSplitter

# text_splitter=RecursiveCharacterTextSplitter(chunk_size=1000,chunk_overlap=200)
# documents=text_splitter.split_documents(docs)


# from langchain_openai import OpenAIEmbeddings
# embeddings=OpenAIEmbeddings()


# from langchain_community.vectorstores import FAISS
# vectorstoredb=FAISS.from_documents(documents,embeddings)

# query="LangSmith has two usage limits: total traces and extended"
# result=vectorstoredb.similarity_search(query)
# result[0].page_content


# from langchain_openai import ChatOpenAI
# llm=ChatOpenAI(model="gpt-4o")

# from langchain.chains.combine_documents import create_stuff_documents_chain
# from langchain_core.prompts import ChatPromptTemplate

# prompt=ChatPromptTemplate.from_template(
#     """
# Answer the following question based only on the provided context:
# <context>
# {context}
# </context>


# """
# )

# document_chain=create_stuff_documents_chain(llm,prompt)
# document_chain


# from langchain_core.documents import Document
# document_chain.invoke({
#     "input":"LangSmith has two usage limits: total traces and extended",
#     "context":[Document(page_content="LangSmith has two usage limits: total traces and extended traces. These correspond to the two metrics we've been tracking on our usage graph. ")]
# })



# retriever=vectorstoredb.as_retriever()
# from langchain.chains import create_retrieval_chain
# retrieval_chain=create_retrieval_chain(retriever,document_chain)

app.include_router(router)
app.include_router(reusable_router)
app.include_router(reusable_insurance_output_router)
app.include_router(clinical, prefix="/api/v2")
app.include_router(diagnostic_router)
app.include_router(patient_summary_router)
app.include_router(document_router)
app.include_router(treatment_plan_router)
app.include_router(summary_router)
app.include_router(tumour_board_router)
app.include_router(procedure_router)
app.include_router(ip_patient_onboarding_router)
app.include_router(emergency_router)
app.include_router(preprocedure)
app.include_router(treatmentprogress)
app.include_router(scoring)
app.include_router(overnight)
app.include_router(Toxicity_surveillance)
app.include_router(document_progress)
app.include_router(ambulance_router)
app.include_router(genomics)
app.include_router(oman)
app.include_router(smartrouting_router)
app.include_router(document_model)
app.include_router(document_agents)
app.include_router(document_pipeline)
app.include_router(graph_writer_router) 
app.include_router(evidence_graph_comparison) 
app.include_router(knowledge_graph_pipeline_router)
app.include_router(kg_graph_router)
app.include_router(predictdiseasis)
app.include_router(final_ed_summary_router)
app.include_router(medicationanalysis)
app.include_router(emergency_structured_note_router)
app.include_router(patienteducation)
app.include_router(emergency_insurance_router)
app.include_router(ambulance_image_extraction_router)
app.include_router(discharge_agent)
app.include_router(discharge_validation)
app.include_router(Discharge_report_agent)
app.include_router(phase1_router)
app.include_router(surgical_oncology_summary)
# app.include_router(phase2_router)
# app.include_router(phase3_router)
app.include_router(soul_router)
app.include_router(radiation_oncology_summary)
app.include_router(care_pathway_sequencing_router)
app.include_router(skill_markdown_router)
app.include_router(preview_skill_markdown_router)
app.include_router(diagnostic_skill_router)
app.include_router(treatment_skill_router)
app.include_router(followup_agent)
app.include_router(discharge_summary_synoptic)
app.include_router(Synoptic)
app.include_router(longitudinal_summary)
app.include_router(case_view_router)