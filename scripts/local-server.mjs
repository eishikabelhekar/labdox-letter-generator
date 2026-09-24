import http from 'node:http';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import worker from '../src/index.js';
import {localDatabase,localFiles,localBrowser,localAssets} from './local-runtime.mjs';
const directory=process.env.LOCAL_DATA_DIR || '.local-data';
const DB=localDatabase(directory), BROWSER=await localBrowser();
const setupFile=directory+'/initial-admin.json';
if(!DB.sqlite.prepare('SELECT id FROM users LIMIT 1').get() && !fs.existsSync(setupFile))fs.writeFileSync(setupFile,JSON.stringify({email:'admin@labdox.local',password:randomBytes(18).toString('base64url')},null,2));
const setup=fs.existsSync(setupFile)?JSON.parse(fs.readFileSync(setupFile,'utf8')):{};
const env={DB,FILES:localFiles(directory+'/files'),BROWSER,ASSETS:localAssets(),INITIAL_ADMIN_EMAIL:setup.email,INITIAL_ADMIN_PASSWORD:setup.password};
const port=Number(process.env.PORT || 8787);
const server=http.createServer(async(req,res)=>{
 try{const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>3*1024*1024){res.writeHead(413);res.end('Too large');return;}chunks.push(chunk);}
  const response=await worker.fetch(new Request(`http://localhost:${port}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(e);res.writeHead(500);res.end('Local server error');}
});
server.listen(port,'127.0.0.1',()=>{console.log(`Labdox: http://localhost:${port}`);console.log(`Persistent local data: ${directory}`);if(setup.email)console.log(`Initial login is in ${setupFile}. Change that password on first login. This file is excluded from release archives.`);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{server.close();DB.close();await BROWSER.browser.close();process.exit(0);});
