import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileStore} from '../src/file-store.js';
const app='';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{modules:true,scriptPath:app+'dist/worker.js',compatibilityDate:'2026-04-21',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'labdox-test'},bindings:{INITIAL_ADMIN_EMAIL:'smoke@example.test',INITIAL_ADMIN_PASSWORD:'Smoke-test-setup-password-2026!'}}],port:0}));
try{
 const db=await mf.getD1Database('DB');
 for(const name of fs.readdirSync(app+'migrations').sort()){
  const sql=fs.readFileSync(app+'migrations/'+name,'utf8').replace(/^\s*--.*$/gm,'').replace(/\r?\n/g,' ');
  await db.exec(sql);
 }
 const files=fileStore({DB:db});
 const payload=new Uint8Array(1024*1024+7);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 await files.put('test/multiple-chunks.pdf',payload,{httpMetadata:{contentType:'application/pdf'}});
 if(!(await files.head('test/multiple-chunks.pdf')))throw Error('D1 file head failed');
 const stored=await files.get('test/multiple-chunks.pdf');
 if(!stored || stored.body.length!==payload.length || stored.body.some((byte,index)=>byte!==payload[index]))throw Error('D1 file roundtrip failed');
 await files.delete('test/multiple-chunks.pdf');
 if(await files.head('test/multiple-chunks.pdf'))throw Error('D1 file deletion failed');
 const response=await mf.dispatchFetch('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'smoke@example.test',password:'Smoke-test-setup-password-2026!'})});
 const data=await response.json();if(response.status!==200)throw Error(JSON.stringify(data));
 const headers={'content-type':'application/json',cookie:response.headers.get('set-cookie').split(';')[0],'x-csrf-token':data.csrf_token};
 const changed=await mf.dispatchFetch('http://localhost/api/auth/password',{method:'POST',headers,body:JSON.stringify({current_password:'Smoke-test-setup-password-2026!',new_password:'Changed-smoke-password-2026!'})});if(changed.status!==200)throw Error(await changed.text());
 const boot=await mf.dispatchFetch('http://localhost/api/bootstrap',{headers});const result=await boot.json();if(result.templates?.length!==5)throw Error(JSON.stringify(result));
 const input={template_id:'tpl_offer',recipient_name:'Worker Test',letter_date:'2026-09-23',content_html:'<p>Persistent Worker draft</p>',signatory_id:'sig_hr'};
 const create=await mf.dispatchFetch('http://localhost/api/documents',{method:'POST',headers,body:JSON.stringify(input)});const doc=await create.json();if(create.status!==201)throw Error(JSON.stringify(doc));
 const issue=await mf.dispatchFetch('http://localhost/api/documents/'+doc.id+'/finalize',{method:'POST',headers,body:JSON.stringify({current_version:doc.current_version})});if(issue.status!==200)throw Error(await issue.text());
 console.log('Actual Worker runtime + D1 emulator passed: migrations, login, password, bootstrap, draft, finalisation.');
}finally{await mf.dispose();}
