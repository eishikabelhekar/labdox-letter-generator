import fs from 'node:fs';
const [databaseId,workerName='labdox-letter-generator']=process.argv.slice(2);
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId||'') || !/^[a-z0-9-]{1,63}$/.test(workerName)){
 console.error('Usage: node scripts/configure-cloudflare.mjs <D1 UUID> [Worker name]');process.exit(1);
}
let config=fs.readFileSync('wrangler.toml','utf8').replace(/database_id = "[a-f0-9-]+"/i,`database_id = "${databaseId}"`).replace('name = "labdox-letter-generator"',`name = "${workerName}"`);
fs.writeFileSync('wrangler.production.toml',config);
console.log('Created wrangler.production.toml. Set initial-admin secrets in Cloudflare, apply migrations, then deploy with --config wrangler.production.toml.');
