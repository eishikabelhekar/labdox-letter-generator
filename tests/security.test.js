import test from 'node:test';
import assert from 'node:assert/strict';
import { randomPassword, sanitizeHtml, validateDocument, validateEmail } from '../src/utils.js';
import { substitute } from '../src/render.js';
import { hashPassword } from '../src/auth.js';

test('sanitizer removes executable content and event handlers', () => {
  const value = sanitizeHtml('<p onclick="boom()">Hello</p><script>alert(1)</script>');
  assert.equal(value.includes('onclick'), false);
  assert.equal(value.includes('<script'), false);
});

test('template variables render from an allow-list', () => {
  assert.equal(substitute('Hello {{recipient_name}} {{unknown}}', { recipient_name: 'Asha' }), 'Hello Asha ');
});

test('document validation rejects missing fields', () => {
  assert.throws(() => validateDocument({}), /Missing required fields/);
});

test('demo password hash matches the hosted runtime-compatible value', async () => {
  assert.equal(await hashPassword('Admin@123', 'labdox-demo-salt'), 'e6aea852952683af5f4bc30af6d3cfc0e40df326b30f9929c04e1459dcb3043d');
});

test('random passwords are long enough and free of ambiguous characters', () => {
  const value = randomPassword();
  assert.equal(value.length, 14);
  assert.equal(/[0O1lI]/.test(value), false);
});

test('email validation rejects malformed addresses', () => {
  assert.throws(() => validateEmail('not-an-email'), /valid email/);
  assert.equal(validateEmail('  Person@Example.com '), 'person@example.com');
});

test('sanitizer blocks unquoted script URLs and remote image requests', () => {
  const html=sanitizeHtml('<a href=javascript:alert(1)>click</a><img src="https://external.test/tracker"><img src="/api/assets/asset_test" onerror="evil()">');
  assert.doesNotMatch(html,/javascript:|external\.test|onerror/);
  assert.match(html,/\/api\/assets\/asset_test/);
});

test('document dates reject impossible calendar days', () => {
  assert.throws(()=>validateDocument({template_id:'tpl',recipient_name:'Person',letter_date:'2026-02-31',content_html:'<p>Letter</p>',signatory_id:'sig'}),/Date/);
});
