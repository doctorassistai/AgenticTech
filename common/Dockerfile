FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    poppler-utils \
    libgl1 \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# install dependencies
COPY common/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY common /common
COPY shared /shared

# run app
CMD ["uvicorn", "common.main:app", "--host", "0.0.0.0", "--port", "8000"]