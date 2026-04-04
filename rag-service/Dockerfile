FROM python:3.10-slim

# System deps for MinerU + PDF parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libmagic1 \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    fonts-noto-core \
    fontconfig \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps (MinerU + RAG-Anything + FastAPI)
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# Verify mineru CLI is installed and in PATH
RUN which mineru && mineru --version || echo "WARNING: mineru CLI not found"

# Ensure pip script dir is in PATH
ENV PATH="/usr/local/bin:$PATH"

# Download MinerU models (baked into image so no first-run delay)
RUN mineru-models-download -s huggingface -m all || echo "Model download skipped — will download on first use"

# Copy app code
COPY . .

# Create data directories
RUN mkdir -p /app/data/rag_storage /app/data/inputs /app/data/output

# Set model source to local (use pre-downloaded models)
ENV MINERU_MODEL_SOURCE=local

EXPOSE 9621

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9621", "--timeout-keep-alive", "300"]
