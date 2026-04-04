"""
RAG-Anything FastAPI Server
Drop-in replacement for LightRAG server with multimodal support + auto-categorization.
Matches all endpoints that lightragClient.ts calls.
"""

import os
import uuid
import json
import shutil
import asyncio
import tempfile
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Request, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from lightrag.utils import EmbeddingFunc

from gemini_funcs import gemini_llm_func, gemini_vision_func, gemini_embed_func
from classifier import classify_document

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rag-service")

# ── Config ────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
API_KEY = os.getenv("LIGHTRAG_API_KEY", "")
WORKING_DIR = os.getenv("WORKING_DIR", "/app/data/rag_storage")
INPUT_DIR = os.getenv("INPUT_DIR", "/app/data/inputs")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/app/data/output")
PORT = int(os.getenv("PORT", "9621"))

# Ensure dirs exist
for d in [WORKING_DIR, INPUT_DIR, OUTPUT_DIR]:
    Path(d).mkdir(parents=True, exist_ok=True)

# ── Global state ──────────────────────────────────────────
rag = None
processing_tasks: dict[str, str] = {}  # track_id -> status


def verify_api_key(x_api_key: str | None) -> None:
    """Verify X-API-Key header if API_KEY is set."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize RAG-Anything on startup."""
    global rag
    logger.info("Initializing RAG-Anything...")

    try:
        from raganything import RAGAnything, RAGAnythingConfig

        config = RAGAnythingConfig(working_dir=WORKING_DIR)

        embedding_func = EmbeddingFunc(
            embedding_dim=768,
            max_token_size=2048,
            func=gemini_embed_func,
        )

        rag = RAGAnything(
            config=config,
            llm_model_func=gemini_llm_func,
            vision_model_func=gemini_vision_func,
            embedding_func=embedding_func,
        )

        # Ensure LightRAG is initialized with explicit kwargs
        from lightrag import LightRAG
        rag.lightrag = LightRAG(
            working_dir=WORKING_DIR,
            llm_model_func=gemini_llm_func,
            embedding_func=embedding_func,
        )
        await rag.lightrag.initialize_storages()
        logger.info("RAG-Anything initialized successfully with LightRAG instance")
    except ImportError:
        # Fallback: use plain LightRAG if raganything not available
        logger.warning("RAG-Anything not available, falling back to LightRAG")
        from lightrag import LightRAG

        embedding_func = EmbeddingFunc(
            embedding_dim=768,
            max_token_size=2048,
            func=gemini_embed_func,
        )

        rag = LightRAG(
            working_dir=WORKING_DIR,
            llm_model_func=gemini_llm_func,
            embedding_func=embedding_func,
        )

    yield

    # Cleanup
    if hasattr(rag, "finalize_storages"):
        await rag.finalize_storages()
    logger.info("RAG-Anything shutdown complete")


app = FastAPI(title="RAG-Anything Service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ═══════════════════════════════════════════════════════════
# GET /health
# ═══════════════════════════════════════════════════════════
@app.get("/health")
async def health():
    return {"status": "ok", "engine": "rag-anything" if rag else "none"}


# ═══════════════════════════════════════════════════════════
# POST /documents/upload — File upload + index (async)
# ═══════════════════════════════════════════════════════════
@app.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)

    track_id = str(uuid.uuid4())[:8]
    processing_tasks[track_id] = "processing"

    # Save uploaded file
    file_path = os.path.join(INPUT_DIR, file.filename or f"{track_id}.pdf")
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    logger.info(f"Received file: {file.filename} ({len(content)} bytes), track_id={track_id}")

    # Process in background
    async def process():
        try:
            if hasattr(rag, "process_document_complete"):
                # RAG-Anything path
                await rag.process_document_complete(
                    file_path=file_path,
                    output_dir=OUTPUT_DIR,
                    parse_method="auto",
                )
            else:
                # LightRAG fallback — read text and insert
                import fitz  # PyMuPDF

                doc = fitz.open(file_path)
                text = "\n".join(page.get_text() for page in doc)
                doc.close()
                await rag.ainsert(text)

            processing_tasks[track_id] = "completed"
            logger.info(f"Document processed successfully: {track_id}")
        except Exception as e:
            processing_tasks[track_id] = f"failed: {str(e)}"
            logger.error(f"Document processing failed: {track_id} — {e}")

    asyncio.create_task(process())

    return {"track_id": track_id, "status": "processing", "filename": file.filename}


