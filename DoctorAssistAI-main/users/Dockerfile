FROM python:3.11-slim

# work from root (as you originally wanted)
WORKDIR /

# install dependencies
COPY users/requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# copy source code
COPY users /users
COPY shared /shared


# run app
CMD ["uvicorn", "users.main:app", "--host", "0.0.0.0", "--port", "8000"]
