import { audit, cleanText, HttpError, id, json, now, validateDocument } from './utils.js';
import { renderDocument, snapshot } from './render.js';
import { embedAssets } from './assets.js';
import { fileStore } from './file-store.js';

async function context(env, data) {
  const template = await env.DB.prepare('SELECT * FROM templates WHERE id=? AND is_active=1').bind(data.template_id).first();
  const signatory = await env.DB.prepare('SELECT * FROM signatories WHERE id=? AND is_active=1').bind(data.signatory_id).first();
  if (!template || !signatory) throw new HttpError('Choose an active template and signatory.',422);
  const allowed = JSON.parse(template.signatory_ids_json || '[]');
  if (allowed.length && !allowed.includes(signatory.id)) throw new HttpError('Signatory is not allowed for this template.',422);
  return { template, signatory };
}
export async function listDocuments(request, env, user) {
  const params = new URL(request.url).searchParams, clauses = [], values = [];
  if (user.role !== 'admin') { clauses.push('d.created_by=?'); values.push(user.id); }
  if (params.get('q')) { clauses.push('(d.recipient_name LIKE ? OR d.document_number LIKE ?)'); values.push(...Array(2).fill(`%${cleanText(params.get('q'),100)}%`)); }
  for (const [param,column,operator] of [['type','document_type','='],['status','status','='],['from','letter_date','>='],['to','letter_date','<=']]) {
    if (params.get(param)) { clauses.push(`d.${column}${operator}?`); values.push(cleanText(params.get(param),100)); }
  }
  const limit=100, offset=Math.max(0,Number.parseInt(params.get('offset') || '0') || 0);
  const where=clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows=await env.DB.prepare(`SELECT d.*,u.full_name AS created_by_name FROM documents d JOIN users u ON u.id=d.created_by ${where} ORDER BY d.updated_at DESC,d.id LIMIT ? OFFSET ?`).bind(...values,limit+1,offset).all();
  return json({ documents:rows.results.slice(0,limit), next_offset:rows.results.length>limit ? offset+limit : null });
}
export async function getDocument(env,user,documentId) {
  const row=await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(documentId).first();
  if (!row || (user.role!=='admin' && row.created_by!==user.id)) throw new HttpError('Document not found.',404);
  return row;
}
function versionStatement(env,doc,template,signatory,html,kind,expected) {
  return env.DB.prepare(`INSERT INTO document_versions (id,document_id,version_number,template_id,template_version,snapshot_json,rendered_html,issued_by,kind)
    SELECT ?,?,?,?,?,?,?,?,? FROM documents WHERE id=? AND current_version=? AND status='draft'`)
    .bind(id('ver'),doc.id,doc.current_version,template.id,template.version,JSON.stringify(snapshot(doc,template,signatory)),html,doc.updated_by,kind,doc.id,expected);
}
export async function createDocument(request,env,user,supplied) {
  const input=supplied || await request.json(), data=validateDocument(input), {template,signatory}=await context(env,data);
  if (input.parent_document_id) await getDocument(env,user,input.parent_document_id);
  const doc={...data,id:id('doc'),document_type:template.document_type,created_by:user.id,updated_by:user.id,current_version:1,status:'draft',parent_document_id:input.parent_document_id || null};
  const html=await embedAssets(env,renderDocument(doc,template,signatory));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO documents (id,template_id,document_type,recipient_name,designation,letter_date,subject,content_html,signatory_id,created_by,updated_by,parent_document_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(doc.id,template.id,doc.document_type,data.recipient_name,data.designation,data.letter_date,data.subject,data.content_html,data.signatory_id,user.id,user.id,doc.parent_document_id),
    versionStatement(env,doc,template,signatory,html,'draft',1)
  ]);
  await audit(env,request,user.id,'document.created','document',doc.id,{parent_document_id:doc.parent_document_id});
  return json({id:doc.id,status:'draft',current_version:1},201);
}
export async function updateDocument(request,env,user,documentId) {
  const existing=await getDocument(env,user,documentId), input=await request.json();
  if (existing.status!=='draft') throw new HttpError('Issued documents are locked. Create a revision instead.',409);
  if (Number(input.current_version)!==existing.current_version) throw new HttpError('This draft changed. Reopen it before saving.',409);
  const data=validateDocument(input), {template,signatory}=await context(env,data);
  const doc={...existing,...data,document_type:template.document_type,updated_by:user.id,current_version:existing.current_version+1,pdf_object_key:null};
  const html=await embedAssets(env,renderDocument(doc,template,signatory));
  let results;
  try { results=await env.DB.batch([
    versionStatement(env,doc,template,signatory,html,'draft',existing.current_version),
    env.DB.prepare(`UPDATE documents SET template_id=?,document_type=?,recipient_name=?,designation=?,letter_date=?,subject=?,content_html=?,signatory_id=?,updated_by=?,updated_at=?,current_version=?,pdf_object_key=NULL WHERE id=? AND status='draft' AND current_version=?`)
      .bind(template.id,doc.document_type,doc.recipient_name,doc.designation,doc.letter_date,doc.subject,doc.content_html,doc.signatory_id,user.id,now(),doc.current_version,doc.id,existing.current_version)
  ]); } catch(e) { if (/UNIQUE constraint/.test(e.message)) throw new HttpError('This draft changed. Reopen it before saving.',409); throw e; }
  if (!results[1].meta.changes) throw new HttpError('This draft changed. Reopen it before saving.',409);
  await audit(env,request,user.id,'document.updated','document',doc.id,{version:doc.current_version});
  return json({id:doc.id,status:'draft',current_version:doc.current_version});
}
export async function finalizeDocument(request,env,user,documentId) {
  const doc=await getDocument(env,user,documentId), input=await request.json();
  if (doc.status!=='draft' || Number(input.current_version)!==doc.current_version) throw new HttpError('This document changed. Reopen it before finalising.',409);
  const {template,signatory}=await context(env,doc), year=Number(doc.letter_date.slice(0,4));
  // Shared formats share a sequence so different HR letter types cannot collide.
  const sequence=await env.DB.prepare(`INSERT INTO document_sequences (document_type,year,last_value) VALUES (?,?,1)
    ON CONFLICT(document_type,year) DO UPDATE SET last_value=last_value+1 RETURNING last_value`).bind(template.number_prefix,year).first();
  const documentNumber=template.number_prefix.replaceAll('{{year}}',String(year)).replaceAll('{{sequence}}',String(sequence.last_value).padStart(5,'0'));
  const finalDoc={...doc,document_number:documentNumber,status:'finalised',current_version:doc.current_version+1,updated_by:user.id,pdf_object_key:null};
  const html=await embedAssets(env,renderDocument(finalDoc,template,signatory));
  let results;
  try { results=await env.DB.batch([
    versionStatement(env,finalDoc,template,signatory,html,'finalised',doc.current_version),
    env.DB.prepare(`UPDATE documents SET document_number=?,status='finalised',finalised_at=?,updated_at=?,updated_by=?,current_version=?,pdf_object_key=NULL WHERE id=? AND status='draft' AND current_version=?`)
      .bind(documentNumber,now(),now(),user.id,finalDoc.current_version,doc.id,doc.current_version)
  ]); } catch(e) { if (/UNIQUE constraint/.test(e.message)) throw new HttpError('Document changed or number already exists. Reopen and retry.',409); throw e; }
  if (!results[1].meta.changes) throw new HttpError('This document changed. Reopen before finalising.',409);
  await audit(env,request,user.id,'document.finalised','document',doc.id,{document_number:documentNumber,version:finalDoc.current_version});
  return json({id:doc.id,status:'finalised',document_number:documentNumber,current_version:finalDoc.current_version});
}
export async function documentVersions(env,user,documentId) {
  const doc=await getDocument(env,user,documentId);
  if(!doc.document_number)await getVersion(env,user,documentId,doc.current_version);
  const versions=await env.DB.prepare('SELECT version_number,kind,created_at,pdf_object_key FROM document_versions WHERE document_id=? ORDER BY version_number DESC').bind(documentId).all();
  const revisions=await env.DB.prepare(`SELECT id,document_number,status FROM documents WHERE parent_document_id=? ${user.role==='admin'?'':'AND created_by=?'}`).bind(documentId,...(user.role==='admin'?[]:[user.id])).all();
  return json({versions:versions.results,parent_document_id:doc.parent_document_id,revisions:revisions.results});
}
export async function getVersion(env,user,documentId,version) {
  const doc=await getDocument(env,user,documentId);
  let row=await env.DB.prepare('SELECT * FROM document_versions WHERE document_id=? AND version_number=?').bind(documentId,Number(version)).first();
  // Upgrade pre-versioning drafts without inventing a history for earlier unsaved states.
  if(!row && Number(version)===doc.current_version && !doc.document_number){
    const template=await env.DB.prepare('SELECT * FROM templates WHERE id=?').bind(doc.template_id).first();
    const signatory=await env.DB.prepare('SELECT * FROM signatories WHERE id=?').bind(doc.signatory_id).first();
    const html=await embedAssets(env,renderDocument(doc,template,signatory));
    await env.DB.prepare(`INSERT OR IGNORE INTO document_versions (id,document_id,version_number,template_id,template_version,snapshot_json,rendered_html,issued_by,kind)
      SELECT ?,?,?,?,?,?,?,?,'draft' FROM documents WHERE id=? AND current_version=? AND document_number IS NULL`)
      .bind(id('ver'),doc.id,doc.current_version,template.id,template.version,JSON.stringify(snapshot(doc,template,signatory)),html,user.id,doc.id,doc.current_version).run();
    row=await env.DB.prepare('SELECT * FROM document_versions WHERE document_id=? AND version_number=?').bind(doc.id,doc.current_version).first();
  }
  if (!row) throw new HttpError('Version not found.',404);
  return row;
}
export async function previewDocument(request,env,user,documentId,version) {
  if (documentId) {
    const doc=await getDocument(env,user,documentId), saved=await getVersion(env,user,documentId,version || doc.current_version);
    return json({html:saved.rendered_html});
  }
  const data=validateDocument(await request.json()), {template,signatory}=await context(env,data);
  return json({html:await embedAssets(env,renderDocument({...data,status:'draft'},template,signatory))});
}
export async function generatePdf(request,env,user,documentId,version) {
  const doc=await getDocument(env,user,documentId), saved=await getVersion(env,user,documentId,version || doc.current_version);
  if (saved.pdf_object_key && await fileStore(env).head(saved.pdf_object_key)) return json({id:doc.id,ready:true,version:saved.version_number});
  if (!env.BROWSER) throw new HttpError('Server PDF rendering is not configured. Configure the Cloudflare browser binding.',503);
  const response=await env.BROWSER.quickAction('pdf',{html:saved.rendered_html,waitForSelector:{selector:'body[data-render-ready="true"]',timeout:30000},pdfOptions:{format:'a4',printBackground:true,preferCSSPageSize:true}});
  if (!response.ok) throw new HttpError('PDF service unavailable. Your saved document is safe; retry generation.',503);
  const pdf=await response.arrayBuffer();
  if (new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-') throw new HttpError('PDF service returned an invalid file.',503);
  const key=`documents/${doc.id}/v${saved.version_number}/${id('pdf')}.pdf`;
  await fileStore(env).put(key,pdf,{httpMetadata:{contentType:'application/pdf'}});
  const result=await env.DB.prepare('UPDATE document_versions SET pdf_object_key=? WHERE document_id=? AND version_number=? AND pdf_object_key IS ?').bind(key,doc.id,saved.version_number,saved.pdf_object_key).run();
  if (!result.meta.changes) await fileStore(env).delete(key);
  await env.DB.prepare(`UPDATE documents SET pdf_object_key=(SELECT pdf_object_key FROM document_versions WHERE document_id=? AND version_number=?) WHERE id=? AND current_version=?`).bind(doc.id,saved.version_number,doc.id,saved.version_number).run();
  await audit(env,request,user.id,'pdf.generated','document',doc.id,{version:saved.version_number});
  return json({id:doc.id,ready:true,version:saved.version_number});
}
export async function downloadPdf(request,env,user,documentId,version) {
  const doc=await getDocument(env,user,documentId), saved=await getVersion(env,user,documentId,version || doc.current_version);
  const object=saved.pdf_object_key && await fileStore(env).get(saved.pdf_object_key);
  if (!object) throw new HttpError('Generate this version’s PDF first.',409);
  await audit(env,request,user.id,'pdf.downloaded','document',doc.id,{version:saved.version_number});
  const name=(doc.document_number || doc.recipient_name).replace(/[^a-z0-9_-]+/gi,'-');
  return new Response(object.body,{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="${name}-v${saved.version_number}.pdf"`,'cache-control':'private, no-store'}});
}
export async function duplicateDocument(request,env,user,documentId,version) {
  const doc=await getDocument(env,user,documentId);
  const original=version ? JSON.parse((await getVersion(env,user,documentId,version)).snapshot_json).document : doc;
  return createDocument(request,env,user,{...original,parent_document_id:doc.id,letter_date:new Date().toISOString().slice(0,10)});
}
export async function archiveDocument(request,env,user,documentId) {
  await getDocument(env,user,documentId);
  await env.DB.prepare("UPDATE documents SET status='archived',archived_at=?,updated_at=?,updated_by=? WHERE id=?").bind(now(),now(),user.id,documentId).run();
  await audit(env,request,user.id,'document.archived','document',documentId);
  return json({id:documentId,status:'archived'});
}
