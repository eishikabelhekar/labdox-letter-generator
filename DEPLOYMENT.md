# Company-owned Cloudflare deployment

This source does not depend on chatgpt.site or an OpenAI runtime. The existing design is retained. Production uses a Worker serving static HTML/CSS/JavaScript, D1 for records, R2 for PDFs/images, and Browser Run for server-side PDF generation.

## What is ready, and what still requires account access

The application and database migrations are implemented and tested locally. No remote database, bucket, Worker or domain has been provisioned in this delivery. The machine was not authenticated to Cloudflare at review time. Do not describe the local build as a production deployment.

The exact current chatgpt.site URL and its deployed backend are still needed if existing data must be migrated. Do not replace an existing database or assume the ZIP contains live records.

## Deploy a fresh environment

Use Node.js 24 or newer. Run these commands from the application directory. Use the company's Cloudflare account and separate resource names for staging and production.

```powershell
npm ci
npm run check
npm run build
npm run test:worker
npx wrangler login
npx wrangler whoami
npx wrangler d1 create labdox-letter-generator
npx wrangler r2 bucket create labdox-letter-files
```

Take the actual UUID printed by `d1 create`, then run:

```powershell
node scripts/configure-cloudflare.mjs <D1-UUID> labdox-letter-files
npx wrangler d1 migrations apply labdox-letter-generator --remote --config wrangler.production.toml
npx wrangler secret put INITIAL_ADMIN_EMAIL --config wrangler.production.toml
npx wrangler secret put INITIAL_ADMIN_PASSWORD --config wrangler.production.toml
npx wrangler deploy --config wrangler.production.toml
```

Enter the intended admin email and a unique initial password of at least 12 characters at the interactive secret prompts. Do not put secrets in source control or chat. If Wrangler asks to create the named Worker when setting its first secret, use the intended company Worker. The browser binding must be available in that account. Confirm current Browser Run billing/limits in the company dashboard before using it for production.

Open the returned workers.dev URL. Sign in with the configured initial administrator, change the password, and add real users. There are no automatically provisioned public demo credentials. Once the administrator exists and has changed the password, remove the initial password secret:

```powershell
npx wrangler secret delete INITIAL_ADMIN_PASSWORD --config wrangler.production.toml
```

Add the company domain through the Worker's Domains & Routes settings. Verify HTTPS, role restrictions, PDF generation and persistence there before releasing it to staff.

## Required cloud acceptance

1. Admin creates two issuers. Each issuer can access only their own records; direct access to another issuer's document/version/PDF is denied.
2. Save a draft, edit it, and click Finalise without manually saving again. The final snapshot and downloaded PDF must contain the latest edits.
3. Generate a PDF. Confirm a PDF object in R2 and its key in D1. Confirm it downloads only after authentication.
4. Edit the template and generate/download the earlier issued PDF again. The issued version must remain unchanged.
5. Create and edit a template, upload a logo, and verify continuation headers/footers in a long letter.
6. Log out/in and redeploy the same Worker against the same D1/R2 bindings. Confirm all records and PDFs remain retrievable.
7. Restore an older saved version as a linked new draft. Confirm the original version remains intact.

The automated local workflow verifies equivalent application behavior with persistent SQLite/file adapters and real headless Chromium. It is not a substitute for verifying account-specific D1/R2/Browser Run integration.

## Existing data and releases

- Back up D1 before applying new migrations: `npx wrangler d1 export labdox-letter-generator --remote --output backup.sql --config wrangler.production.toml`. Store that backup privately.
- Preserve existing migration history. The `migrations/` folder is authoritative; do not rerun old seed files. Migration 0006 carries older sequence counters forward into shared numbering formats.
- Older issued snapshots are retained. Older drafts gain a baseline version when opened through the version/preview API; earlier overwritten drafts cannot be reconstructed.
- Keep the same production database UUID and R2 bucket across releases. Deploying code does not copy local development data or change cloud data automatically.
- R2 object backups need a separately configured company backup destination/process. Keep the D1 backup and referenced R2 objects together; D1 alone does not contain PDF binaries.
- Do not delete production resources during rollback. Roll back Worker code only when it is compatible with the migrated schema. Test restoration in staging.

## Validation environment note

The standalone bundle builds with `npm run build` and has passed the workflow tests. Native Wrangler dry-run was blocked by Windows sandbox access to an ancestor directory in this session. Wrangler's local D1 migration application succeeded. Run the deployment command in the authenticated company environment and retain its output as the actual cloud deployment evidence.

Cloudflare reference: [Worker Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/) and [PDF generation](https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/).
