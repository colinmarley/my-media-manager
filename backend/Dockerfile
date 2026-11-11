FROM python:3.11-slim

# Install system dependencies (ffmpeg for media inspection, libmagic for python-magic)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libmagic1 \
    mediainfo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Strip CRLF in case the script was checked out on Windows with autocrlf.
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

EXPOSE 8082

# Runs `alembic upgrade head` (fails fast on error), then execs the CMD.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8082", "--log-level", "info"]
