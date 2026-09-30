FROM python:3.11-slim

# work from root (same pattern as integration)
WORKDIR /

# system deps: tesseract-ocr binary for pytesseract, libgl1 for Pillow/PyMuPDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# install dependencies
COPY EPIC_FHIR/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY EPIC_FHIR /EPIC_FHIR
COPY shared /shared


# run app
CMD ["uvicorn", "EPIC_FHIR.main:app", "--host", "0.0.0.0", "--port", "8000"]