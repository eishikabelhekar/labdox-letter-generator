const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = { user: null, csrf: '', templates: [], signatories: [], documents: [], currentId: null, currentStatus: 'draft', zoom: .72, templateEditing: null, currentVersion: 1, nextOffset: null };

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(state.csrf ? { 'x-csrf-token': state.csrf } : {}), ...options.headers };
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('json') ? await response.json() : response;
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}

function toast(message, type = '') {
  const node = $('#toast'); node.textContent = message; node.className = `toast show ${type}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.className = 'toast', 2600);
}

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name = '') { return name.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase(); }
function formatDate(date) { return date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function templateById(id) { return state.templates.find((item) => item.id === id); }
function signatoryById(id) { return state.signatories.find((item) => item.id === id) || { name: '', designation: '' }; }

function route(name) {
  const allowed = ['dashboard', 'editor', 'history', 'templates', 'users'];
  if (!allowed.includes(name) || (['templates', 'users'].includes(name) && state.user?.role !== 'admin')) name = 'dashboard';
  $$('.page').forEach((page) => page.hidden = page.id !== `${name}-page`);
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.route === name));
  const titles = { dashboard: 'Overview', editor: state.currentId ? 'Edit letter' : 'Create letter', history: 'Documents', templates: 'Templates', users: 'Users' };
  $('#crumb').textContent = titles[name]; $('#page-title').textContent = titles[name];
  $('.sidebar').classList.remove('open'); location.hash = name;
  if (name === 'history') loadDocuments();
  if (name === 'templates') {renderTemplateList();loadAssets().catch(e=>toast(e.message,'error'));}
  if (name === 'users') loadUsers().catch((e) => toast(e.message, 'error'));
  if (name === 'editor') requestAnimationFrame(renderPreview);
}

async function initialize() {
  try {
    const me=await api('/api/auth/me');state.user=me.user;state.csrf=me.csrf_token;
    if(state.user.must_change_password){openPasswordDialog(true);return;}
    const data = await api('/api/bootstrap');
    state.user = data.user; state.csrf = data.csrf_token; state.templates = data.templates; state.signatories = data.signatories;
    $('#login-view').hidden = true; $('#app').hidden = false;
    $('#user-name').textContent = state.user.full_name; $('#user-role').textContent = state.user.role; $('#user-initials').textContent = initials(state.user.full_name);
    $$('.admin-only').forEach((node) => node.hidden = state.user.role !== 'admin');
    fillSelects(); renderStats(data.stats); await loadRecent();
    route(location.hash.slice(1) || 'dashboard');
    if (state.user.must_change_password) openPasswordDialog(true);
  } catch { $('#login-view').hidden = false; $('#app').hidden = true; }
}

function fillSelects() {
  const active = state.templates.filter((t) => Number(t.is_active));
  $('#template-id').innerHTML = active.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.document_type)}</option>`).join('');
  $('#filter-type').innerHTML = '<option value="">All types</option>' + [...new Set(state.templates.map((t) => t.document_type))].map((x) => `<option>${escapeHtml(x)}</option>`).join('');
  $('#signatory-id').innerHTML = state.signatories.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.designation)}</option>`).join('');
}

function renderStats(stats = {}) {
  const cards = [['total', 'Total documents', '▤'], ['drafts', 'Active drafts', '✎'], ['finalised', 'Finalised', '✓'], ['archived', 'Archived', '□']];
  $('#stats').innerHTML = cards.map(([key, label, icon]) => `<div class="stat"><div><strong>${Number(stats[key] || 0)}</strong><span>${label}</span></div><div class="stat-icon">${icon}</div></div>`).join('');
}

async function loadRecent() {
  const data = await api('/api/documents'); state.documents = data.documents;
  const rows = data.documents.slice(0, 5);
  $('#recent-list').innerHTML = rows.length ? rows.map((d) => `<div class="recent-row"><span class="doc-icon">▤</span><strong>${escapeHtml(d.recipient_name)}</strong><span class="meta">${escapeHtml(d.document_type)}</span><span class="status ${d.status}">${d.status}</span><span class="meta">${formatDate(d.letter_date)}</span></div>`).join('') : '<div class="empty">No letters yet. Create your first document.</div>';
}

function resetEditor() {
  state.currentId = null; state.currentVersion=1; state.currentStatus = 'draft'; $('#letter-form').reset();
  $('#letter-date').value = new Date().toISOString().slice(0, 10); $('#editor-title').textContent = 'Create a new letter';
  $('#template-id').disabled = false; $$('#letter-form input, #letter-form select').forEach((el) => el.disabled = false); $('#content-editor').contentEditable = 'true';
  const template = templateById($('#template-id').value); $('#content-editor').innerHTML = `${template?.default_opening_html || '<p>Dear {{recipient_name}},</p>'}${template?.default_closing_html || ''}`;
  $('#save-draft').hidden = false; $('#finalize').hidden = false; renderPreview();
}

function formData() {
  return { current_version:state.currentVersion, template_id: $('#template-id').value, recipient_name: $('#recipient-name').value, designation: $('#designation').value,
    letter_date: $('#letter-date').value, subject: $('#subject').value, content_html: $('#content-editor').innerHTML, signatory_id: $('#signatory-id').value };
}

async function saveDraft(quiet = false) {
  if (!$('#letter-form').reportValidity() || !$('#content-editor').innerText.trim()) { toast('Complete the required fields.', 'error'); return null; }
  const path = state.currentId ? `/api/documents/${state.currentId}` : '/api/documents';
  const result = await api(path, { method: state.currentId ? 'PUT' : 'POST', body: JSON.stringify(formData()) });
  state.currentId = result.id; state.currentVersion=result.current_version; state.currentStatus = 'draft'; $('#editor-title').textContent = 'Edit draft';
  if (!quiet) toast('Draft saved.'); return result;
}

async function openDocument(id) {
  const { document: d } = await api(`/api/documents/${id}`);
  state.currentId = d.id; state.currentVersion=d.current_version; state.currentStatus = d.status;
  $('#template-id').value = d.template_id; $('#recipient-name').value = d.recipient_name; $('#designation').value = d.designation || '';
  $('#letter-date').value = d.letter_date; $('#subject').value = d.subject || ''; $('#content-editor').innerHTML = d.content_html; $('#signatory-id').value = d.signatory_id;
  const locked = d.status !== 'draft'; $$('#letter-form input, #letter-form select').forEach((el) => el.disabled = locked); $('#content-editor').contentEditable = String(!locked);
  $('#save-draft').hidden = locked; $('#finalize').hidden = locked; $('#editor-title').textContent = locked ? `${d.document_number}` : 'Edit draft'; route('editor'); renderPreview();
}

let previewTimer,previewRequest=0;
function renderPreview(){clearTimeout(previewTimer);const serial=++previewRequest;$('#page-count').textContent='Updating preview…';previewTimer=setTimeout(()=>updatePreview(serial),200);}
function trustedPreview(html){const nonce=document.querySelector('meta[name=render-nonce]')?.content;return nonce?html.replace('<script>',`<script nonce="${nonce}">`):html;}
async function updatePreview(serial){
  if(!state.user || state.user.must_change_password || !$('#template-id').value)return;
  try{
    let data;
    if(state.currentId && state.currentStatus!=='draft') data=await api(`/api/documents/${state.currentId}/versions/${state.currentVersion}/preview`);
    else {const input=formData();input.recipient_name ||= 'Recipient name';input.letter_date ||= new Date().toISOString().slice(0,10);input.content_html ||= '<p>Letter content</p>';data=await api('/api/preview',{method:'POST',body:JSON.stringify(input)});}
    if(serial!==previewRequest)return;
    $('#preview-frame').srcdoc=trustedPreview(data.html);
  }catch(e){if(serial===previewRequest)$('#page-count').textContent=e.message;}
}
window.addEventListener('message',event=>{
  if(event.source!==$('#preview-frame').contentWindow || event.data?.type!=='labdox-render')return;
  if(event.data.error){$('#page-count').textContent=event.data.error;return;}
  $('#page-count').textContent=event.data.pages+' page'+(event.data.pages===1?'':'s');
  $('#preview-frame').style.height=event.data.height+'px';applyZoom();
});
function applyZoom(){const frame=$('#preview-frame');frame.style.transform=`scale(${state.zoom})`;$('#pages').style.height=(parseFloat(frame.style.height)||1123)*state.zoom+'px';$('#zoom-label').textContent=Math.round(state.zoom*100)+'%';}

async function loadDocuments(more = false) {
  const params = new URLSearchParams(); const q = $('#search-docs').value.trim(); if (q) params.set('q', q);
  [['type', '#filter-type'], ['status', '#filter-status'], ['from', '#filter-from'], ['to', '#filter-to']].forEach(([key, selector]) => { if ($(selector).value) params.set(key, $(selector).value); });
  if(more && state.nextOffset!==null)params.set('offset',state.nextOffset);
  const data = await api(`/api/documents?${params}`);state.nextOffset=data.next_offset;$('#more-documents').hidden=state.nextOffset===null; state.documents = data.documents; const tbody = $('#documents-table');
  tbody.innerHTML = (more ? tbody.innerHTML : '') + data.documents.map((d) => `<tr><td>${formatDate(d.letter_date)}</td><td>${escapeHtml(d.document_number || 'Draft')}</td><td>${escapeHtml(d.recipient_name)}</td><td>${escapeHtml(d.document_type)}</td><td>${escapeHtml(d.created_by_name)}</td><td><span class="status ${d.status}">${d.status}</span></td><td><div class="row-actions"><button data-action="view" data-id="${d.id}">${d.status === 'draft' ? 'Edit' : 'View'}</button>${d.pdf_object_key ? `<button data-action="download" data-id="${d.id}">PDF</button>` : ''}<button data-action="versions" data-id="${d.id}">Versions</button><button data-action="duplicate" data-id="${d.id}">Create revision</button>${d.status !== 'archived' ? `<button data-action="archive" data-id="${d.id}">Archive</button>` : ''}</div></td></tr>`).join('');
  $('#documents-empty').hidden = data.documents.length > 0;
}

function renderTemplateList() {
  $('#template-list').innerHTML = state.templates.map((t) => `<article class="template-card" data-template="${t.id}"><div><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.document_type)} · ${escapeHtml(t.number_prefix)} · Version ${t.version}</p></div><span class="status ${t.is_active ? 'finalised' : 'archived'}">${t.is_active ? 'Active' : 'Inactive'}</span></article>`).join('');
}

function openTemplate(template = null) {
  state.templateEditing = template; $('#template-form').hidden = false; $('#tpl-form-title').textContent = template ? 'Edit template' : 'New template';
  const set = (id, value = '') => $(id).value = value;
  set('#tpl-id', template?.id); set('#tpl-name', template?.name); set('#tpl-type', template?.document_type); set('#tpl-code', template?.code);
  set('#tpl-prefix', template?.number_prefix || 'LABDOX/TYPE/{{year}}/{{sequence}}'); set('#tpl-header', template?.header_html || '<div class="brand"><b>LABDOX</b></div><div class="rule"></div>');
  set('#tpl-footer', template?.footer_html || '<div class="footer"><span>Labdox Private Limited</span><span>www.labdox.com</span></div>');
  set('#tpl-continuation-header',template?.continuation_header_html);set('#tpl-continuation-footer',template?.continuation_footer_html);
  set('#tpl-opening', template?.default_opening_html); set('#tpl-closing', template?.default_closing_html); set('#tpl-css', template?.css); set('#tpl-margins', template?.margins_json || '{"top":38,"right":22,"bottom":30,"left":22}');
  $('#tpl-active').checked = !template || Boolean(template.is_active); $('#template-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveTemplate(event) {
  event.preventDefault(); const t = state.templateEditing;
  const payload = { version:t?.version, name: $('#tpl-name').value, document_type: $('#tpl-type').value, code: $('#tpl-code').value, number_prefix: $('#tpl-prefix').value,
    header_html: $('#tpl-header').value, footer_html: $('#tpl-footer').value, continuation_header_html: $('#tpl-continuation-header').value || $('#tpl-header').value,
    continuation_footer_html: $('#tpl-continuation-footer').value || $('#tpl-footer').value, default_opening_html: $('#tpl-opening').value, default_closing_html: $('#tpl-closing').value,
    css: $('#tpl-css').value, margins_json: $('#tpl-margins').value, signatory_ids: state.signatories.map((s) => s.id), is_active: $('#tpl-active').checked };
  await api(t ? `/api/templates/${t.id}` : '/api/templates', { method: t ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  const data = await api('/api/templates'); state.templates = data.templates; fillSelects(); renderTemplateList(); $('#template-form').hidden = true; toast('Template saved.');
}

async function loadUsers() {
  const { users } = await api('/api/users');
  $('#users-table').innerHTML = users.map((u) => `<tr>
      <td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td><span class="status ${u.is_active ? 'finalised' : 'archived'}">${u.is_active ? 'Active' : 'Disabled'}</span>${u.must_change_password ? ' <span class="status draft">Pending reset</span>' : ''}</td>
      <td><div class="row-actions">
        ${u.id === state.user.id ? '' : `<button data-user-action="toggle-role" data-id="${u.id}" data-role="${u.role === 'admin' ? 'issuer' : 'admin'}">${u.role === 'admin' ? 'Make issuer' : 'Make admin'}</button>
        <button data-user-action="toggle-active" data-id="${u.id}" data-active="${u.is_active ? 0 : 1}">${u.is_active ? 'Disable' : 'Enable'}</button>`}
        <button data-user-action="reset" data-id="${u.id}">Reset password</button>
      </div></td>
    </tr>`).join('');
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-user-action]'); if (!action) return;
  try {
    const { id, userAction } = { id: action.dataset.id, userAction: action.dataset.userAction };
    if (userAction === 'toggle-role') await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ role: action.dataset.role }) });
    if (userAction === 'toggle-active') await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: Number(action.dataset.active) }) });
    if (userAction === 'reset') {
      if (!await confirmAction('Reset this password?', 'A new temporary password will be generated and their current session will be signed out.')) return;
      const result = await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ reset_password: true }) });
      alert(`Temporary password: ${result.temporary_password}\n\nShare this securely - it will not be shown again.`);
    }
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
});

$('#new-user').addEventListener('click', () => { $('#user-form').hidden = false; $('#new-user-result').hidden = true; $('#user-form').reset(); $('#user-form').scrollIntoView({ behavior: 'smooth' }); });
$('#close-user').addEventListener('click', () => $('#user-form').hidden = true);
$('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/users', { method: 'POST', body: JSON.stringify({
      full_name: $('#new-user-name').value, email: $('#new-user-email').value, role: $('#new-user-role').value
    }) });
    $('#new-user-result').hidden = false;
    $('#new-user-result').textContent = `Account created. Temporary password: ${result.temporary_password} (share this securely - it will not be shown again).`;
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
});

function openPasswordDialog(forced = false) {
  $('#password-error').hidden = true; $('#password-form').reset();
  $('#password-intro').textContent = forced ? 'You are using a temporary password. Choose a new one to continue.' : 'Choose a new password. It must be at least 10 characters.';
  $('#password-cancel').hidden = forced;
  $('#password-dialog').dataset.forced = forced ? '1' : '';
  $('#password-dialog').showModal();
}
$('#open-password').addEventListener('click', () => openPasswordDialog(false));
$('#password-cancel').addEventListener('click', () => $('#password-dialog').close());
$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current_password: $('#pw-current').value, new_password: $('#pw-new').value }) });
    state.user.must_change_password = false;
    $('#password-dialog').close(); toast('Password updated.');await initialize();
  } catch (e) { $('#password-error').textContent = e.message; $('#password-error').hidden = false; }
});

function confirmAction(title, copy) {
  const dialog = $('#confirm-dialog'); $('#dialog-title').textContent = title; $('#dialog-copy').textContent = copy; dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

document.addEventListener('click', async (event) => {
  const routeButton = event.target.closest('[data-route]'); if (routeButton) { if (routeButton.dataset.route === 'editor') resetEditor(); route(routeButton.dataset.route); return; }
  const nav = event.target.closest('#mobile-menu'); if (nav) $('.sidebar').classList.toggle('open');
  const format = event.target.closest('[data-command]'); if (format) { event.preventDefault(); document.execCommand(format.dataset.command); $('#content-editor').focus(); renderPreview(); }
  const action = event.target.closest('[data-action]'); if (action) {
    try {
      const { id } = action.dataset;
      if (action.dataset.action === 'versions') await showVersions(id);
      if (action.dataset.action === 'view') await openDocument(id);
      if (action.dataset.action === 'download') location.href = `/api/documents/${id}/download`;
      if (action.dataset.action === 'duplicate') { const d = await api(`/api/documents/${id}/duplicate`, { method: 'POST' }); await openDocument(d.id); toast('Draft duplicated.'); }
      if (action.dataset.action === 'archive' && await confirmAction('Archive this document?', 'It stays in history and its PDF remains available.')) { await api(`/api/documents/${id}/archive`, { method: 'POST' }); await loadDocuments(); toast('Document archived.'); }
    } catch (e) { toast(e.message, 'error'); }
  }
  const card = event.target.closest('[data-template]'); if (card) openTemplate(state.templates.find((t) => t.id === card.dataset.template));
});

$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); $('#login-error').hidden = true; try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) }); state.csrf = data.csrf_token; await initialize(); } catch (e) { $('#login-error').textContent = e.message; $('#login-error').hidden = false; } });
$('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.reload(); } });
$('#save-draft').addEventListener('click', () => documentAction(()=>saveDraft()));
let documentBusy=false;
async function documentAction(action){
  if(documentBusy)return;documentBusy=true;['#save-draft','#finalize','#generate-pdf'].forEach(id=>$(id).disabled=true);
  try{await action();}catch(e){toast(e.message,'error');}finally{documentBusy=false;['#save-draft','#finalize','#generate-pdf'].forEach(id=>$(id).disabled=false);}
}
$('#finalize').addEventListener('click',()=>documentAction(async()=>{
  if(!await confirmAction('Finalise this letter?','Your latest edits will be saved and an immutable issued version will be created.'))return;
  if(!await saveDraft(true))return;
  const result=await api(`/api/documents/${state.currentId}/finalize`,{method:'POST',body:JSON.stringify({current_version:state.currentVersion})});
  await openDocument(result.id);toast('Letter finalised. Generate PDF to store its issued PDF.');
}));
$('#generate-pdf').addEventListener('click',()=>documentAction(async()=>{
  if(state.currentStatus==='draft' && !await saveDraft(true))return;
  await api(`/api/documents/${state.currentId}/generate-pdf`,{method:'POST'});
  location.href=`/api/documents/${state.currentId}/download`;toast('PDF generated and stored.');
}));
$('#template-id').addEventListener('change', () => { if (!state.currentId) { const t = templateById($('#template-id').value); $('#content-editor').innerHTML = `${t.default_opening_html}${t.default_closing_html}`; } renderPreview(); });
['input', 'change'].forEach((type) => $('#letter-form').addEventListener(type, () => requestAnimationFrame(renderPreview)));
$('#content-editor').addEventListener('input', () => requestAnimationFrame(renderPreview));
$('#add-link').addEventListener('click', () => { const url = prompt('Enter an https:// link'); if (url?.startsWith('https://')) document.execCommand('createLink', false, url); renderPreview(); });
$('#zoom-in').addEventListener('click', () => { state.zoom = Math.min(.95, state.zoom + .05); applyZoom(); }); $('#zoom-out').addEventListener('click', () => { state.zoom = Math.max(.45, state.zoom - .05); applyZoom(); });
let searchTimer; $$('#search-docs, #filter-type, #filter-status, #filter-from, #filter-to').forEach((node) => node.addEventListener(node.tagName === 'INPUT' ? 'input' : 'change', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadDocuments().catch((e) => toast(e.message, 'error')), 250); }));
$('#new-template').addEventListener('click', () => openTemplate()); $('#close-template').addEventListener('click', () => $('#template-form').hidden = true); $('#template-form').addEventListener('submit', (e) => saveTemplate(e).catch((x) => toast(x.message, 'error')));

initialize();

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  Promise.resolve(context.registerTool({
    name: 'start_letter_creation',
    title: 'Start letter creation',
    description: 'Open a new Labdox letter draft and optionally prefill its document type and recipient.',
    inputSchema: {
      type: 'object',
      properties: { documentType: { type: 'string' }, recipientName: { type: 'string' } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input = {}) {
      if (!state.user) throw new Error('Sign in before creating a letter.');
      resetEditor();
      if (typeof input.documentType === 'string') {
        const match = state.templates.find((item) => item.document_type.toLowerCase() === input.documentType.toLowerCase() && Number(item.is_active));
        if (!match) throw new Error('Unknown or inactive document type.');
        $('#template-id').value = match.id;
        $('#content-editor').innerHTML = `${match.default_opening_html}${match.default_closing_html}`;
      }
      if (typeof input.recipientName === 'string') $('#recipient-name').value = input.recipientName.slice(0, 160);
      route('editor'); renderPreview();
      return { status: 'ready', documentType: templateById($('#template-id').value)?.document_type, recipientName: $('#recipient-name').value };
    }
  }, { signal: lifecycle.signal })).catch(() => {});
}

registerWebMcp();

$('#letter-form').addEventListener('submit',e=>e.preventDefault());
$('#password-dialog').addEventListener('cancel',e=>{if($('#password-dialog').dataset.forced)e.preventDefault();});
$('#more-documents').addEventListener('click',()=>loadDocuments(true).catch(e=>toast(e.message,'error')));
async function showVersions(id){
 const data=await api(`/api/documents/${id}/versions`);const panel=$('#versions-list');
 panel.innerHTML=data.versions.map(v=>`<div class="version-row"><strong>Version ${v.version_number} · ${v.kind}</strong><span>${escapeHtml(v.created_at)}</span><div class="row-actions"><button data-version-action="preview" data-document="${id}" data-version="${v.version_number}">View</button><button data-version-action="pdf" data-document="${id}" data-version="${v.version_number}">PDF</button><button data-version-action="restore" data-document="${id}" data-version="${v.version_number}">Restore as new draft</button></div></div>`).join('');
 if(data.parent_document_id)panel.innerHTML+=`<p>Revises <button data-related="${data.parent_document_id}">previous document</button></p>`;
 panel.innerHTML+=data.revisions.map(d=>`<p>Revision: <button data-related="${d.id}">${escapeHtml(d.document_number || d.id)} (${d.status})</button></p>`).join('');
 $('#version-preview').srcdoc='';$('#versions-dialog').showModal();
}
$('#close-versions').addEventListener('click',()=>$('#versions-dialog').close());
$('#versions-dialog').addEventListener('click',async event=>{
 const related=event.target.closest('[data-related]');if(related){$('#versions-dialog').close();await openDocument(related.dataset.related);return;}
 const button=event.target.closest('[data-version-action]');if(!button)return;button.disabled=true;
 try{const base=`/api/documents/${button.dataset.document}/versions/${button.dataset.version}`;
 if(button.dataset.versionAction==='preview')$('#version-preview').srcdoc=trustedPreview((await api(base+'/preview')).html);
 if(button.dataset.versionAction==='pdf'){await api(base+'/generate-pdf',{method:'POST'});location.href=base+'/download';}
 if(button.dataset.versionAction==='restore'){const result=await api(base+'/restore',{method:'POST'});$('#versions-dialog').close();await openDocument(result.id);toast('Version restored as a linked draft.');}
 }catch(e){toast(e.message,'error');}finally{button.disabled=false;}
});
async function loadAssets(){const data=await api('/api/assets');$('#asset-list').innerHTML=data.assets.map(a=>`<div class="version-row"><span>${escapeHtml(a.name)}</span><code>&lt;img src="/api/assets/${a.id}" width="100" alt="Logo"&gt;</code></div>`).join('');}
$('#asset-upload').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 try{await api('/api/assets?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':file.type},body:file});await loadAssets();toast('Image stored. Copy its image tag into the template header.');}catch(e){toast(e.message,'error');}finally{event.target.value='';}
});
