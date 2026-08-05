FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    make \
    cmake \
    git \
    curl \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /

RUN pip install --upgrade pip

# Install CPU-only PyTorch FIRST
RUN pip install \
    torch \
    torchvision \
    torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

COPY Agentic/requirements.txt /requirements.txt
RUN pip install -r /requirements.txt

COPY Agentic /Agentic
COPY shared /shared

CMD ["uvicorn", "Agentic.main:app", "--host", "0.0.0.0", "--port", "8000"]