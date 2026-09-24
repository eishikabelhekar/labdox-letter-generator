import { HttpError, id, now } from './utils.js';

const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}

export function getCookie(request, name) {
  const item = (request.headers.get('cookie') || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export async function login(env, email, password) {
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1').bind(String(email).trim()).first();
  if (!user || (await hashPassword(String(password), user.password_salt)) !== user.password_hash) throw new HttpError('Invalid email or password.', 401);
  const sessionId = id('ses');
  const csrf = crypto.randomUUID();
  const ttl = Number(env.SESSION_TTL_HOURS || 12);
  const expires = new Date(Date.now() + ttl * 3600000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').bind(sessionId, user.id, csrf, expires).run();
  return { user: publicUser(user), sessionId, csrf, expires };
}

export async function requireUser(request, env, roles) {
  const sid = getCookie(request, 'labdox_session');
  if (!sid) throw new HttpError('Authentication required.', 401);
  const row = await env.DB.prepare(`SELECT u.id, u.email, u.full_name, u.role, u.must_change_password, s.csrf_token
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`).bind(sid, now()).first();
  if (!row) throw new HttpError('Session expired.', 401);
  const path = new URL(request.url).pathname;
  if (row.must_change_password && !['/api/auth/me','/api/auth/password','/api/auth/logout'].includes(path)) throw new HttpError('Change your temporary password before continuing.',403);
  if (roles && !roles.includes(row.role)) throw new HttpError('You do not have permission for this action.', 403);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (request.headers.get('x-csrf-token') !== row.csrf_token) throw new HttpError('Invalid CSRF token.', 403);
  }
  return row;
}

export const publicUser = ({ id, email, full_name, role, must_change_password }) => ({
  id, email, full_name, role, must_change_password: Boolean(must_change_password)
});

export async function changePassword(env, userId, currentPassword, newPassword) {
  if (String(newPassword || '').length < 10) throw new HttpError('New password must be at least 10 characters.', 422);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
  if (!user || (await hashPassword(String(currentPassword || ''), user.password_salt)) !== user.password_hash) {
    throw new HttpError('Current password is incorrect.', 401);
  }
  const salt = id('salt');
  await env.DB.prepare('UPDATE users SET password_hash=?, password_salt=?, must_change_password=0, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(await hashPassword(String(newPassword), salt), salt, userId).run();
}

export function sessionCookie(sessionId, expires, secure = true) {
  return `labdox_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; ${secure ? 'Secure; ' : ''}Expires=${new Date(expires).toUTCString()}`;
}

export const clearCookie = () => 'labdox_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