# ═══════════════════════════════════════════════════════════
# POST /documents/text — Raw text insertion
# ═══════════════════════════════════════════════════════════
@app.post("/documents/text")
async def insert_text(
    request: Request,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)
    body = await request.json()
    text = body.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    if hasattr(rag, "lightrag"):
        await rag.lightrag.ainsert(text)
    else:
        await rag.ainsert(text)

    return {"status": "success"}


# ═══════════════════════════════════════════════════════════
# POST /documents/classify — Auto-categorize document (NEW)
# ═══════════════════════════════════════════════════════════
@app.post("/documents/classify")
async def classify_doc(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)

    content = await file.read()

    # Extract text from PDF
    text = ""
    try:
        import fitz  # PyMuPDF

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        doc = fitz.open(tmp_path)
        text = "\n".join(page.get_text() for page in doc)
        doc.close()
        os.unlink(tmp_path)
    except Exception as e:
        # If PDF parsing fails, try as plain text
        try:
            text = content.decode("utf-8", errors="ignore")
        except Exception:
            raise HTTPException(status_code=400, detail=f"Cannot extract text: {e}")

    if not text.strip():
        raise HTTPException(status_code=400, detail="No text extracted from document")

    # Classify using Gemini
    metadata = await classify_document(text, GEMINI_API_KEY)
    return metadata


# ═══════════════════════════════════════════════════════════
# POST /query — Text query with mode
# ═══════════════════════════════════════════════════════════
@app.post("/query")
async def query(
    request: Request,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)
    body = await request.json()
    q = body.get("query", "")
    param = body.get("param", {})
    mode = param.get("mode", "hybrid")

    if not q:
        raise HTTPException(status_code=400, detail="No query provided")

    try:
        if hasattr(rag, "aquery"):
            result = await rag.aquery(q, param={"mode": mode})
        else:
            result = "RAG not initialized"
        return {"response": result}
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════
# POST /query/stream — Streaming response (NDJSON)
# ═══════════════════════════════════════════════════════════
@app.post("/query/stream")
async def query_stream(
    request: Request,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)
    body = await request.json()
    q = body.get("query", "")
    param = body.get("param", {})
    mode = param.get("mode", "hybrid")

    if not q:
        raise HTTPException(status_code=400, detail="No query provided")

    try:
        result = await rag.aquery(q, param={"mode": mode})

        async def stream():
            yield json.dumps({"response": result}) + "\n"

        return StreamingResponse(stream(), media_type="application/x-ndjson")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════
# GET /documents/status/:track_id
# ═══════════════════════════════════════════════════════════
@app.get("/documents/status/{track_id}")
async def document_status(
    track_id: str,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)
    status = processing_tasks.get(track_id, "unknown")
    return {"track_id": track_id, "status": status}


# ═══════════════════════════════════════════════════════════
# GET /graph/label-search — Search knowledge graph entities
# ═══════════════════════════════════════════════════════════
@app.get("/graph/label-search")
async def label_search(
    query: str = "",
    top_k: int = 10,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
):
    verify_api_key(x_api_key)
    if not query:
        return {"entities": []}

    # Use LightRAG's underlying graph for entity search
    try:
        lightrag_instance = rag.lightrag if hasattr(rag, "lightrag") else rag
        # Simple text search in entity names
        entities = []
        if hasattr(lightrag_instance, "chunk_entity_relation_graph"):
            graph = lightrag_instance.chunk_entity_relation_graph
            for node in list(graph.nodes())[:top_k * 5]:
                if query.lower() in str(node).lower():
                    entities.append({"name": node, "type": "entity"})
                    if len(entities) >= top_k:
                        break
        return {"entities": entities}
    except Exception as e:
        logger.error(f"Entity search failed: {e}")
        return {"entities": []}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
