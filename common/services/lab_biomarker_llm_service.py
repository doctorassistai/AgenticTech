import os
import logging
from datetime import datetime
from typing import Dict, Any
from groq import Groq

from HMS.services.enhanced_prompt import get_enhanced_medical_prompt
from HMS.services.enhanced_parser import parse_enhanced_medical_response

logger = logging.getLogger(__name__)
groq_client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)


def run_lab_biomarker_llm(text: str, document_type: str) -> Dict[str, Any]:
    try:
        prompt = get_enhanced_medical_prompt(document_type, text)
        logger.info(f"Using prompt for document type {prompt}")
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4000,
        )

        response = completion.choices[0].message.content.strip()
        logger.info(f"LLM response: {response}")
        return parse_enhanced_medical_response(response, document_type)

    except Exception as e:
        logger.error("LLM failed", exc_info=True)
        return {
            "structured_data": [],
            "medical_insights": {},
            "conditions": [],
        }
