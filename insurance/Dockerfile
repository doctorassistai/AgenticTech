FROM python:3.11-slim

# =========================================================
# SYSTEM LIBRARIES REQUIRED
# =========================================================

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    build-essential \
    pkg-config \
    libcairo2 \
    libcairo2-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libglib2.0-0 \
    libglib2.0-dev \
    libffi-dev \
    shared-mime-info \
    gir1.2-pango-1.0 \
    gir1.2-gtk-3.0 \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# =========================================================
# WORKDIR
# =========================================================

WORKDIR /

# =========================================================
# INSTALL PYTHON DEPENDENCIES
# =========================================================

COPY insurance/requirements.txt /requirements.txt

RUN pip install --upgrade pip

RUN pip install --no-cache-dir -r /requirements.txt

# =========================================================
# COPY PROJECT
# =========================================================

COPY insurance /insurance

# =========================================================
# APP WORKDIR
# =========================================================

WORKDIR /insurance

# =========================================================
# START SERVER
# =========================================================

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]