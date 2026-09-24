import fs from 'node:fs';
const [databaseId,bucketName,workerName='labdox-letter-generator']=process.argv.slice(2);
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId||'') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName||'') || !/^[a-z0-9-]{1,63}$/.test(workerName)){
 console.error('Usage: node scripts/configure-cloudflare.mjs <D1 UUID> <R2 bucket> [Worker name]');process.exit(1);
}
let config=fs.readFileSync('wrangler.toml','utf8').replace('REPLACE_WITH_D1_DATABASE_ID',databaseId).replace('bucket_name = "labdox-letter-files"',`bucket_name = "${bucketName}"`).replace('name = "labdox-letter-generator"',`name = "${workerName}"`);
fs.writeFileSync('wrangler.production.toml',config);
console.log('Created wrangler.production.toml. Set initial-admin secrets in Cloudflare, apply migrations, then deploy with --config wrangler.production.toml.');
