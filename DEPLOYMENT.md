# Cloudflare no-card pilot deployment

This source runs independently of chatgpt.site. The existing interface is retained. The no-card pilot uses a Cloudflare Worker for the frontend and API, D1 for records and stored PDF/image chunks, and Browser Run for server-side PDF rendering. It intentionally does not bind R2 because enabling R2 on this account requires billing setup. This differs from the PRD's R2 storage architecture and should be revisited before broad production use.

## Current account state

The dedicated D1 database `labdox-letter-generator` has been created in Eishika@labdox.in's Cloudflare account with UUID `6a5b8bd7-37ba-4ac3-bd77-fb3c2b751ec5`. The migrations and Worker have not yet been deployed. The separate pre-existing Worker `labdox-document-generator` was not changed. No local documents are migrated automatically.

## Deploy

Use Node.js 24 or newer in the company account. Run these commands from this application directory:

```powershell
npm ci
npm run check
npm run test:worker
npx wrangler login --device
npx wrangler whoami
npx wrangler d1 migrations apply labdox-letter-generator --remote
npx wrangler secret put INITIAL_ADMIN_EMAIL
npx wrangler secret put INITIAL_ADMIN_PASSWORD
npx wrangler deploy
```

Enter the intended admin email and a unique temporary password of at least 12 characters at the interactive secret prompts. Keep them out of chat and Git. If Wrangler asks to create the named Worker when setting its first secret, use `labdox-letter-generator`. Open the returned `workers.dev` URL, sign in, and change the password. Then remove the temporary secret:

```powershell
npx wrangler secret delete INITIAL_ADMIN_PASSWORD
```

The Worker, D1 and Browser Run free tiers have separate usage limits. D1 Free allows up to 500 MB per database; stored PDFs and logos count toward it. This pilot caps each file at 20 MB. Browser Run Free provides 10 minutes of browser time per day. Exceeding free limits can stop new requests or PDF generation until the limits reset. Monitor usage in Cloudflare.

## Cloud acceptance

1. Log in as the admin, change the temporary password, and add two issuer users.
2. Verify that each issuer cannot access the other's documents, versions, PDFs or assets.
3. Save and finalise a draft, generate a PDF, and confirm that `file_objects` and `file_chunks` contain it and authenticated download works.
4. Edit a template and confirm earlier issued versions remain unchanged.
5. Upload a logo and generate a long multi-page letter with continuation headers and footers.
6. Log out and back in, then redeploy the same Worker against the same D1 database. Confirm drafts, users, templates, versions and PDFs remain available.
7. Restore a prior version as a linked new draft, leaving the original unchanged.

The local workflow and Miniflare tests exercise the application, migrations, D1 file storage and PDF output. Cloud acceptance must still verify the real D1 and Browser Run bindings.

## Data and future R2 migration

Back up D1 before applying future migrations: `npx wrangler d1 export labdox-letter-generator --remote --output backup.sql`. Store the backup privately; it contains document records and PDF/image bytes. Preserve migration history and the database UUID across releases. Cloudflare's D1 Time Travel is useful for short-term recovery but does not replace an external backup.

R2 remains the intended long-term file store in the PRD. When the organization accepts its billing setup, provision a bucket, migrate existing D1 file objects to it, add a `FILES` binding, and verify old PDF/image downloads before removing D1 file data. Do not add the binding without migrating existing files, because the application selects R2 when `FILES` is present.

The exact chatgpt.site deployment and backend are still needed if historical data there must be migrated. Do not assume this source ZIP contains those live records.
