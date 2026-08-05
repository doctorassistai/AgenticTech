FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY orchestration/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY orchestration /orchestration
COPY shared /shared


# run app
CMD ["uvicorn", "orchestration.main:app", "--host", "0.0.0.0", "--port", "8000"]
