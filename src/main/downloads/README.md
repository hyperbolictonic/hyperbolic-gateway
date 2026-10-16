# 💾 Download Manager & Document Harvester

The **Download Manager** intercepts Chromium download events, routes files into `data/downloads/`, and automatically transforms raw files (CSVs, JSON, PDFs, plain text) into structured markdown constructs for immediate agent comprehension and LanceDB Cortex vector ingestion.

---

## 🚀 Key Features

1. **Deterministic Workspace Routing:**
   - Overrides default OS user Downloads folder, placing all artifacts in `data/downloads/`.
2. **Automatic Cortex Ingestion:**
   - When a download completes, the file is automatically parsed and embedded into LanceDB Cortex under `domain: 'downloads'`.
3. **Structured Document Translators:**
   - **CSV/TSV:** Converted into clean markdown tables with column headers.
   - **JSON:** Formatted as structured syntax-highlighted code blocks.
   - **PDF:** Extracts textual streams and printable segments.
