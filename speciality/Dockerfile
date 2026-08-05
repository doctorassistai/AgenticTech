FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# system dependencies
# - poppler-utils: required by pdf2image (Stage 1 vision transcription)
# - tesseract-ocr: required by pytesseract (already in requirements.txt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# install dependencies
COPY speciality/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY speciality /speciality
COPY shared /shared


# run app
CMD ["uvicorn", "speciality.main:app", "--host", "0.0.0.0", "--port", "8000"]