FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY speciality/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY speciality /speciality
COPY shared /shared


# run app
CMD ["uvicorn", "speciality.main:app", "--host", "0.0.0.0", "--port", "8000"]
