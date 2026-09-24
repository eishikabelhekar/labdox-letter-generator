import { audit, cleanText, HttpError, id, json } from './utils.js';

export async function listAssets(env) {
  return json({ assets: (await env.DB.prepare('SELECT id,name,mime_type,size,created_at FROM assets ORDER BY created_at DESC').all()).results });
}

export async function uploadAsset(request, env, user) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new HttpError('Choose an image up to 2 MB.', 422);
  const png = [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new HttpError('Only PNG and JPEG images are supported.', 422);
  const assetId = id('asset'), objectKey = `assets/${assetId}`, mime = png ? 'image/png' : 'image/jpeg';
  const name = cleanText(new URL(request.url).searchParams.get('name'), 160) || 'Brand asset';
  await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare('INSERT INTO assets (id,name,mime_type,object_key,size,created_by) VALUES (?,?,?,?,?,?)')
    .bind(assetId,name,mime,objectKey,bytes.length,user.id).run();
  await audit(env, request,user.id,'asset.uploaded','asset',assetId);
  return json({ id: assetId, name, url: `/api/assets/${assetId}` }, 201);
}

export async function getAsset(env, assetId) {
  const row = await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(assetId).first();
  const object = row && await env.FILES.get(row.object_key);
  if (!object) throw new HttpError('Asset not found.',404);
  return new Response(object.body, { headers: { 'content-type': row.mime_type, 'cache-control':'private, no-store' } });
}

export async function embedAssets(env, html) {
  const ids = [...new Set([...html.matchAll(/src="\/api\/assets\/([a-zA-Z0-9_]+)"/g)].map(m => m[1]))];
  for (const assetId of ids) {
    const response = await getAsset(env,assetId);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    html = html.replaceAll(`/api/assets/${assetId}`,`data:${response.headers.get('content-type')};base64,${btoa(binary)}`);
  }
  return html;
}
