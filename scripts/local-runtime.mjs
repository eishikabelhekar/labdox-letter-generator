// Local development adapter: the same Worker handlers, persistent SQLite/files, Chromium PDF.
// Production uses the real Cloudflare D1/R2/Browser bindings in wrangler.toml.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
export function localDatabase(directory) {
 fs.mkdirSync(directory,{recursive:true});
 const sqlite=new DatabaseSync(path.join(directory,'database.sqlite'));
 sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 for(const name of fs.readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort()) {
  if(sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name))continue;
  sqlite.exec('BEGIN');try{sqlite.exec(fs.readFileSync(path.join('migrations',name),'utf8'));sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 const prepare=(sql,args=[])=>({
  bind(...values){return prepare(sql,values);},
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}
 });
 return {prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const rows=[];for(const statement of statements)rows.push(await statement.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();},sqlite};
}
export function localFiles(directory) {
 fs.mkdirSync(directory,{recursive:true});
 const filename=key=>path.join(directory,Buffer.from(key).toString('hex'));
 return {
  async put(key,body,options={}){const file=filename(key);const bytes=body instanceof ArrayBuffer?Buffer.from(body):Buffer.from(body);fs.writeFileSync(file,bytes);fs.writeFileSync(file+'.json',JSON.stringify(options));},
  async get(key){const file=filename(key);return fs.existsSync(file)?{body:fs.readFileSync(file)}:null;},
  async head(key){return fs.existsSync(filename(key))?{}:null;},
  async delete(key){fs.rmSync(filename(key),{force:true});fs.rmSync(filename(key)+'.json',{force:true});}
 };
}
export async function localBrowser() {
 const candidates=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
 const executablePath=candidates.find(x=>x && fs.existsSync(x));
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}: {})});
 return {browser,async quickAction(action,{html}){
  if(action!=='pdf')throw Error('Only PDF is supported in the local adapter.');
  const page=await browser.newPage();
  try{await page.route('**/*',route=>route.abort());await page.setContent(html,{waitUntil:'load'});
   await page.waitForFunction(()=>document.body.dataset.renderReady || document.body.dataset.renderError);
   const error=await page.getAttribute('body','data-render-error');if(error)throw Error(error);
   return new Response(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true}));
  }finally{await page.close();}
 }};
}
export function localAssets() {
 return {async fetch(request){let name=new URL(request.url).pathname;if(name==='/')name='/index.html';
  const file=path.resolve('public','.'+decodeURIComponent(name));const root=path.resolve('public')+path.sep;
  if(!file.startsWith(root))return new Response('Not found',{status:404});
  if(!fs.existsSync(file))return new Response('Not found',{status:404});
  const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
  return new Response(fs.readFileSync(file),{headers:{'content-type':mime[path.extname(file)]||'application/octet-stream'}});
 }};
}
