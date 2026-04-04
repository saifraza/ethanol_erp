"""
Gemini LLM, Vision, and Embedding functions for RAG-Anything.
Uses google-genai SDK (new, replaces deprecated google-generativeai).
"""

import os
import asyncio
import numpy as np
from google import genai
from google.genai import types

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

client = genai.Client(api_key=GEMINI_API_KEY)


async def gemini_llm_func(
    prompt: str,
    system_prompt: str | None = None,
    history_messages: list | None = None,
    **kwargs,
) -> str:
    """Gemini 2.5 Flash for text LLM tasks (entity extraction, summarization)."""
    contents = []
    if system_prompt:
        contents.append(types.Content(role="user", parts=[types.Part.from_text(f"System: {system_prompt}")]))
        contents.append(types.Content(role="model", parts=[types.Part.from_text("Understood.")]))
    if history_messages:
        for msg in history_messages:
            role = "user" if msg.get("role") == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part.from_text(msg.get("content", ""))]))
    contents.append(types.Content(role="user", parts=[types.Part.from_text(prompt)]))

    response = await asyncio.to_thread(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=kwargs.get("max_tokens", 4096),
        ),
    )
    return response.text or ""


async def gemini_vision_func(
    prompt: str,
    images: list[bytes] | None = None,
    **kwargs,
) -> str:
    """Gemini 2.5 Flash multimodal for image/table analysis."""
    parts = [types.Part.from_text(prompt)]
    if images:
        for img_data in images:
            parts.append(types.Part.from_bytes(data=img_data, mime_type="image/png"))

    response = await asyncio.to_thread(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=4096),
    )
    return response.text or ""


async def gemini_embed_func(texts: list[str]) -> np.ndarray:
    """Gemini embedding-001 for vector embeddings (768 dims)."""
    embeddings = []
    # Process in batches of 20 (Gemini limit)
    batch_size = 20
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = await asyncio.to_thread(
            client.models.embed_content,
            model="gemini-embedding-001",
            contents=batch,
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        for emb in response.embeddings:
            embeddings.append(emb.values)
    return np.array(embeddings, dtype=np.float32)
