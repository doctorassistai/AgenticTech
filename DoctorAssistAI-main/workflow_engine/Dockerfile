FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY workflow_engine/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY workflow_engine /workflow_engine
COPY shared /shared


# run app
CMD ["uvicorn", "workflow_engine.main:app", "--host", "0.0.0.0", "--port", "8000"]
