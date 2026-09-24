import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const worker=(await import(process.env.TEST_BUNDLE ? '../dist/worker.js' : '../src/index.js')).default;
import {localDatabase,localFiles,localBrowser,localAssets} from '../scripts/local-runtime.mjs';

test('persistent end-to-end document, permissions, asset, version and PDF workflow',async()=>{
 const artifactRoot=path.resolve(process.env.TEST_ARTIFACT_DIR || 'work/test-artifacts');fs.mkdirSync(artifactRoot,{recursive:true});
 const directory=fs.mkdtempSync(path.join(artifactRoot,'workflow-'));
 let DB=localDatabase(directory);const BROWSER=await localBrowser();
 const env={DB,BROWSER,FILES:localFiles(directory+'/files'),ASSETS:localAssets(),INITIAL_ADMIN_EMAIL:'admin@example.test',INITIAL_ADMIN_PASSWORD:'Test-setup-password-123!'};
 const admin={},issuer={},other={};
 async function call(actor,url,method='GET',body){
  const headers={};if(actor.cookie)headers.cookie=actor.cookie;if(actor.csrf)headers['x-csrf-token']=actor.csrf;
  if(body)headers['content-type']='application/json';
  const response=await worker.fetch(new Request('https://labdox.test'+url,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),env);
  const result=response.headers.get('content-type')?.includes('json')?await response.json():null;
  return {status:response.status,result,response};
 }
 async function signIn(actor,email,password){const r=await call(actor,'/api/auth/login','POST',{email,password});assert.equal(r.status,200,JSON.stringify(r.result));actor.cookie=r.response.headers.get('set-cookie').split(';')[0];actor.csrf=r.result.csrf_token;assert.match(r.response.headers.get('set-cookie'),/Secure/);}
 async function password(actor,current_password){assert.equal((await call(actor,'/api/auth/password','POST',{current_password,new_password:'Changed-password-456!'})).status,200);}
 try{
  await signIn(admin,'admin@example.test',env.INITIAL_ADMIN_PASSWORD);
  assert.equal((await call(admin,'/api/bootstrap')).status,403);
  await password(admin,env.INITIAL_ADMIN_PASSWORD);
  const boot=(await call(admin,'/api/bootstrap')).result;assert.equal(boot.templates.length,5);
  const template=boot.templates.find(t=>t.id==='tpl_offer');
  for(const [actor,email] of [[issuer,'issuer@example.test'],[other,'other@example.test']]){
   const created=await call(admin,'/api/users','POST',{email,full_name:email,role:'issuer'});assert.equal(created.status,201);
   await signIn(actor,email,created.result.temporary_password);await password(actor,created.result.temporary_password);
  }
  assert.equal((await call(issuer,'/api/users')).status,403);
  assert.equal((await call(issuer,'/api/templates','POST',template)).status,403);
  const input={template_id:template.id,recipient_name:'Aditi Rao',designation:'Designer',letter_date:'2026-09-23',subject:'Offer',content_html:'Plain text before paragraphs<p>FIRST SAVED CONTENT</p>',signatory_id:'sig_hr'};
  const created=await call(issuer,'/api/documents','POST',input);assert.equal(created.status,201,JSON.stringify(created.result));const docId=created.result.id;
  assert.equal((await call(other,'/api/documents/'+docId)).status,404);
  assert.equal((await call(other,`/api/documents/${docId}/versions`)).status,404);
  let v=created.result.current_version;
  let generated=await call(issuer,`/api/documents/${docId}/generate-pdf`,'POST');assert.equal(generated.status,200,JSON.stringify(generated.result));
  const draftPdf=await call(issuer,`/api/documents/${docId}/download`);assert.equal(draftPdf.status,200);
  assert.equal(new TextDecoder().decode((await draftPdf.response.arrayBuffer()).slice(0,5)),'%PDF-');
  const updated=await call(issuer,'/api/documents/'+docId,'PUT',{...input,current_version:v,content_html:'TOP LEVEL TEXT<p><b>LATEST EDITS</b> '+('A long styled paragraph with all words retained. '.repeat(170))+'</p><ol><li>First item</li><li>Second item</li></ol>'});
  assert.equal(updated.status,200,JSON.stringify(updated.result));v=updated.result.current_version;
  assert.equal((await call(issuer,`/api/documents/${docId}/download`)).status,409);
  assert.equal((await call(issuer,'/api/documents/'+docId,'PUT',{...input,current_version:1})).status,409);
  const final=await call(issuer,`/api/documents/${docId}/finalize`,'POST',{current_version:v});assert.equal(final.status,200,JSON.stringify(final.result));v=final.result.current_version;
  assert.equal((await call(issuer,'/api/documents/'+docId,'PUT',{...input,current_version:v})).status,409);
  const snapshot=(await call(issuer,`/api/documents/${docId}/versions/${v}`)).result.version;
  assert.match(snapshot.rendered_html,/LATEST EDITS/);
  assert.throws(()=>DB.sqlite.prepare('UPDATE document_versions SET rendered_html=? WHERE document_id=? AND version_number=?').run('changed',docId,v),/immutable/);
  const templateEdit={...template,signatory_ids:['sig_hr'],header_html:'<div>CHANGED AFTER ISSUE</div>'};
  assert.equal((await call(admin,'/api/templates/'+template.id,'PUT',templateEdit)).status,200);
  const preview=(await call(issuer,`/api/documents/${docId}/versions/${v}/preview`)).result.html;
  assert.equal(preview,snapshot.rendered_html);assert.doesNotMatch(preview,/CHANGED AFTER ISSUE/);
  const page=await BROWSER.browser.newPage();await page.setContent(preview);await page.waitForFunction(()=>document.body.dataset.renderReady || document.body.dataset.renderError);
  assert.equal(await page.getAttribute('body','data-render-error'),null);
  assert.ok(await page.locator('.sheet').count()>1);
  const text=await page.locator('#pages').innerText();assert.match(text,/TOP LEVEL TEXT/);assert.match(text,/LATEST EDITS/);assert.match(text,/Second item/);
  const contentText=(await page.locator('.page-flow').allTextContents()).join('').replace(/\s+/g,' ');
  assert.equal((contentText.match(/A long styled paragraph with all words retained\./g)||[]).length,170);
  assert.ok(await page.locator('#pages b').count()>0);
  await page.screenshot({path:directory+'/multi-page.png',fullPage:true});await page.close();
  generated=await call(issuer,`/api/documents/${docId}/generate-pdf`,'POST');assert.equal(generated.status,200,JSON.stringify(generated.result));
  const issued=(await call(issuer,`/api/documents/${docId}/versions/${v}`)).result.version;
  await call(issuer,`/api/documents/${docId}/generate-pdf`,'POST');
  assert.equal((await call(issuer,`/api/documents/${docId}/versions/${v}`)).result.version.pdf_object_key,issued.pdf_object_key);
  const pdf=await call(issuer,`/api/documents/${docId}/download`);fs.writeFileSync(directory+'/issued.pdf',Buffer.from(await pdf.response.arrayBuffer()));
  const restored=await call(issuer,`/api/documents/${docId}/versions/1/restore`,'POST');assert.equal(restored.status,201);
  const restoredDoc=(await call(issuer,'/api/documents/'+restored.result.id)).result.document;assert.match(restoredDoc.content_html,/FIRST SAVED CONTENT/);assert.equal(restoredDoc.parent_document_id,docId);
  const csrfActor={cookie:issuer.cookie,csrf:'incorrect'};assert.equal((await call(csrfActor,`/api/documents/${docId}/archive`,'POST')).status,403);
  assert.equal((await call(issuer,'/api/auth/logout','POST')).status,200);assert.equal((await call(issuer,'/api/documents/'+docId)).status,401);
  DB.close();DB=localDatabase(directory);env.DB=DB;await signIn(issuer,'issuer@example.test','Changed-password-456!');
  assert.equal((await call(issuer,'/api/documents/'+docId)).result.document.status,'finalised');
  assert.equal((await call(issuer,`/api/documents/${docId}/versions`)).result.versions.length,3);
  assert.equal((await call(issuer,`/api/documents/${docId}/download`)).status,200);
  // Asset permissions and embedded snapshots.
  const bytes=fs.readFileSync('public/labdox-logo.jpeg');
  const upload=await worker.fetch(new Request('https://labdox.test/api/assets?name=Logo',{method:'POST',headers:{cookie:admin.cookie,'x-csrf-token':admin.csrf},body:bytes}),env);assert.equal(upload.status,201);const asset=await upload.json();
  const current=(await call(admin,'/api/templates/'+template.id)).result.template;
  assert.equal((await call(admin,'/api/templates/'+template.id,'PUT',{...current,signatory_ids:['sig_hr'],header_html:`<img src="${asset.url}" width="80" alt="Logo">`})).status,200);
  const branded=(await call(issuer,'/api/preview','POST',input));assert.equal(branded.status,200);assert.match(branded.result.html,/data:image\/jpeg;base64/);
  assert.equal((await call({},asset.url)).status,401);
  console.log('Workflow artifacts: '+directory);
 }finally{DB.close();await BROWSER.browser.close();}
});
