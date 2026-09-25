# Labdox Letter Generator

An independently deployable letter application with the original interface retained.

## Run locally

Install Node.js 24+ and Chrome or Edge, extract this folder, then double-click `SETUP_AND_START.bat`. Or run:

```powershell
npm ci
npm start
```

Open http://localhost:8787. The initial local login is generated on your machine in `.local-data/initial-admin.json`. Change that password on first login. No shared default password is included. Stop the server with Ctrl+C; use `START.bat` for later runs.

Local mode runs the same application handlers with a persistent SQLite database, a local file-store adapter and headless Chromium PDF rendering. It does not claim to be cloud D1. Data survives server restarts in `.local-data/`; back up that folder while the server is stopped. Deleting it removes local data. `CHROME_PATH` can specify an installed Chromium browser if automatic detection fails.

## What works

- Actual administrator and issuer accounts, password changes, session cookies, CSRF protection and backend role/ownership checks.
- Persistent draft saving, optimistic edit-conflict detection, finalisation, numbering, search and archiving.
- A saved version for every draft save and an immutable issued snapshot; previous versions can be viewed, downloaded as PDFs, or restored as linked new drafts.
- Latest edits are saved before finalisation or PDF generation. Issued content remains locked.
- Server-generated PDFs saved to the file store, with authenticated downloads. Repeated generation reuses the stored version. There is no browser-print fallback.
- Shared preview/PDF rendering, multi-page flow, continuation headers/footers and page counts. Rich text is preserved when splitting paragraphs.
- Administrator template creation/editing, configurable margins and continuation headers/footers.
- PNG/JPEG logo and letterhead uploads; image tags can be inserted into template HTML. Issued snapshots embed the image bytes so later template edits cannot change issued output.

Save Draft records a version. Finalise records the issued snapshot. Generate PDF separately creates and stores the binary PDF for that version. Creating a revision produces a linked new draft with a new number when issued; it does not overwrite the original letter.

Extremely tall indivisible images or oversized headers/footers produce a rendering error instead of silently clipping. Reduce the image/header size or adjust template margins. Validate custom template CSS with representative letters before issuing them. Draft saves are explicit; there is no autosave of keystrokes.

## Cloudflare

See [DEPLOYMENT.md](DEPLOYMENT.md) for company-owned deployment and acceptance steps. The no-card pilot binds `DB` (D1) and `BROWSER` (Browser Run), alongside Worker static assets. PDFs and uploaded images are stored as D1 chunks. The source has no ChatGPT-site dependency. An optional `FILES` R2 binding remains supported in code for a later production migration.

Cloudflare deployment is not completed merely by extracting this ZIP. The included `wrangler.toml` names the dedicated D1 database created in the current Cloudflare account. Migrations, first-admin secrets and the Worker deployment must still be completed. D1 Free has a 500 MB per-database limit; this pilot also caps each stored file at 20 MB.

## Source map

- `public/`: original interface, client interactions and bundled brand files.
- `src/`: Worker routes, authorisation, document/template/user/asset services and shared renderer.
- `migrations/`: authoritative D1 schema migrations.
- `scripts/`: local runtime, checks, bundle build and deployment configuration helper.
- `tests/`: security helper tests and persistent document/PDF workflow regression test.

```powershell
npm run check                 # All JS syntax plus automated tests; needs Chrome/Edge
npm run build                 # Standalone Worker bundle in dist/
npm run test:unit
npm run test:workflow
npm run test:worker          # Bundled Worker in Cloudflare's local runtime with D1
npm run dev:cloudflare        # Wrangler emulator, separately from the local adapter
```

For Wrangler development, configure `.dev.vars` with a private initial-admin email/password and apply local migrations. Browser Quick Actions require a remote browser binding/account; `npm start` instead uses installed headless Chromium locally. Never commit `.dev.vars`, `.local-data`, `.wrangler` state, test data or production credentials.
