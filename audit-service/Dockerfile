# FROM python:3.11-slim

# WORKDIR /app
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# COPY app/ app/

# CMD ["python", "app/main.py"]


FROM python:3.11-slim

WORKDIR /

COPY audit-service/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

COPY audit-service/app /audit-service/app
COPY shared /shared

ENV PYTHONPATH=/audit-service

# CMD ["python", "-u","/audit-service/app/main.py"]

CMD ["uvicorn", "audit-service.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

