# FROM python:3.11-slim

# # work from root (as you originally wanted)
# WORKDIR /app

# # install dependencies
# COPY /requirements.txt /requirements.txt
# RUN pip install --no-cache-dir -r /requirements.txt

# # copy source code
# COPY  app app


FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Install dependencies
COPY abha/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# Copy the source code into the container's /app directory
COPY abha/app /app

# Run the FastAPI app with Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
