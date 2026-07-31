# Facebook Feed Filter & Curation Extension

A powerful, privacy-focused Chrome extension designed to intercept, filter, curate, and search your Facebook feed in real-time. It runs locally using IndexedDB to store posts and media assets completely offline.

---

## 🚀 Key Features

* **Real-Time Network Sniffing**: Uses the Chrome Debugger API to intercept Facebook GraphQL payloads and media blobs (`scontent*.fbcdn.net`) dynamically as you browse.
* **Server-Side Rendering (SSR) Extraction**: Automatically parses initial bootstrap script data when pages load to ensure no early posts are missed.
* **Advanced Search Engine**:
* **Boolean Operators**: `AND`, `OR`, `NOT` (along with symbols `&&`, `||`, `!`).
* **Exact Match**: Wrap strings in quotes (e.g., `"free shipping"`).
* **Field Targeting**: Filter specifically by fields like `author:"Name"`, `group:"Name"`, or `text:keyword`.
* **Regular Expressions**: Use custom regex with flags (e.g., `/hiring/i`).


* **Source & Group Filtering**:
* Multi-select custom dropdown to filter posts by specific Facebook groups or feeds.
* "Sniff Groups Only" strict URL validation constraint.


* **Content Deduplication & Updates**:
* Option to hide exact text duplicates instantly.
* Intelligent database merging: re-captured posts update existing records and media assets instead of generating redundant entries.


* **Flexible Sorting & Counters**:
* Sort by **General Post Time** or **Table Order**.
* Direction toggle for **Newest First** vs. **Oldest First**.
* Dynamic stats bar showing live counts of visible posts, total captured posts, and cached media blobs.


* **Right-to-Left (RTL) Language Support**: Built-in native browser auto-detection (`dir="auto"`) for Arabic, Hebrew, Persian, Urdu, and mixed-language content.
* **Local Offline Storage**: All posts, metadata, and images are cached securely in IndexedDB with a full data-purge option.
* **Interactive Search Guide**: Slide-out drawer containing a comprehensive cheatsheet for the search syntax.

---

## 📁 Project Structure

```text
fb-feed-filter-extension/
├── manifest.json              # Extension manifest (v3)
├── background.js              # Service worker (Debugger network interception & filtering)
├── content.js                 # Content script (SSR script parser)
├── popup/
├── dashboard/
│   ├── dashboard.html         # Dashboard UI layout
│   ├── dashboard.js           # Dashboard controller, search binding, & live updates
│   └── dashboard.css          # Dashboard styling
└── lib/
    ├── db.js                  # IndexedDB wrapper (Posts & Media storage)
    ├── parser.js              # GraphQL & SSR payload parser
    └── search-engine.js       # Custom query parser and execution engine

```

---

## 🛠️ Installation & Setup

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the root folder containing your extension files.
6. Pin the extension to your toolbar for easy access!

---

## 🔍 Search Syntax Quick Reference

| Feature | Syntax Example | Description |
| --- | --- | --- |
| **Implicit/Explicit AND** | `crypto btc` or `crypto AND btc` | Matches posts containing both terms. |
| **OR Operator** | `crypto OR stock` or `crypto || stock` | Matches posts containing either term. |
| **NOT Operator** | `NOT scam` or `!scam` | Excludes posts containing the term. |
| **Exact Phrase** | `"free shipping"` | Matches the exact phrase sequentially. |
| **Field Targeting** | `author:"John Smith"` | Targets specific authors, groups, or text. Fields that can be targeted are `author`, `group`, `text` |
| **Regular Expressions** | `/b[aeiou]y/i` | Evaluates raw regex patterns with flags. |
