FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY ai_service/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY ai_service /ai_service
COPY shared /shared


# run app
CMD ["uvicorn", "ai_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
