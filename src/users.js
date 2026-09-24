import { hashPassword } from './auth.js';
import { audit, cleanText, HttpError, id, json, randomPassword, validateEmail } from './utils.js';

export async function listUsers(env) {
  const result = await env.DB
    .prepare('SELECT id, email, full_name, role, is_active, must_change_password, created_at FROM users ORDER BY created_at')
    .all();
  return json({ users: result.results });
}

export async function createUser(request, env, actor) {
  const body = await request.json();
  const email = validateEmail(body.email);
  const fullName = cleanText(body.full_name, 120);
  const role = body.role === 'admin' ? 'admin' : 'issuer';
  if (!fullName) throw new HttpError('Full name is required.', 422);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').bind(email).first();
  if (existing) throw new HttpError('A user with this email already exists.', 409);

  const userId = id('usr');
  const salt = id('salt');
  const temporaryPassword = randomPassword();
  await env.DB.prepare(`INSERT INTO users (id, email, full_name, password_hash, password_salt, role, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, 1)`)
    .bind(userId, email, fullName, await hashPassword(temporaryPassword, salt), salt, role).run();
  await audit(env, request, actor.id, 'user.created', 'user', userId, { role });
  // The temporary password is returned once, in this response only, and is never stored or logged in plain text.
  return json({ id: userId, email, full_name: fullName, role, temporary_password: temporaryPassword }, 201);
}

export async function updateUser(request, env, actor, userId) {
  const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
  if (!target) throw new HttpError('User not found.', 404);
  const body = await request.json();
  const updates = { role: target.role, is_active: target.is_active };

  if (body.role !== undefined) updates.role = body.role === 'admin' ? 'admin' : 'issuer';
  if (body.is_active !== undefined) updates.is_active = body.is_active ? 1 : 0;
  if (userId === actor.id && (updates.role !== 'admin' || updates.is_active !== 1)) {
    throw new HttpError('You cannot remove your own admin access or deactivate yourself.', 409);
  }

  let temporaryPassword;
  if (body.reset_password) {
    temporaryPassword = randomPassword();
    const salt = id('salt');
    await env.DB.prepare('UPDATE users SET password_hash=?, password_salt=?, must_change_password=1 WHERE id=?')
      .bind(await hashPassword(temporaryPassword, salt), salt, userId).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId).run();
  }

  await env.DB.prepare('UPDATE users SET role=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(updates.role, updates.is_active, userId).run();
  if (!updates.is_active) await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId).run();
  await audit(env, request, actor.id, 'user.updated', 'user', userId, { role: updates.role, is_active: updates.is_active, reset_password: Boolean(body.reset_password) });
  return json({ id: userId, role: updates.role, is_active: Boolean(updates.is_active), ...(temporaryPassword ? { temporary_password: temporaryPassword } : {}) });
}
