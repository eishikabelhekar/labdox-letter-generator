import { listAssets, uploadAsset, getAsset } from './assets.js';
import { changePassword, clearCookie, getCookie, login, publicUser, requireUser, sessionCookie } from './auth.js';
import { documentVersions, getVersion, previewDocument, archiveDocument, createDocument, downloadPdf, duplicateDocument, finalizeDocument, generatePdf, getDocument, listDocuments, updateDocument } from './documents.js';
import { createTemplate, getTemplate, listTemplates, updateTemplate } from './templates.js';
import { createUser, listUsers, updateUser } from './users.js';
import { audit, error, HttpError, json, now } from './utils.js';
import { ensureInitialData } from './bootstrap.js';

const securityHeaders = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' about:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

async function withSecurity(response) {
  const headers=new Headers(response.headers);
  Object.entries(securityHeaders).forEach(([key,value])=>headers.set(key,value));
  let body=response.body;
  if((headers.get('content-type')||'').includes('text/html')){
    const nonce=crypto.randomUUID().replaceAll('-','');
    headers.set('content-security-policy',securityHeaders['content-security-policy'].replace("script-src 'self'",`script-src 'self' 'nonce-${nonce}'`));
    body=(await response.text()).replace('<head>',`<head><meta name="render-nonce" content="${nonce}">`);
    headers.delete('content-length');headers.delete('etag');headers.set('cache-control','no-store');
  }
  return new Response(body,{status:response.status,statusText:response.statusText,headers});
}

async function body(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) throw new HttpError('Expected JSON request body.', 415);
  try { return await request.json(); } catch { throw new HttpError('Invalid JSON request body.', 400); }
}

async function api(request, env, path) {
  if (request.method === 'POST' && path === '/api/auth/login') {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const key = 'login:' + ip;
    const attempt = await env.DB.prepare('INSERT INTO login_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts').bind(key,new Date(Date.now()+15*60000).toISOString(),now(),now()).first();
    if (attempt.attempts>20) throw new HttpError('Too many login attempts. Try again in 15 minutes.',429);
    await ensureInitialData(env);
    const input = await body(request);
    const result = await login(env, input.email, input.password);
    await audit(env, request, result.user.id, 'auth.login', 'user', result.user.id);
    return json({ user: result.user, csrf_token: result.csrf }, 200, { 'set-cookie': sessionCookie(result.sessionId, result.expires, new URL(request.url).protocol === 'https:') });
  }

  const user = await requireUser(request, env);
  if (request.method === 'GET' && path === '/api/auth/me') return json({ user: publicUser(user), csrf_token: user.csrf_token });
  if (request.method === 'POST' && path === '/api/auth/logout') {
    const sid = getCookie(request, 'labdox_session');
    await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run();
    await audit(env, request, user.id, 'auth.logout', 'user', user.id);
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }

  if (request.method === 'GET' && path === '/api/bootstrap') {
    const [templates, signatories, stats] = await Promise.all([
      listTemplates(env, user.role === 'admin'),
      env.DB.prepare('SELECT id,name,designation,signature_object_key FROM signatories WHERE is_active=1 ORDER BY name').all(),
      env.DB.prepare(`SELECT COUNT(*) total, SUM(status='draft') drafts, SUM(status='finalised') finalised,
        SUM(status='archived') archived FROM documents ${user.role === 'admin' ? '' : 'WHERE created_by=?'}`).bind(...(user.role === 'admin' ? [] : [user.id])).first()
    ]);
    return json({ user: publicUser(user), csrf_token: user.csrf_token, templates, signatories: signatories.results, stats });
  }

  if (request.method === 'POST' && path === '/api/auth/password') {
    const input = await body(request);
    await changePassword(env, user.id, input.current_password, input.new_password);
    await audit(env, request, user.id, 'auth.password_changed', 'user', user.id);
    return json({ ok: true });
  }

  if (path === '/api/assets') {
    await requireUser(request,env,['admin']);
    if (request.method==='GET') return listAssets(env);
    if (request.method==='POST') return uploadAsset(request,env,user);
  }
  const assetMatch=path.match(/^\/api\/assets\/([a-zA-Z0-9_]+)$/);
  if (assetMatch && request.method==='GET') return getAsset(env,assetMatch[1]);
  if (path==='/api/preview' && request.method==='POST') return previewDocument(request,env,user);
  const versionsMatch=path.match(/^\/api\/documents\/([^/]+)\/versions(?:\/(\d+)(?:\/(preview|generate-pdf|download|restore))?)?$/);
  if (versionsMatch) {
    const [,documentId,version,action]=versionsMatch;
    if (!version && request.method==='GET') return documentVersions(env,user,documentId);
    if (action==='preview' && request.method==='GET') return previewDocument(request,env,user,documentId,version);
    if (action==='download' && request.method==='GET') return downloadPdf(request,env,user,documentId,version);
    if (action==='generate-pdf' && request.method==='POST') return generatePdf(request,env,user,documentId,version);
    if (action==='restore' && request.method==='POST') return duplicateDocument(request,env,user,documentId,version);
    if (!action && request.method==='GET') return json({version:await getVersion(env,user,documentId,version)});
  }
  if (path === '/api/users') {
    await requireUser(request, env, ['admin']);
    if (request.method === 'GET') return listUsers(env);
    if (request.method === 'POST') return createUser(request, env, user);
  }
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && request.method === 'PUT') {
    await requireUser(request, env, ['admin']);
    return updateUser(request, env, user, userMatch[1]);
  }

  if (path === '/api/templates') {
    if (request.method === 'GET') return json({ templates: await listTemplates(env, user.role === 'admin') });
    if (request.method === 'POST') { await requireUser(request, env, ['admin']); return createTemplate(request, env, user); }
  }
  const templateMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch) {
    if (request.method === 'GET') return json({ template: await getTemplate(env, templateMatch[1]) });
    if (request.method === 'PUT') { await requireUser(request, env, ['admin']); return updateTemplate(request, env, user, templateMatch[1]); }
  }

  if (path === '/api/documents') {
    if (request.method === 'GET') return listDocuments(request, env, user);
    if (request.method === 'POST') return createDocument(request, env, user);
  }
  const docMatch = path.match(/^\/api\/documents\/([^/]+)$/);
  if (docMatch) {
    if (request.method === 'GET') return json({ document: await getDocument(env, user, docMatch[1]) });
    if (request.method === 'PUT') return updateDocument(request, env, user, docMatch[1]);
  }
  const actionMatch = path.match(/^\/api\/documents\/([^/]+)\/(finalize|generate-pdf|download|duplicate|archive)$/);
  if (actionMatch) {
    const [, documentId, action] = actionMatch;
    if (action === 'download' && request.method === 'GET') return downloadPdf(request, env, user, documentId);
    if (request.method !== 'POST') throw new HttpError('Method not allowed.', 405);
    if (action === 'finalize') return finalizeDocument(request, env, user, documentId);
    if (action === 'generate-pdf') return generatePdf(request, env, user, documentId);
    if (action === 'duplicate') return duplicateDocument(request, env, user, documentId);
    if (action === 'archive') return archiveDocument(request, env, user, documentId);
  }
  throw new HttpError('API route not found.', 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return withSecurity(await api(request, env, url.pathname));
      return withSecurity(await env.ASSETS.fetch(request));
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 500;
      if (status === 500) console.error(cause);
      return withSecurity(error(status === 500 ? 'An unexpected server error occurred.' : cause.message, status));
    }
  },
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()).run();
    await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').bind(now()).run();
  }
};
