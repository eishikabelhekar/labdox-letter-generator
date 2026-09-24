import { audit, cleanText, HttpError, id, json, sanitizeCss, sanitizeHtml } from './utils.js';

function validate(body) {
  for (const key of ['name', 'document_type', 'code', 'number_prefix', 'header_html', 'footer_html']) {
    if (!String(body[key] ?? '').trim()) throw new HttpError(`${key} is required.`, 422);
  }
  let margins;
  try { margins = typeof body.margins_json === 'string' ? JSON.parse(body.margins_json) : body.margins_json; } catch { throw new HttpError('Margins must be valid JSON.', 422); }
  for (const side of ['top', 'right', 'bottom', 'left']) if (!Number.isFinite(Number(margins?.[side]))) throw new HttpError('All four margins are required.', 422);
  if (!String(body.number_prefix).includes('{{sequence}}') || !String(body.number_prefix).includes('{{year}}')) throw new HttpError('Number format must include {{year}} and {{sequence}}.',422);
  if (Number(margins.top)<25 || Number(margins.top)>70 || Number(margins.bottom)<20 || Number(margins.bottom)>60 || Number(margins.left)<10 || Number(margins.left)>50 || Number(margins.right)<10 || Number(margins.right)>50) throw new HttpError('Margins: top 25–70, bottom 20–60, left/right 10–50 mm.',422);
  return {
    name: cleanText(body.name, 120), document_type: cleanText(body.document_type, 100), code: cleanText(body.code, 20).toUpperCase(),
    number_prefix: cleanText(body.number_prefix, 120), header_html: sanitizeHtml(body.header_html), footer_html: sanitizeHtml(body.footer_html),
    continuation_header_html: sanitizeHtml(body.continuation_header_html), continuation_footer_html: sanitizeHtml(body.continuation_footer_html),
    default_opening_html: sanitizeHtml(body.default_opening_html), default_closing_html: sanitizeHtml(body.default_closing_html),
    css: sanitizeCss(body.css), margins_json: JSON.stringify(margins),
    signatory_ids_json: JSON.stringify(Array.isArray(body.signatory_ids) ? body.signatory_ids.map((x) => cleanText(x, 80)) : []),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1
  };
}

export async function listTemplates(env, includeInactive = false) {
  const result = await env.DB.prepare(`SELECT * FROM templates ${includeInactive ? '' : 'WHERE is_active=1'} ORDER BY document_type, name`).all();
  return result.results;
}

export async function getTemplate(env, templateId) {
  const row = await env.DB.prepare('SELECT * FROM templates WHERE id=?').bind(templateId).first();
  if (!row) throw new HttpError('Template not found.', 404);
  return row;
}

export async function createTemplate(request, env, user) {
  const data = validate(await request.json());
  const templateId = id('tpl');
  await env.DB.prepare(`INSERT INTO templates (id,name,document_type,code,number_prefix,header_html,footer_html,
    continuation_header_html,continuation_footer_html,default_opening_html,default_closing_html,css,margins_json,
    signatory_ids_json,is_active,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(templateId, ...Object.values(data), user.id).run();
  await audit(env, request, user.id, 'template.created', 'template', templateId);
  return json({ id: templateId }, 201);
}

export async function updateTemplate(request, env, user, templateId) {
  const current = await getTemplate(env, templateId);
  const input=await request.json();
  if (Number(input.version)!==current.version) throw new HttpError('Template changed. Reopen before saving.',409);
  const data = validate(input);
  const results=await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO template_versions (template_id,version,snapshot_json,created_by) VALUES (?,?,?,?)').bind(templateId,current.version,JSON.stringify(current),user.id),
    env.DB.prepare(`UPDATE templates SET name=?,document_type=?,code=?,number_prefix=?,header_html=?,footer_html=?,
    continuation_header_html=?,continuation_footer_html=?,default_opening_html=?,default_closing_html=?,css=?,margins_json=?,
    signatory_ids_json=?,is_active=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?`).bind(...Object.values(data), templateId,current.version)
  ]);
  if(!results[1].meta.changes)throw new HttpError('Template changed. Reopen before saving.',409);
  await audit(env, request, user.id, 'template.updated', 'template', templateId, { previous_version: current.version });
  return json({ id: templateId, version: Number(current.version) + 1 });
}
