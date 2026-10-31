# Regulatory Change Impact Agent — Data Ingestion Server

A standalone Node.js and TypeScript regulatory data ingestion server that automatically discovers official publications from central banks and regulatory authorities, downloads original documents, extracts and normalizes textual content, tracks versions, and exposes REST APIs for inspection and retrieval.

---

## 1. Prerequisites

- **Node.js**: v18+ LTS (tested on v22.12.0)
- **Package Manager**: npm (v10+)
- **Operating System**: Windows, macOS, or Linux
- **Network Access**: Outbound HTTPS connectivity to official regulatory portals (SAMA, CBUAE, RBI, CBK)

---

## 2. Configured Official Regulatory Sources

The server includes built-in adapters for four official regulatory authorities:

| Jurisdiction | Authority | Region | Authority Portal / Starting URL | Ingestion Mechanism |
|---|---|---|---|---|
| **SA** | **SAMA** (Saudi Central Bank) | KSA | https://rulebook.sama.gov.sa/en/sama-circulars | HTML table parsing, circular metadata, and original PDF resolution |
| **AE** | **CBUAE** (Central Bank of UAE) | UAE | https://rulebook.centralbank.ae/en | HTML rulebook hierarchy parsing, regulatory standards, and document downloads |
| **IN** | **RBI** (Reserve Bank of India) | INDIA | https://www.rbi.org.in/notifications_rss.xml | RSS feed XML parsing, notification page crawling, and official PDF links |
| **KE** | **CBK** (Central Bank of Kenya) | AFRICA | https://www.centralbank.go.ke/policy-procedures/legislation-and-guidelines/circulars/ | HTML circulars table parsing, banking circular metadata, and direct PDF downloads |

---

## 3. Storage Hierarchy

All data is permanently persisted on the local filesystem under `<PROJECT_ROOT>/data/`:

```text
data/
├── regulations/
│   ├── SA/                          # Saudi Arabia documents
│   │   └── <document-id>/
│   │       ├── original.<pdf|html>  # Current document version
│   │       ├── extracted.txt        # Extracted normalized text
│   │       ├── metadata.json        # Per-document metadata
│   │       ├── versions/            # Historical archives
│   │       │   └── v1.pdf
│   │       └── extracted/           # Historical text archives
│   │           └── v1.txt
│   ├── AE/                          # United Arab Emirates documents
│   ├── IN/                          # India documents
│   └── KE/                          # Kenya documents
├── metadata/
│   ├── publications.json            # Consolidated index of all publications
│   ├── sources.json                 # Source status, configuration & health
│   └── monitoring-runs.json         # Complete audit history of monitoring cycles
└── logs/
    └── app.log                      # Operational structured log file
```

---

## 4. Installation & Environment Configuration

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Review configuration settings in `.env`:
```env
PORT=4000
NODE_ENV=development

# Automated Cron Monitoring (Default: every 15 minutes)
REGULATORY_CRON_ENABLED=true
REGULATORY_CRON_EXPRESSION=*/15 * * * *
REGULATORY_RUN_ON_STARTUP=false

# Network and Document Limits
REGULATORY_HTTP_TIMEOUT_MS=20000
REGULATORY_MAX_RETRIES=3
REGULATORY_MAX_DOCUMENT_SIZE_MB=25
REGULATORY_MAX_CONCURRENT_SOURCES=4

# Storage and Security
REGULATORY_DATA_DIR=./data
REGULATORY_API_KEY=your-local-development-key
```

---

## 5. Starting the Server

### Development Mode (with hot-reload)
```bash
npm run dev
```

### Production Build & Execution
```bash
npm run build
npm start
```

The server binds to `http://localhost:4000` and initializes the local data storage folders automatically.

---

## 6. CLI Commands

| Command | Purpose | When to Use |
|---|---|---|
| `npm run compare` | **Comparison Tool**: Connects to the 4 live public regulatory portals, compares live documents against local disk storage, reports sync status, and auto-restores missing files. | Verify and reconcile live portal regulations with local files. (Alias: `npm run status`) |
| `npm run extract` | **Extraction & Ingestion Engine**: Fetches official publications across SAMA, CBUAE, RBI, and CBK, extracts text, and stores clean HTML. | Run background ingestion and extraction cycle from CLI. |
| `npm run dev` | **API Server**: Starts the Express API server with background cron (every 15 min) on port 4000. | Postman API testing and frontend integration. |
| `npm run smoke` | **Smoke Test**: Quick network reachability check against official central bank websites. | Verify outbound connectivity to central bank portals. |
| `npm test` | **Test Suite**: Runs the full Vitest automated test suite (47 unit and integration tests). | Verify all tests pass cleanly with 100% HTML fixtures. |
| `npm run typecheck` | **TypeScript Check**: Verifies types and builds with zero errors. | Type verification. |
| `npm run build` | **Production Build**: Compiles TypeScript to `./dist`. | Production deployment. |
| `npm start` | **Production Run**: Runs the compiled server from `./dist/server.js`. | Production execution. |

---

## 7. Postman Testing Workflow

Import these requests into Postman or execute via curl.

### Step 1: Health Check
Verify server uptime, cron scheduler status, and last run.
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/health`
- **Headers**: None required

### Step 2: Inspect Regulatory Sources
Check the enabled status, health, and latest scan timestamps for all four authorities.
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/sources`
- **Headers**: None required

