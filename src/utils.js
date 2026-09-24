import sanitize from 'sanitize-html';
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

export const error = (message, status = 400, details) => json({ error: message, ...(details ? { details } : {}) }, status);
export const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const now = () => new Date().toISOString();
export const cleanText = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export function sanitizeHtml(input = '') {
  return sanitize(String(input), {
    allowedTags: ['p','div','span','b','strong','i','em','u','s','br','ul','ol','li','a','h1','h2','h3','h4','blockquote','img','table','thead','tbody','tr','th','td'],
    allowedAttributes: { '*':['class','style'], a:['href'], img:['src','alt','width','height'], ol:['start'], li:['value'], th:['colspan','rowspan'],td:['colspan','rowspan'] },
    allowedSchemes:['https','mailto'], allowProtocolRelative:false,
    allowedStyles: { '*': { 'text-align':[/^(left|right|center|justify)$/], 'font-weight':[/^(bold|normal|[1-9]00)$/], 'font-style':[/^(italic|normal)$/], 'text-decoration':[/^(underline|line-through|none)$/], color:[/^#[0-9a-f]{3,8}$/i], 'font-size':[/^\d{1,2}(px|pt)$/], width:[/^\d{1,3}(px|mm|%)$/], height:[/^\d{1,3}(px|mm)$/] } },
    exclusiveFilter: frame => frame.tag==='img' && !/^\/api\/assets\/[a-zA-Z0-9_]+$/.test(frame.attribs.src || '')
  });
}
export function sanitizeCss(input='') {
  // Custom rules cannot load remote resources or escape the style element.
  const css=String(input);
  if (/<|>|@|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) throw new HttpError('CSS must not contain imports, URLs or executable content.',422);
  return css.slice(0,20000);
}

export function validateDocument(body) {
  const required = ['template_id', 'recipient_name', 'letter_date', 'content_html', 'signatory_id'];
  const missing = required.filter((key) => !String(body[key] ?? '').trim());
  if (missing.length) throw new HttpError(`Missing required fields: ${missing.join(', ')}`, 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.letter_date) || !Number.isFinite(Date.parse(body.letter_date)) || new Date(body.letter_date).toISOString().slice(0,10) !== body.letter_date) throw new HttpError('Date must use YYYY-MM-DD.', 422);
  if (String(body.content_html).length > 100000) throw new HttpError('Letter content is too long.', 422);
  return {
    template_id: cleanText(body.template_id, 80),
    recipient_name: cleanText(body.recipient_name, 160),
    designation: cleanText(body.designation, 160) || null,
    letter_date: body.letter_date,
    subject: cleanText(body.subject, 300) || null,
    content_html: sanitizeHtml(body.content_html),
    signatory_id: cleanText(body.signatory_id, 80)
  };
}

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function audit(env, request, userId, action, entityType, entityId, metadata = {}) {
  await env.DB.prepare(`INSERT INTO audit_logs
    (id, user_id, action, entity_type, entity_id, metadata_json, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id('aud'), userId || null, action, entityType, entityId || null,
      JSON.stringify(metadata), request.headers.get('cf-connecting-ip'),
      cleanText(request.headers.get('user-agent'), 500)
    ).run();
}

export function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

const READABLE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function randomPassword(length = 14) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => READABLE_ALPHABET[b % READABLE_ALPHABET.length]).join('');
}

export function randomSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError('Enter a valid email address.', 422);
  return email;
}
