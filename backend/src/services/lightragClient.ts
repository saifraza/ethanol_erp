/**
 * LightRAG Client — proxy layer to LightRAG microservice
 *
 * Same pattern as whatsappClient.ts:
 * - If LIGHTRAG_URL is set, routes all calls to the external LightRAG server
 * - All calls are non-blocking from the caller's perspective
 *
 * LightRAG runs as a separate Railway service (FastAPI on port 9621)
 * sharing the same PostgreSQL database.
 */

import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

const LIGHTRAG_URL = process.env.LIGHTRAG_URL; // e.g. http://mspil-lightrag.railway.internal:9621
const LIGHTRAG_API_KEY = process.env.LIGHTRAG_API_KEY || '';

let ragApi: AxiosInstance | null = null;

if (LIGHTRAG_URL) {
  ragApi = axios.create({
    baseURL: LIGHTRAG_URL,
    timeout: 60000,
    headers: {
      ...(LIGHTRAG_API_KEY && { 'X-API-Key': LIGHTRAG_API_KEY }),
    },
  });
}

/** Check if LightRAG is configured and reachable */
export function isRagEnabled(): boolean {
  return !!ragApi;
}

/**
 * Upload a file to LightRAG for indexing.
 * File is read from the uploads directory and sent as multipart form data.
 */
export async function lightragUpload(
  filePath: string,
  metadata?: { sourceType?: string; sourceId?: string; title?: string; deepScan?: boolean }
): Promise<{ success: boolean; trackId?: string; error?: string }> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    // Resolve absolute path from relative uploads path
    const uploadsRoot = path.resolve(__dirname, '../../uploads');
    const absPath = filePath.startsWith('/')
      ? filePath
      : path.resolve(uploadsRoot, filePath);

    // Guard against path traversal for relative paths
    if (!filePath.startsWith('/') && !absPath.startsWith(uploadsRoot)) {
      return { success: false, error: 'Invalid file path' };
    }

    if (!fs.existsSync(absPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
    });

    // Add metadata as description for LightRAG to associate with the document
    if (metadata) {
      const desc = [
        metadata.sourceType && `Source: ${metadata.sourceType}`,
        metadata.sourceId && `ID: ${metadata.sourceId}`,
        metadata.title && `Title: ${metadata.title}`,
      ].filter(Boolean).join(' | ');
      if (desc) form.append('description', desc);
      if (metadata.deepScan) form.append('deepScan', 'true');
    }

    const res = await ragApi.post('/documents/upload', form, {
      headers: form.getHeaders(),
      timeout: 120000, // 2 min for large files
    });

    return {
      success: true,
      trackId: res.data?.track_id || res.data?.id,
    };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Upload failed';
    console.error(`[LightRAG] Upload failed for ${filePath}: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Insert raw text into LightRAG for indexing.
 * Useful for text extracted from documents via Gemini.
 */
export async function lightragInsertText(
  text: string,
  metadata?: { sourceType?: string; sourceId?: string }
): Promise<{ success: boolean; trackId?: string; error?: string }> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    const prefixed = metadata
      ? `[Source: ${metadata.sourceType || 'unknown'} | ID: ${metadata.sourceId || 'unknown'}]\n\n${text}`
      : text;

    const res = await ragApi.post('/documents/text', { text: prefixed });
    return {
      success: true,
      trackId: res.data?.track_id || res.data?.id,
    };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Insert failed';
    console.error(`[LightRAG] Text insert failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Query LightRAG with a natural language question.
 * Returns AI-generated answer based on indexed documents.
 *
 * Modes:
 * - 'hybrid' (default) — best of both vector + graph
 * - 'local' — entity-focused, good for specific facts
 * - 'global' — relationship-focused, good for broad questions
 * - 'naive' — simple vector search (fastest)
 */
export async function lightragQuery(
  query: string,
  mode: 'local' | 'global' | 'hybrid' | 'naive' | 'mix' = 'hybrid',
  topK: number = 10
): Promise<{ success: boolean; answer?: string; error?: string }> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    const res = await ragApi.post('/query', {
      query,
      param: { mode, top_k: topK },
    }, { timeout: 60000 });

    return {
      success: true,
      answer: res.data?.response || res.data?.answer || res.data,
    };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Query failed';
    console.error(`[LightRAG] Query failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Stream a query response from LightRAG (NDJSON).
 * Returns an async generator of response chunks.
 */
export async function lightragQueryStream(
  query: string,
  mode: 'local' | 'global' | 'hybrid' | 'naive' | 'mix' = 'hybrid'
): Promise<{ success: boolean; stream?: NodeJS.ReadableStream; error?: string }> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    const res = await ragApi.post('/query/stream', {
      query,
      param: { mode },
    }, {
      responseType: 'stream',
      timeout: 120000,
      headers: { 'Accept-Encoding': 'identity' }, // disable gzip for streaming
    });

    return { success: true, stream: res.data };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Stream failed';
    console.error(`[LightRAG] Stream query failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/** Check indexing status of a document by track ID */
export async function lightragStatus(
  trackId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    const res = await ragApi.get(`/documents/status/${trackId}`);
    return { success: true, status: res.data?.status || res.data };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Status check failed';
    return { success: false, error: msg };
  }
}

/** Search entity labels in the knowledge graph */
export async function lightragSearchEntities(
  query: string,
  topK: number = 10
): Promise<{ success: boolean; entities?: unknown[]; error?: string }> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    const res = await ragApi.get('/graph/label-search', {
      params: { query, top_k: topK },
    });
    return { success: true, entities: res.data };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Entity search failed';
    return { success: false, error: msg };
  }
}

/** Auto-classify a document — returns AI-detected metadata */
export async function lightragClassify(
  filePath: string
): Promise<{
  success: boolean;
  metadata?: {
    category: string;
    subcategory: string | null;
    title: string | null;
    tags: string | null;
    issuedBy: string | null;
    issuedDate: string | null;
    expiryDate: string | null;
    referenceNo: string | null;
    department: string | null;
    summary: string | null;
  };
  error?: string;
}> {
  if (!ragApi) return { success: false, error: 'LightRAG not configured' };

  try {
    const uploadsRoot = path.resolve(__dirname, '../../uploads');
    const absPath = filePath.startsWith('/')
      ? filePath
      : path.resolve(uploadsRoot, filePath);

    if (!filePath.startsWith('/') && !absPath.startsWith(uploadsRoot)) {
      return { success: false, error: 'Invalid file path' };
    }
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
    });

    const res = await ragApi.post('/documents/classify', form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });

    return { success: true, metadata: res.data };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } }; message?: string })
      ?.response?.data?.detail || (err as { message?: string })?.message || 'Classify failed';
    console.error(`[LightRAG] Classify failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/** Get LightRAG health status */
export async function lightragHealth(): Promise<{ connected: boolean; error?: string }> {
  if (!ragApi) return { connected: false, error: 'LightRAG not configured (no LIGHTRAG_URL)' };

  try {
    const res = await ragApi.get('/health', { timeout: 5000 });
    return { connected: res.status === 200 };
  } catch (err: unknown) {
    return { connected: false, error: 'LightRAG service unreachable' };
  }
}