### Step 3: Trigger Monitoring for All Sources (Async)
Immediately starts a monitoring run for SAMA, CBUAE, RBI, and CBK.
- **Method**: `POST`
- **URL**: `http://localhost:4000/api/v1/monitoring/run`
- **Headers**:
  - `x-api-key: your-local-development-key`
- **Expected Status**: `202 Accepted`

### Step 4: Trigger Monitoring for One Source Only
- **Method**: `POST`
- **URL**: `http://localhost:4000/api/v1/monitoring/run/rbi` (or `sama`, `cbuae`, `cbk`)
- **Headers**:
  - `x-api-key: your-local-development-key`
- **Expected Status**: `202 Accepted`

### Step 5: Check Monitoring Run Status
Inspect recent runs, progress, discovery counts, and per-source error breakdowns.
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/monitoring/runs`
- **Optional Params**: `?limit=10&offset=0`

To inspect a specific run:
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/monitoring/runs/<runId>`

### Step 6: List Downloaded Publications
List stored publications with filtering and full pagination.
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/regulations`
- **Query Parameters**:
  - `jurisdiction`: `IN`, `SA`, `AE`, `KE`
  - `sourceKey`: `rbi`, `sama`, `cbuae`, `cbk`
  - `search`: Keyword search in titles, references, and extracted text
  - `limit`: Default `20`
  - `offset`: Default `0`

*Example — Filter Indian publications:*
`GET http://localhost:4000/api/v1/regulations?jurisdiction=IN&limit=10`

### Step 7: Inspect a Specific Publication
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/regulations/<id>`

### Step 8: Read Extracted Text
Retrieve normalized text extracted from PDF, DOCX, or HTML.
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/regulations/<id>/text`
- **Optional Param**: `?version=1`

### Step 9: Download Original Document File
Stream the original downloaded document file (`.pdf`, `.html`, etc.).
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/regulations/<id>/download`
- **Optional Param**: `?version=1`

### Step 10: Download Extracted Text as `.txt` File
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/regulations/<id>/download-text`

### Step 11: Inspect Storage Statistics
Inspect real filesystem metrics: total publications, file counts, bytes stored, versions, and failures.
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/v1/storage/stats`

### Step 12: Manually Retry a Download
Retry downloading a previously discovered publication.
- **Method**: `POST`
- **URL**: `http://localhost:4000/api/v1/regulations/<id>/retry`
- **Headers**:
  - `x-api-key: your-local-development-key`

---

## 8. Architecture & Key Features

### Deduplication & Versioning
- **4-Signal Matching**: Deduplication matches against stable document IDs, official regulatory reference numbers (e.g. `RBI/2026-27/303`), normalized document URLs, and SHA-256 content hashes.
- **Non-Destructive Versioning**: When an existing document URL changes content, the server archives the previous version under `versions/v<N>.<ext>` and `extracted/v<N>.txt` before writing the new version.

### Text Extraction Pipeline
- **PDF**: Uses `pdf-parse` with page boundary markers (`-- N of Total --`). Detects empty / image-only scanned PDFs and marks them `requires_ocr: true`.
- **HTML**: Strips scripts, styles, navigation menus, and footers via `cheerio`, focusing on regulatory article bodies.
- **DOCX**: Extracts structured paragraphs via `mammoth`.
- **Plain Text**: Standardizes UTF-8 encoding.

### Security Controls
- **SSRF Defense**: Enforces domain allowlist for official regulatory hosts (`sama.gov.sa`, `centralbank.ae`, `rbi.org.in`, `centralbank.go.ke`).
- **Private IP Blocking**: Rejects connections to loopback (`127.0.0.1`), private RFC1918 subnets, and cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`).
- **Redirect Revalidation**: Validates every HTTP redirect against security rules.
- **Path Traversal Protection**: Rejects `..` and sanitizes all document IDs and storage directories.

### Concurrency & Fault Tolerance
- **In-Process Lock**: Prevents overlapping monitoring runs within a server instance (returns `409 Conflict`).
- **Fault Isolation**: If one regulatory source times out or returns an error, other sources continue uninterrupted.
- **Atomic File Operations**: Uses write-to-temp and atomic rename to prevent corrupted reads. Malformed metadata triggers automatic `.corrupted.<timestamp>.bak` recovery.

---

## 9. How to Add a New Regulatory Source

1. Create a new adapter implementing `RegulatorySourceAdapter` in `src/regulatory/adapters/<new-source>.adapter.ts`.
2. Add the authority domain to `ALLOWED_DOMAINS` in `src/utils/url-validation.ts`.
3. Register the adapter in `src/regulatory/registry.ts`:
   ```typescript
   this.register(newSourceAdapter);
   ```
4. Add jurisdiction folder initialization in `src/storage/local-storage.ts`.
5. Run `npm run smoke` to test connectivity and discovery.

---

## 10. Supabase (PostgreSQL) Ingestion & Ollama Context

To ingest regulatory data directly into Supabase and use Relational Context Retrieval for Ollama:

1. Run the database migration script in [`supabase/schema.sql`](file:///C:/Users/samar/OneDrive/Desktop/Azentio/source_monitoring/supabase/schema.sql) in your Supabase SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
3. Run the batch ingestion command:
   ```bash
   npm run ingest:supabase
   ```
4. See [`SUPABASE_INGESTION_GUIDE.md`](file:///C:/Users/samar/OneDrive/Desktop/Azentio/source_monitoring/SUPABASE_INGESTION_GUIDE.md) for complete details on relational querying for Ollama prompts and deterministic span verification.
