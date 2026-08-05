FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY ai_service/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY ai_service /ai_service
COPY shared /shared

# Ensure temp directory exists with proper permissions
RUN mkdir -p /tmp/elevenlabs_audio && chmod 777 /tmp/elevenlabs_audio

# run app
CMD ["uvicorn", "ai_service.main:app", "--host", "0.0.0.0", "--port", "8000"]