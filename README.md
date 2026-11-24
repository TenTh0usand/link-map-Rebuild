# ⭐️ Link Map (v2.0 Rebuild)

Language: [English](https://github.com/TenTh0usand/link-map-Rebuild/blob/release/README.md) | [中文](https://github.com/TenTh0usand/link-map-Rebuild/blob/release/README_zh.md) | [Architecture & Changelog (ZH)](https://github.com/TenTh0usand/link-map-Rebuild/blob/release/docs/ARCHITECTURE_AND_CHANGES.md)

> A **local-first**, tree-style browser tab, Chrome Tab Group, and personal navigation workspace for Chrome and Edge.

---

## 💡 Overview

**Link Map v2.0 Rebuild** is an in-place modern rewrite and feature expansion forked from [`GarinZ/link-map`](https://github.com/GarinZ/link-map) (AGPL-3.0).

Built cleanly from the ground up on **WXT + Vite 7 + React 18 + Ant Design 5 + Zustand + Dexie (IndexedDB)**—completely replacing legacy Webpack 5, jQuery, Fancytree, and Firebase—v2 delivers a strict **zero-network default**, Chrome/Edge **Side Panel + Detached Window** dual modes, native Tab Group integration, a customizable Navigation Dashboard, zero-server QR/HTML sharing, E2EE multi-cloud sync, and optional low-cost BYOK AI workflows.

---

## ✨ Key Features

### 1. Local-First & Simple Offline Mode (Default ON)
- **Zero-Network Privacy Guarantee**: Simple Offline Mode is enabled out of the box with **zero default `host_permissions`**, hard-blocking all outbound requests through `guardedFetch`. No telemetry, no tracking—data stays strictly in local IndexedDB.
- **Rolling Snapshots & Easy Migration**: Automatically keeps 10 rolling local snapshots, auto-migrates legacy v1 `TabMasterDB` data read-only on first run, and supports full JSON export/restore plus **Tabs Outliner (`.tree` / `.json`)** migration.

### 2. Native Side Panel + Detached Window & Virtualized Tree
- **Dual Host Modes**: Run natively inside the browser Side Panel or pop out into a bounds-remembered Detached Window. Configure the default extension icon click action directly in Settings or the quick `⋮` menu.
- **Tree + Tab Groups**: Virtualized tree powered by `@tanstack/react-virtual`, supporting 3-zone & cross-window drag-and-drop, multi-select batch actions, **bidirectional Chrome Tab Groups sync**, and persistent **Custom Collections**.
- **Note-App Friendly**: Copy any node, subtree, or multi-selection as **indented TXT** or nested **Markdown** lists for Obsidian, Notion, or Logseq.

### 3. Navigation Dashboard & Zero-Server Sharing
- **Full-Page Dashboard (`dashboard.html`)**: Organizes links across Workspace, Readlist, Repos, Media, and General categories with toggleable **one-line site descriptions**.
- **Single-URL QR Share Cards**: High-DPI local Canvas 2D renderer with 4 themes (`Dark`, `Light`, `Aurora`, `Minimal`), ready to copy as PNG or download.
- **Group Sharing Without a Backend**: Compresses tab groups via `fflate` into `#lm1=...` share URLs + QR codes, exports **100% self-contained offline HTML** snapshots (with built-in search & Markdown copy), or pairs with the zero-dependency static viewer in [share-web/index.html](share-web/index.html).

### 4. Optional E2EE Cloud Sync (BYOS)
Incremental 3-chunk sync (`tree`, `collections`, `siteMeta`) with optional client-side **PBKDF2-SHA256 + AES-256-GCM** encryption and non-destructive merge conflict resolution:
- **WebDAV**: Presets and rate-limit / proxy diagnostics for **Jianguoyun**, **123Pan**, **OpenList / AList**, and custom WebDAV servers.
- **S3 & Cloudflare R2 Direct**: Lightweight pure Web Crypto AWS SigV4 request signer (no heavy AWS SDK) with R2 Account ID derivation and one-click CORS policy copy.
- **Cloudflare R2 + Worker Proxy**: Bundled open-source Worker template in [workers/r2-sync-worker/](workers/r2-sync-worker/README.md) for custom-domain acceleration (ideal for mainland China) and `/s/<id>` **short-link QR sharing** for large tab groups.
- **Google Drive**: Adapter interface reserved in `src/services/sync/providers/google-drive-provider.ts` for a future release.

### 5. Optional Low-Cost AI Assistant (BYOK)
Works with **DeepSeek V3 (`deepseek-chat`)**, SiliconFlow, Zhipu GLM, OpenAI, and local **Ollama**. URL query params, credentials, and blacklisted domains (internal IPs, banks, mail, etc.) are filtered locally before any prompt is sent:
- **Resume Work Digest**: Reconstructs interrupted workstreams, progress summaries, and next steps with one-click reopen and local history.
- **Smart Organize**: Proposes task collections and highlights potential duplicates with preview-before-apply.
- **Readlist & Goodies Curation**: Curates articles, news, GitHub repos, and media into prioritized shelves.
- **Batch One-Line Site Guides**: Fills missing dashboard descriptions while preserving manual notes.

---

## 🚀 Development & Build

> Requirements: Node.js >= 18.18 (Node 22+ recommended), pnpm 10+

```bash
pnpm install
pnpm prepare:wxt
pnpm typecheck
pnpm test
pnpm build       # Chrome MV3 -> .output/chrome-mv3
pnpm build:edge  # Edge MV3   -> .output/edge-mv3
```

Load `.output/chrome-mv3` or `.output/edge-mv3` via **Load unpacked** in `chrome://extensions/` or `edge://extensions/`.

---

## 🔒 Permissions

- `tabs`, `tabGroups`, `windows`: Manage tabs, native Tab Groups, and multi-window trees.
- `sidePanel`, `system.display`: Native Side Panel integration and detached window bounds restoration.
- `storage`: Minimal extension preferences (workspace trees, snapshots, and configs live in local IndexedDB).
- `downloads`: Export JSON backups, PNG QR cards, and standalone HTML snapshots.
- `favicon`: Safe same-origin `/_favicon/` icon rendering.
- `optional_host_permissions` (`https://*/*`, `http://*/*`): **Not granted by default**; requested per-origin only if you disable Offline Mode and connect a cloud sync or AI endpoint.

---

## 📜 License & Credits

- Licensed under **AGPL-3.0** ([LICENSE](LICENSE)).
- Built upon the foundation and ideas of [`GarinZ/link-map`](https://github.com/GarinZ/link-map).
