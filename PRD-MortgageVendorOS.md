


# Master Plan: MortgageVendorOS
**Version:** 1.0.0 (Draft)
**Target Environment:** Edge Serverless (Vercel, Cloudflare Workers) & Node.js (v18+)
**Core Philosophy:** YAGNI, "Big Package" Monolith (Tree-shakeable), Open-API Vendors Only, Zero-Dependency Core.

---

## 1. Product Requirements Document (PRD)

### 1.1 Problem Statement (The Aggregator Deficit)
Executing a mortgage origination transaction requires coordinating highly fragmented third-party settlement verticals: Title, Appraisals, HOI, and Verification of Employment/Assets (VOE/VOA). Currently, there is no open developer framework to streamline this. Fintech developers are forced to build custom state machines to place orders, chase vendor statuses, handle bidirectional messaging for stipulations, and retrieve final settlement documents.

### 1.2 The Solution: MortgageVendorOS
**MortgageVendorOS** is a free, open-source, edge-compatible JavaScript library specifically designed for mortgage origination and processing. It acts as a unified translation layer to streamline the ordering, monitoring, messaging, and document retrieval for third-party settlement services.

- **BYOK (Bring Your Own Key):** Developers pass their own API keys, removing the library from RESPA Section 8 legal risk.
- **Lifecycle Management:** Standardizes not just ordering, but `.status()`, `.documents()`, and `.message()` retrieval across all vendors.
- **Open-Ecosystem Only:** We refuse to support legacy vendors who gate their API docs behind enterprise NDAs. 
- **Zero-Friction DX:** Distributed as a single tree-shakeable NPM package (`npm install mortgage-vendor-os`).

### 1.3 Target Audience
- **Fintech Developers:** Building modern Loan Origination Systems (LOS) or Point of Sale (POS) platforms.
- **"Vibe Coders" & Small-Time LOs:** Individuals building zero-maintenance, automated transaction portals using free serverless platforms.

### 1.4 Scope Definitions
**In-Scope:**
- Single NPM package installation.
- Standardized methods: `.order()`, `.status()`, `.documents()`, `.sendMessage()`, `.getMessages()`.
- Standardized data models for Title, Appraisal, HOI, VOE, VOA, and Liens.
- Plugin architecture (Strategy Pattern) built into the main package.
- Edge-compatible REST Email Fallback (Resend, SendGrid) for mom-and-pop vendors.

**Out-of-Scope (YAGNI / Security Risks):**
- Client-side (Browser/Chrome Extension) execution.
- Heavy Node binaries (e.g., `nodemailer`, `fs`) to ensure Vercel/Edge compatibility.
- NDA-gated proprietary vendors.
- Standardized polling (the library provides the methods; the developer's system handles the cron/polling schedule).

---

## 2. Implementation Guide

### 2.1 The "Big Package" Architecture
The core orchestrator (`MortgageVendorOS`) routes requests to vendor classes (`ReggoraProvider`, `CanopyProvider`) via a `.use()` method. 

Every vendor provider must conform to the `BaseProvider` interface, which now mandates the full lifecycle:
- `placeOrder(orderCtx)`
- `getStatus(vendorOrderId)`
- `getDocuments(vendorOrderId)`
- `sendMessage(vendorOrderId, messagePayload)`
- `getMessages(vendorOrderId)`

*Note on Email Fallback:* For providers without an API, methods like `getDocuments()` will return a standard payload indicating `{ status: 'REQUIRES_WEBHOOK_UPDATE' }`, signaling to the developer that this vendor cannot be actively polled and will push updates via the webhook magic link.

### 2.2 Developer Experience (DX)
```javascript
import { MortgageVendorOS, ReggoraProvider, RestEmailFallback } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();

// Register Vendors
os.use('APPRAISAL', new ReggoraProvider(process.env.REGGORA_KEY));
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY));

// 1. Place Order
const order = await os.order('APPRAISAL', { address: "123 Main St", loan_amount: 500000 });

// 2. Check Status
const status = await os.status('APPRAISAL', order.vendorOrderId);

// 3. Handle Underwriting Stipulations / Messages
await os.sendMessage('APPRAISAL', order.vendorOrderId, { text: "Appraiser needs gate code: 1234" });
const messages = await os.getMessages('APPRAISAL', order.vendorOrderId);

// 4. Retrieve Final XML / PDF
if (status.isComplete) {
    const docs = await os.documents('APPRAISAL', order.vendorOrderId);
    console.log(docs.downloadUrls);
}
```

---

## 3. Project Task List

### 3.1 Product Manager (PM) Tasks
- [ ] **Source Vendor API Docs:** Locate public API documentation for v1 targets (e.g., Reggora, Canopy Connect, Baselayer, Plaid).
- [ ] **Verify Lifecycle Endpoints:** Ensure the sourced API docs explicitly cover endpoints for *status checks, messaging/notes, and document download URLs.*
- [ ] **Provision Sandboxes:** Sign up for developer accounts to acquire test API keys.
- [ ] **Endpoint Validation:** Use Postman/Bruno to manually test the full lifecycle (Order -> Message -> Doc Retrieval) before engineering handoff.

### 3.2 Engineering (Dev) Tasks
- [ ] **Core Setup:** Initialize `mortgage-vendor-os` project. Setup ESLint/Prettier. Zero-dependency constraint.
- [ ] **Build `MortgageVendorOS` Core:** Implement the main orchestrator with `.use()`, `.order()`, `.status()`, `.documents()`, `.sendMessage()`, and `.getMessages()`.
- [ ] **Build `BaseProvider` Interface:** Enforce the 5 lifecycle methods on all plugins.
- [ ] **Build Generic Plugins:** 
    - `RestEmailFallback` (Handles outbound `.order()` and `.sendMessage()` via email REST APIs. Returns webhook-required flags for inbound methods).
- [ ] **Build Specific Vendor Plugins:** Map the full lifecycle for Reggora, Canopy Connect, etc., based on PM documentation.
- [ ] **Write Unit Tests:** Use native Node `--test` runner to verify routing and fallback limitations.

### 3.3 Launch & Distribution (v1) Tasks
- [ ] **NPM Publishing:** Secure `mortgage-vendor-os` on NPM. Configure GitHub Actions for automated publishing.
- [ ] **SEO & AEO Optimized GitHub Pages:** 
    - Build `index.html` documentation site hosted on GitHub Pages.
    - **SEO:** Optimize for keywords: "Mortgage API wrapper", "Real Estate Settlement order management", "Appraisal API library", "LOS API integrations".
    - **AEO:** Structure docs in strict Markdown Q&A formats with raw code snippets so AI bots (Cursor, ChatGPT) accurately index the library's capabilities.
- [ ] **Directory Submission:** Submit to Awesome-Node, Awesome-Fintech, ProductHunt.
- [ ] **Vercel Template:** Publish a "Vibe Coder" Next.js template demonstrating a 1-click deploy of `MortgageVendorOS` with full status/messaging routes.

---
```
