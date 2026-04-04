FROM python:3.10-slim

# System deps for PDF parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libmagic1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install PyMuPDF for PDF text extraction (classify endpoint)
RUN pip install --no-cache-dir PyMuPDF

# Copy app code
COPY . .

# Create data directories
RUN mkdir -p /app/data/rag_storage /app/data/inputs /app/data/output

EXPOSE 9621

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9621", "--timeout-keep-alive", "300"]
