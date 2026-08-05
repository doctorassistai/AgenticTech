FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY integration/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY integration /integration
COPY shared /shared


# run app
CMD ["uvicorn", "integration.main:app", "--host", "0.0.0.0", "--port", "8000"]
