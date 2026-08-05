# FROM python:3.11-slim

# WORKDIR /

# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# # 👇 THIS IS THE KEY LINE
# COPY ../shared /shared

# COPY . .

# CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY gateway/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY gateway /gateway
COPY shared /shared


# run app
CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
