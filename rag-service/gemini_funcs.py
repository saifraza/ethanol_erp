"""
Gemini LLM, Vision, and Embedding functions for RAG-Anything.
Uses google-genai SDK (new, replaces deprecated google-generativeai).
"""

import os
import asyncio
import numpy as np
from google import genai

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

client = genai.Client(api_key=GEMINI_API_KEY)


async def gemini_llm_func(
    prompt: str,
    system_prompt: str | None = None,
    history_messages: list | None = None,
    **kwargs,
) -> str:
    """Gemini 2.5 Flash for text LLM tasks (entity extraction, summarization)."""
    full_prompt = ""
    if system_prompt:
        full_prompt += f"System: {system_prompt}\n\n"
    if history_messages:
        for msg in history_messages:
            role = msg.get("role", "user")
            full_prompt += f"{role}: {msg.get('content', '')}\n"
    full_prompt += prompt

    response = await asyncio.to_thread(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=full_prompt,
    )
    return response.text or ""


async def gemini_vision_func(
    prompt: str,
    images: list[bytes] | None = None,
    **kwargs,
) -> str:
    """Gemini 2.5 Flash multimodal for image/table analysis."""
    if not images:
        return await gemini_llm_func(prompt)

    # For multimodal, use parts list
    from google.genai import types
    parts = [types.Part.from_text(text=prompt)]
    for img_data in images:
        parts.append(types.Part.from_bytes(data=img_data, mime_type="image/png"))

    response = await asyncio.to_thread(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=parts,
    )
    return response.text or ""



async def gemini_embed_func(texts: list[str]) -> np.ndarray:
    """Gemini embedding-001 for vector embeddings (768 dims).

    LightRAG sends N texts and expects exactly N vectors back.
    We embed one text at a time via contents=[text] (list with one element)
    to guarantee a 1:1 mapping.  If the API ever returns multiple embeddings
    for a single text (observed with gemini-embedding-001), we mean-pool
    them into one vector.
    """
    import logging
    logger = logging.getLogger("rag-service")

    embeddings = []
    for text in texts:
        response = await asyncio.to_thread(
            client.models.embed_content,
            model="gemini-embedding-001",
            contents=[text],  # list with ONE string -> exactly 1 batch request
        )
        n = len(response.embeddings)
        if n == 1:
            embeddings.append(response.embeddings[0].values)
        elif n > 1:
            # API returned multiple vectors for one text -- mean-pool into one
            logger.warning(
                "embed_content returned %d vectors for 1 text (%d chars), mean-pooling",
                n, len(text),
            )
            vecs = np.array([e.values for e in response.embeddings], dtype=np.float32)
            embeddings.append(vecs.mean(axis=0).tolist())
        else:
            raise RuntimeError(f"embed_content returned 0 embeddings for text ({len(text)} chars)")
    return np.array(embeddings, dtype=np.float32)
