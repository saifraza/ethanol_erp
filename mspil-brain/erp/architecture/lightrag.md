# LightRAG — Knowledge Graph Search

## What It Is
A separate FastAPI microservice that indexes all uploaded documents into a knowledge graph, enabling semantic search across the entire organization's documents.

## Architecture

```
ERP Backend ──upload──→ LightRAG Service ──index──→ Knowledge Graph (PostgreSQL)
                              ↑
ERP Frontend ──query──→ ERP Backend ──query──→ LightRAG ──answer──→ AI Response
```

- **Service**: FastAPI (Python) on Railway
- **Port**: 9621 (internal: `mspil-lightrag.railway.internal:9621`)
- **Database**: Shared PostgreSQL with main ERP
- **Env**: `LIGHTRAG_URL`, `LIGHTRAG_API_KEY`

## What Gets Indexed

| Source | Trigger | Metadata |
|--------|---------|----------|
| Company Documents | Upload via CompanyDocuments page | `sourceType: CompanyDocument` |
| Vendor Invoices | File attached during invoice entry | `sourceType: VendorInvoice` |
| GRN Documents | Invoice + e-way bill attached to GRN | `sourceType: GoodsReceipt` |
| Shipment Documents | Challan/invoice/e-way bill upload | `sourceType: ShipmentDocument` |
| Contractor Bills | Bill attachment uploaded | `sourceType: ContractorBill` |
| Ethanol Contracts | Contract file attached | `sourceType: EthanolContract` |

## Query Modes

| Mode | Best For | How It Works |
|------|----------|-------------|
| **hybrid** (default) | General questions | Combines entity + relationship + vector search |
| **local** | Specific entities | Focuses on entity-level matches (names, dates, amounts) |
| **global** | Big picture | Focuses on relationships between entities |
| **naive** | Simple keyword | Pure vector similarity search |

## Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/document-search/query` | Ask question, get AI answer |
| `POST /api/document-search/stream` | Streaming response (NDJSON) |
| `GET /api/document-search/health` | Check if LightRAG is reachable |
| `GET /api/document-search/stats` | Document count, indexed count, pending |
| `POST /api/document-search/reindex` | Re-upload all unindexed docs |

## Client Functions (`lightragClient.ts`)

- `lightragUpload(filePath, metadata)` — Upload file for indexing (2min timeout)
- `lightragInsertText(text, metadata)` — Insert raw text
- `lightragQuery(query, mode, topK)` — Query with AI answer
- `lightragQueryStream(query, mode)` — Streaming response
- `lightragHealth()` — Health check
- `isRagEnabled()` — Boolean check if configured

## Indexing Behavior
- **Asynchronous**: All uploads are fire-and-forget (non-blocking)
- **Metadata prefix**: `[Source: <type> | ID: <id>]\nTitle: <title>\n<content>`
- **Tracking**: Only CompanyDocuments store `ragTrackId` in DB; others are server-side only
- **No deletion**: Documents can't be removed from LightRAG index yet

## Frontend (`DocumentSearch.tsx`)
- Natural language search input
- Mode selector (hybrid, entity, relationship, vector)
- Stats panel (connection status, doc count, indexed count)
- Health check + reindex buttons
- Example queries: "When does our Environmental Clearance expire?", "Find invoices for sulfuric acid"
