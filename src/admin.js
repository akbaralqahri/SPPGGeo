(function () {
  'use strict';

  const S = window.SPPGShared;
  const D = window.SPPG_DATA;
  const Importer = window.SPPGImporter;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const e = S.escapeHTML;
  const SESSION_KEY = 'sppg-admin-session';
  const ROLE_LABELS = { viewer: 'Viewer', operator: 'Operator', verifier: 'Verifier', approver: 'Approver', super_admin: 'Super Admin' };
  const ROLE_RANK = { viewer: 0, operator: 1, verifier: 2, approver: 3, super_admin: 4 };
  const WORKFLOW_LABELS = { draft: 'Draft', review: 'Menunggu review', revision: 'Perlu revisi', verified: 'Terverifikasi', published: 'Dipublikasikan', archived: 'Diarsipkan' };
  const AUDIT_FIELD_LABELS = {
    status_operasional: 'Status operasional', kapasitas_porsi: 'Kapasitas porsi', penerima_manfaat: 'Penerima manfaat',
    tanggal_berdiri: 'Tanggal berdiri', catatan_operasional: 'Catatan operasional', workflow_status: 'Workflow',
    review_notes: 'Catatan review', lat: 'Lintang', lng: 'Bujur', location_accuracy: 'Presisi lokasi', alamat: 'Alamat', yayasan: 'Yayasan',
  };

  let session = null;
  let profile = null;
  let rows = [];
  let contextRows = [];
  let team = [];
  let importHistory = [];
  let selectedId = null;
  let recordComments = [];
  let recordEvidence = [];
  let reviewFilter = 'actionable';
  let refreshTimer = null;
  const importState = { file: null, matrix: null, headers: [], mapping: {}, items: [], summary: null, filter: 'all' };

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(value) {
    session = value;
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  }
  const can = (role) => (ROLE_RANK[profile?.role] ?? -1) >= ROLE_RANK[role];
  const canEditContent = (row) => profile?.role === 'super_admin' ||
    (profile?.role === 'operator' && ['draft', 'revision', 'published'].includes(row.workflowStatus)) ||
    (profile?.role === 'verifier' && ['review', 'revision'].includes(row.workflowStatus));
  const workflowBadge = (status) => `<span class="workflow-badge ${e(status)}">${e(WORKFLOW_LABELS[status] || status)}</span>`;
  const statusBadge = (status) => `<span class="status-badge ${e(status)}">${e(S.STATUS_LABELS[status] || status)}</span>`;

  async function authenticate(email, password) {
    const payload = await S.api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    const next = { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Date.now() + payload.expires_in * 1000, user: payload.user };
    const profiles = await S.api(`/rest/v1/admin_users?select=*&user_id=eq.${encodeURIComponent(payload.user.id)}`, { token: next.accessToken });
    if (!profiles?.length || !profiles[0].active) {
      await S.api('/auth/v1/logout', { method: 'POST', token: next.accessToken }).catch(() => {});
      throw new Error('Akun belum terdaftar sebagai anggota aktif control room.');
    }
    profile = profiles[0];
    setSession(next);
    return next;
  }

  async function validateSession(candidate) {
    if (!candidate?.accessToken) return null;
    if (candidate.refreshToken && candidate.expiresAt < Date.now() + 60_000) candidate = await refreshSession(candidate);
    const user = await S.api('/auth/v1/user', { token: candidate.accessToken });
    const profiles = await S.api(`/rest/v1/admin_users?select=*&user_id=eq.${encodeURIComponent(user.id)}`, { token: candidate.accessToken });
    if (!profiles?.length || !profiles[0].active) throw new Error('Akses control room tidak tersedia.');
    profile = profiles[0];
    candidate.user = user;
    return candidate;
  }

  async function refreshSession(candidate = session) {
    if (!candidate?.refreshToken) throw new Error('Sesi telah berakhir. Silakan masuk kembali.');
    const payload = await S.api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: candidate.refreshToken } });
    const next = { accessToken: payload.access_token, refreshToken: payload.refresh_token || candidate.refreshToken, expiresAt: Date.now() + payload.expires_in * 1000, user: payload.user || candidate.user };
    setSession(next);
    return next;
  }

  async function loadCoreData() {
    const [remote, context, batches, members] = await Promise.all([
      S.loadRemoteRows(session.accessToken),
      S.loadRemoteContext(session.accessToken).catch(() => []),
      S.api('/rest/v1/import_batches?select=*&order=created_at.desc&limit=20', { token: session.accessToken }).catch(() => []),
      S.api('/rest/v1/admin_users?select=*&order=created_at.asc', { token: session.accessToken }).catch(() => [profile]),
    ]);
    rows = remote;
    contextRows = context;
    importHistory = batches || [];
    team = members?.length ? members : [profile];
    renderWorkspace();
  }

  function kpi(label, value, detail) {
    return `<article class="kpi-card"><small>${e(label)}</small><div><b>${value}</b><p>${e(detail)}</p></div></article>`;
  }

  function renderWorkspace() {
    const model = S.derive(rows, D.nationalProvinces, contextRows);
    const pending = rows.filter((row) => ['review', 'revision', 'verified'].includes(row.workflowStatus)).length;
    $('#adminKpis').innerHTML = [
      kpi('Total data', S.fmt(model.total), 'database operasional'),
      kpi('Dipublikasikan', S.fmt(rows.filter((row) => row.workflowStatus === 'published').length), 'terlihat di dashboard publik'),
      kpi('Menunggu keputusan', S.fmt(pending), 'review, revisi, atau publish'),
      kpi('Kapasitas tercatat', S.fmt(model.capacity), `${model.capacityKnown} dapur memiliki data`),
    ].join('');
    $('#reviewBadge').textContent = pending;
    $('#recordListCount').textContent = `${rows.length} lokasi`;
    renderRecordList();
    renderContextForm();
    renderImportHistory();
    renderReviewQueue();
    renderTeam();
  }

  function navigateAdmin(view) {
    $$('.admin-view').forEach((section) => { const active = section.dataset.adminView === view; section.hidden = !active; section.classList.toggle('active', active); });
    $$('[data-admin-view-target]').forEach((button) => button.classList.toggle('active', button.dataset.adminViewTarget === view));
    if (view === 'audit') loadAudit();
    if (view === 'review') renderReviewQueue();
    if (view === 'team') renderTeam();
  }

  function renderRecordList() {
    const q = $('#adminSearch').value.trim().toLowerCase();
    const workflow = $('#recordWorkflowFilter').value;
    const filtered = rows.filter((row) =>
      (!workflow || row.workflowStatus === workflow) &&
      (!q || [row.no, row.provinsi, row.kabkota, row.yayasan].some((value) => String(value).toLowerCase().includes(q)))
    );
    $('#recordListCount').textContent = `${filtered.length} dari ${rows.length} lokasi`;
    $('#adminRecords').innerHTML = filtered.map((row) => `<button type="button" class="admin-record-button ${row.id === selectedId ? 'active' : ''}" data-admin-record="${e(row.id)}"><span class="admin-record-no">${row.no}</span><span><b>${e(row.kabkota)} · ${e(row.provinsi)}</b><small>${e(row.yayasan === '-' ? 'Yayasan belum dicantumkan' : row.yayasan)}</small><span class="record-badges">${workflowBadge(row.workflowStatus)}${statusBadge(row.statusOperasional)}</span></span></button>`).join('') || '<p class="empty-list-copy">Tidak ada data yang sesuai.</p>';
    $$('[data-admin-record]', $('#adminRecords')).forEach((button) => button.addEventListener('click', () => selectRecord(button.dataset.adminRecord)));
  }

  async function selectRecord(id) {
    selectedId = id;
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    renderRecordList();
    $('#emptyEditor').hidden = true;
    $('#recordEditor').hidden = false;
    $('#editorNumber').textContent = `SPPG #${row.no} · ${row.provinsi} · versi ${row.version}`;
    $('#editorTitle').textContent = row.kabkota;
    $('#editorAddress').textContent = `${row.alamat} · ${row.yayasan === '-' ? 'Yayasan belum dicantumkan' : row.yayasan}`;
    $('#editorWorkflow').textContent = WORKFLOW_LABELS[row.workflowStatus];
    $('#editorWorkflow').className = `workflow-badge ${row.workflowStatus}`;
    $('#editStatus').value = row.statusOperasional;
    $('#editEstablished').value = row.tanggalBerdiri || '';
    $('#editCapacity').value = row.kapasitasPorsi ?? '';
    $('#editBeneficiaries').value = row.penerimaManfaat ?? '';
    $('#editLat').value = row.locationAccuracy === 'alamat_presisi' ? row.lat : '';
    $('#editLng').value = row.locationAccuracy === 'alamat_presisi' ? row.lng : '';
    $('#editNotes').value = row.catatanOperasional || '';
    $('#editReviewNotes').value = row.reviewNotes || '';
    $('#saveMessage').textContent = '';
    $('#recordForm').querySelectorAll('input,select,textarea,button').forEach((node) => node.disabled = !canEditContent(row));
    renderWorkflowActions(row);
    await loadRecordCollaboration(row.id);
  }

  function renderWorkflowActions(row) {
    const actions = [];
    if (['operator', 'super_admin'].includes(profile.role) && ['draft', 'revision'].includes(row.workflowStatus)) actions.push(['review', 'Kirim untuk review']);
    if (['verifier', 'super_admin'].includes(profile.role) && row.workflowStatus === 'review') actions.push(['revision', 'Minta revisi'], ['verified', 'Verifikasi']);
    if (['approver', 'super_admin'].includes(profile.role) && row.workflowStatus === 'verified') actions.push(['revision', 'Kembalikan'], ['published', 'Publikasikan']);
    if (profile.role === 'super_admin' && row.workflowStatus === 'published') actions.push(['archived', 'Arsipkan']);
    if (profile.role === 'super_admin' && row.workflowStatus === 'archived') actions.push(['published', 'Publikasikan ulang']);
    const hints = {
      draft: 'Lengkapi data dan bukti sebelum dikirim ke verifier.', review: 'Verifier meninjau perubahan dan bukti pendukung.',
      revision: 'Operator perlu menindaklanjuti catatan revisi.', verified: 'Data telah lolos verifikasi dan menunggu approver.',
      published: 'Data aktif di dashboard publik.', archived: 'Data disimpan sebagai arsip dan tidak tampil ke publik.',
    };
    $('#workflowHint').textContent = hints[row.workflowStatus];
    $('#workflowActions').innerHTML = actions.map(([status, label]) => `<button type="button" class="button ${status === 'published' || status === 'verified' ? 'primary' : 'secondary'}" data-workflow-next="${status}">${label}</button>`).join('') || '<span class="workflow-no-action">Tidak ada tindakan untuk role ini</span>';
    $$('[data-workflow-next]', $('#workflowActions')).forEach((button) => button.addEventListener('click', () => transitionWorkflow(row, button.dataset.workflowNext)));
  }

  async function saveRecord(event) {
    event.preventDefault();
    const row = rows.find((item) => item.id === selectedId);
    if (!row || !canEditContent(row)) return;
    const latValue = $('#editLat').value;
    const lngValue = $('#editLng').value;
    if ((latValue && !lngValue) || (!latValue && lngValue)) { $('#saveMessage').textContent = 'Lintang dan bujur harus diisi bersama.'; return; }
    const patch = {
      status_operasional: $('#editStatus').value,
      tanggal_berdiri: $('#editEstablished').value || null,
      kapasitas_porsi: $('#editCapacity').value === '' ? null : Number($('#editCapacity').value),
      penerima_manfaat: $('#editBeneficiaries').value === '' ? null : Number($('#editBeneficiaries').value),
      catatan_operasional: $('#editNotes').value.trim() || null,
      review_notes: $('#editReviewNotes').value.trim() || null,
      last_verified_at: new Date().toISOString(),
    };
    if (row.workflowStatus === 'published' && profile.role !== 'super_admin') patch.workflow_status = 'review';
    if (latValue && lngValue) { patch.lat = Number(latValue); patch.lng = Number(lngValue); patch.location_accuracy = 'alamat_presisi'; }
    await patchRecord(row, patch, 'Perubahan operasional tersimpan.');
  }

  async function transitionWorkflow(row, next) {
    if (next === 'revision' && !$('#editReviewNotes').value.trim()) {
      $('#saveMessage').textContent = 'Tambahkan catatan review sebelum meminta revisi.';
      $('#editReviewNotes').focus();
      return;
    }
    const now = new Date().toISOString();
    const patch = { workflow_status: next, review_notes: $('#editReviewNotes').value.trim() || null };
    if (next === 'verified') Object.assign(patch, { verified_by: session.user.id, verified_at: now, last_verified_at: now });
    if (next === 'published') Object.assign(patch, { approved_by: session.user.id, approved_at: now, published_at: now });
    await patchRecord(row, patch, `Workflow berubah menjadi ${WORKFLOW_LABELS[next]}.`);
  }

  async function patchRecord(row, patch, successMessage) {
    const button = $('#recordForm button[type="submit"]');
    if (button) button.disabled = true;
    $('#saveMessage').textContent = 'Menyimpan…';
    try {
      const result = await S.api(`/rest/v1/sppg_records?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', token: session.accessToken, body: patch, prefer: 'return=representation' });
      const updated = S.normalizeRecord(result?.[0] || { ...S.toDatabaseRecord(row), ...patch });
      rows = rows.map((item) => item.id === row.id ? updated : item);
      S.toast(patch.workflow_status === 'review' ? 'Perubahan tersimpan dan dikirim kembali ke review.' : successMessage);
      renderWorkspace();
      await selectRecord(updated.id);
    } catch (error) {
      $('#saveMessage').textContent = error.message;
    } finally { if (button) button.disabled = !canEditContent(rows.find((item) => item.id === row.id) || row); }
  }

  async function loadRecordCollaboration(id) {
    const [comments, evidence] = await Promise.all([
      S.api(`/rest/v1/record_comments?select=*&sppg_id=eq.${encodeURIComponent(id)}&order=created_at.asc`, { token: session.accessToken }).catch(() => []),
      S.api(`/rest/v1/sppg_evidence?select=*&sppg_id=eq.${encodeURIComponent(id)}&order=created_at.desc`, { token: session.accessToken }).catch(() => []),
    ]);
    if (id !== selectedId) return;
    recordComments = comments || [];
    recordEvidence = evidence || [];
    renderComments();
    renderEvidence();
  }

  const actorName = (id) => team.find((member) => member.user_id === id)?.display_name || (id === session.user.id ? profile.display_name || session.user.email : 'Anggota tim');

  function renderComments() {
    $('#commentCount').textContent = recordComments.length;
    $('#commentList').innerHTML = recordComments.map((comment) => `<article class="comment-item"><div><b>${e(actorName(comment.author_id))}</b><time>${new Date(comment.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</time></div><p>${e(comment.body)}</p></article>`).join('') || '<p class="empty-list-copy">Belum ada komentar.</p>';
    $('#commentForm').querySelectorAll('textarea,button').forEach((node) => node.disabled = !can('operator'));
  }

  async function addComment(event) {
    event.preventDefault();
    const body = $('#commentBody').value.trim();
    if (!body || !selectedId) return;
    try {
      const result = await S.api('/rest/v1/record_comments', { method: 'POST', token: session.accessToken, body: { sppg_id: selectedId, body, author_id: session.user.id }, prefer: 'return=representation' });
      recordComments.push(result[0]);
      $('#commentBody').value = '';
      renderComments();
    } catch (error) { S.toast(error.message); }
  }

  function renderEvidence() {
    $('#evidenceCount').textContent = recordEvidence.length;
    $('#evidenceList').innerHTML = recordEvidence.map((item) => `<article class="evidence-item"><span>${item.mime_type === 'application/pdf' ? 'PDF' : 'IMG'}</span><div><b>${e(item.file_name)}</b><small>${e(item.note || 'Tanpa keterangan')} · ${Math.ceil(item.file_size / 1024)} KB</small></div><button type="button" data-open-evidence="${e(item.id)}">Buka</button></article>`).join('') || '<p class="empty-list-copy">Belum ada bukti.</p>';
    $$('[data-open-evidence]', $('#evidenceList')).forEach((button) => button.addEventListener('click', () => openEvidence(button.dataset.openEvidence)));
    $('#evidenceForm').querySelectorAll('input,button').forEach((node) => node.disabled = !can('operator'));
  }

  async function uploadEvidence(event) {
    event.preventDefault();
    const file = $('#evidenceFile').files[0];
    if (!file || !selectedId) return;
    if (file.size > 5 * 1024 * 1024) { S.toast('Ukuran file melebihi 5 MB.'); return; }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) { S.toast('Format file tidak diizinkan.'); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const storagePath = `${selectedId}/${Date.now()}-${safeName}`;
    const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
    const button = $('#evidenceForm button');
    button.disabled = true; button.textContent = 'Mengunggah…';
    let uploaded = false;
    try {
      const response = await fetch(`${S.config().supabaseUrl}/storage/v1/object/sppg-evidence/${encodedPath}`, { method: 'POST', headers: { apikey: S.config().supabaseAnonKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || payload.error || 'Upload file gagal.'); }
      uploaded = true;
      const metadata = await S.api('/rest/v1/sppg_evidence', { method: 'POST', token: session.accessToken, body: { sppg_id: selectedId, storage_path: storagePath, file_name: file.name, mime_type: file.type, file_size: file.size, note: $('#evidenceNote').value.trim() || null, uploaded_by: session.user.id }, prefer: 'return=representation' });
      recordEvidence.unshift(metadata[0]);
      $('#evidenceForm').reset();
      renderEvidence();
      S.toast('Bukti verifikasi berhasil diunggah.');
    } catch (error) {
      if (uploaded) await fetch(`${S.config().supabaseUrl}/storage/v1/object/sppg-evidence/${encodedPath}`, { method: 'DELETE', headers: { apikey: S.config().supabaseAnonKey, Authorization: `Bearer ${session.accessToken}` } }).catch(() => {});
      S.toast(error.message);
    }
    finally { button.disabled = !can('operator'); button.textContent = 'Unggah bukti'; }
  }

  async function openEvidence(id) {
    const item = recordEvidence.find((entry) => entry.id === id);
    if (!item) return;
    try {
      const encodedPath = item.storage_path.split('/').map(encodeURIComponent).join('/');
      const payload = await S.api(`/storage/v1/object/sign/sppg-evidence/${encodedPath}`, { method: 'POST', token: session.accessToken, body: { expiresIn: 300 } });
      const signed = payload.signedURL || payload.signedUrl;
      if (!signed) throw new Error('Tautan bukti tidak tersedia.');
      const url = /^https?:/.test(signed) ? signed : `${S.config().supabaseUrl}/storage/v1${signed}`;
      open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { S.toast(error.message); }
  }

  async function seedSnapshot() {
    if (profile.role !== 'super_admin') { S.toast('Hanya Super Admin yang dapat menyinkronkan snapshot awal.'); return; }
    if (!confirm('Tambahkan snapshot lokal ke database? Data dengan ID yang sudah ada akan dipertahankan.')) return;
    const button = $('#seedData'); button.disabled = true; button.textContent = 'Menyinkronkan…';
    try {
      const source = (D.rows || []).map(S.normalizeRecord).map(S.toDatabaseRecord);
      await S.api('/rest/v1/sppg_records?on_conflict=id', { method: 'POST', token: session.accessToken, body: source, prefer: 'resolution=ignore-duplicates,return=minimal' });
      await loadCoreData();
      S.toast('Snapshot awal berhasil disinkronkan.');
    } catch (error) { S.toast(error.message); }
    finally { button.disabled = false; button.textContent = 'Sinkronkan snapshot'; }
  }

  /* Import center */
  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { S.toast('File import maksimal 15 MB.'); return; }
    importState.file = file;
    $('#importFileMeta').hidden = false;
    $('#importFileMeta').innerHTML = `<div><b>${e(file.name)}</b><small>${Math.ceil(file.size / 1024)} KB · membaca file…</small></div>`;
    try {
      const matrix = await Importer.parseFile(file);
      if (matrix.length < 2) throw new Error('File tidak memiliki baris data.');
      importState.matrix = matrix;
      importState.headers = matrix[0].map((value, index) => String(value || `Kolom ${index + 1}`));
      importState.mapping = Importer.suggestMapping(importState.headers);
      $('#importFileMeta').innerHTML = `<div><b>${e(file.name)}</b><small>${matrix.length - 1} baris · ${importState.headers.length} kolom</small></div><button type="button" id="clearImport">Ganti file</button>`;
      $('#clearImport').addEventListener('click', clearImport);
      renderMapping();
      analyzeImport();
    } catch (error) {
      $('#importFileMeta').innerHTML = `<div><b>File gagal dibaca</b><small>${e(error.message)}</small></div>`;
      S.toast(error.message);
    }
  }

  function renderMapping() {
    $('#mappingPanel').hidden = false;
    $('#mappingFields').innerHTML = Importer.FIELD_DEFINITIONS.map((field) => `<label>${e(field.label)}${field.required ? ' *' : ''}<select data-map-field="${field.key}"><option value="-1">Tidak dipakai</option>${importState.headers.map((header, index) => `<option value="${index}"${importState.mapping[field.key] === index ? ' selected' : ''}>${e(header)}</option>`).join('')}</select></label>`).join('');
    $$('[data-map-field]', $('#mappingFields')).forEach((select) => select.addEventListener('change', () => { importState.mapping[select.dataset.mapField] = Number(select.value); analyzeImport(); }));
  }

  function analyzeImport() {
    if (!importState.matrix) return;
    importState.items = Importer.buildRecords(importState.matrix, importState.mapping, rows, D.nationalProvinces);
    importState.summary = Importer.summarize(importState.items);
    $('#importResults').hidden = false;
    $('#importStats').innerHTML = [
      ['Total', importState.summary.total, 'neutral'], ['Baru', importState.summary.added, 'added'], ['Berubah', importState.summary.changed, 'changed'],
      ['Sama', importState.summary.unchanged, 'unchanged'], ['Invalid', importState.summary.invalid, 'invalid'],
    ].map(([label, value, type]) => `<div class="import-stat ${type}"><span>${label}</span><b>${value}</b></div>`).join('');
    const ready = importState.summary.added + importState.summary.changed;
    $('#commitSummary').textContent = `${ready} baris siap dimasukkan, ${importState.summary.invalid} invalid dilewati`;
    $('#commitImport').disabled = !ready || !can('operator');
    renderImportPreview();
  }

  function renderImportPreview() {
    const items = importState.filter === 'all' ? importState.items : importState.items.filter((item) => item.action === importState.filter);
    $('#importPreview tbody').innerHTML = items.slice(0, 150).map((item) => `<tr><td>${item.rowNumber}</td><td><span class="import-action ${item.action}">${item.action}</span></td><td><b>${e(item.record.kabkota || '—')}</b><small>${e(item.record.provinsi || '—')}</small></td><td>${e(item.record.alamat || '—')}<small>${e(item.record.yayasan || '—')}</small></td><td>${item.errors.length ? `<span class="validation-error">${e(item.errors.join(' · '))}</span>` : item.changedFields.length ? `<span>${e(item.changedFields.join(', '))}</span>` : '<span class="muted">Tidak berubah</span>'}${item.warnings.length ? `<small class="validation-warning">${e(item.warnings.join(' · '))}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">Tidak ada baris pada filter ini.</td></tr>';
  }

  function clearImport() {
    Object.assign(importState, { file: null, matrix: null, headers: [], mapping: {}, items: [], summary: null, filter: 'all' });
    $('#importFile').value = '';
    $('#importFileMeta').hidden = true;
    $('#mappingPanel').hidden = true;
    $('#importResults').hidden = true;
  }

  async function commitImport() {
    if (!['operator', 'super_admin'].includes(profile.role)) return;
    const commitItems = importState.items.filter((item) => ['added', 'changed'].includes(item.action) && !item.errors.length);
    if (!commitItems.length || !confirm(`Commit ${commitItems.length} baris aman ke database? Data baru menjadi Draft dan data berubah masuk antrean Review.`)) return;
    const button = $('#commitImport'); button.disabled = true; button.textContent = 'Memproses…';
    let batchId;
    try {
      const extension = importState.file.name.split('.').pop().toLowerCase();
      const batchPayload = { filename: importState.file.name, file_type: extension, total_rows: importState.summary.total, added_rows: importState.summary.added, changed_rows: importState.summary.changed, unchanged_rows: importState.summary.unchanged, invalid_rows: importState.summary.invalid, status: 'preview', mapping: importState.mapping, created_by: session.user.id };
      const batch = await S.api('/rest/v1/import_batches', { method: 'POST', token: session.accessToken, body: batchPayload, prefer: 'return=representation' });
      batchId = batch[0].id;
      const itemPayloads = importState.items.map((item) => ({ batch_id: batchId, row_number: item.rowNumber, record_id: item.record.id || null, action: item.action, payload: S.toDatabaseRecord(item.record), previous_record: item.matched ? S.toDatabaseRecord(item.matched) : null, validation_errors: item.errors }));
      await S.api('/rest/v1/import_batch_items', { method: 'POST', token: session.accessToken, body: itemPayloads, prefer: 'return=minimal' });
      const records = commitItems.map((item) => ({ ...S.toDatabaseRecord(item.record), workflow_status: item.action === 'added' ? 'draft' : 'review', source_batch_id: batchId }));
      await S.api('/rest/v1/sppg_records?on_conflict=id', { method: 'POST', token: session.accessToken, body: records, prefer: 'resolution=merge-duplicates,return=minimal' });
      await S.api(`/rest/v1/import_batches?id=eq.${batchId}`, { method: 'PATCH', token: session.accessToken, body: { status: 'committed', committed_at: new Date().toISOString() }, prefer: 'return=minimal' });
      S.toast(`Import selesai: ${commitItems.length} baris masuk workflow.`);
      clearImport();
      await loadCoreData();
      navigateAdmin('review');
    } catch (error) {
      if (batchId) await S.api(`/rest/v1/import_batches?id=eq.${batchId}`, { method: 'PATCH', token: session.accessToken, body: { status: 'failed' } }).catch(() => {});
      S.toast(error.message);
    } finally { button.disabled = false; button.textContent = 'Commit data aman'; }
  }

  function renderImportHistory() {
    $('#importHistory').innerHTML = importHistory.map((batch) => `<article class="import-history-item"><div><b>${e(batch.filename)}</b><small>${new Date(batch.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</small></div><span class="import-action ${e(batch.status)}">${e(batch.status)}</span><p>${batch.added_rows} baru · ${batch.changed_rows} berubah · ${batch.invalid_rows} invalid</p></article>`).join('') || '<p class="empty-list-copy">Belum ada riwayat import.</p>';
  }

  function downloadTemplate() {
    const csv = 'no,provinsi,kabkota,alamat,yayasan,lat,lng,status_operasional,kapasitas_porsi,penerima_manfaat,tanggal_berdiri\n1,Jawa Barat,Kota Bandung,"Jl. Contoh No. 1",Yayasan Contoh,-6.9175,107.6191,persiapan,3000,2500,2026-01-15';
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'template_import_sppg.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* Review queue */
  function renderReviewQueue() {
    const counts = Object.fromEntries(['draft', 'review', 'revision', 'verified', 'published'].map((status) => [status, rows.filter((row) => row.workflowStatus === status).length]));
    $('#reviewKpis').innerHTML = [kpi('Draft', counts.draft, 'belum dikirim'), kpi('Menunggu review', counts.review, 'tugas verifier'), kpi('Perlu revisi', counts.revision, 'tugas operator'), kpi('Siap publish', counts.verified, 'tugas approver')].join('');
    let queue = rows;
    if (reviewFilter === 'actionable') queue = rows.filter((row) => ['review', 'revision', 'verified'].includes(row.workflowStatus));
    else if (reviewFilter === 'quality') queue = rows.filter((row) => row.flags.length);
    else queue = rows.filter((row) => row.workflowStatus === reviewFilter);
    queue = queue.sort((a, b) => (b.flags.length - a.flags.length) || (b.version - a.version));
    $('#reviewQueue').innerHTML = queue.map((row) => `<article class="review-card"><div class="review-card-index">#${row.no}</div><div class="review-card-main"><div>${workflowBadge(row.workflowStatus)}${row.flags.length ? `<span class="flag-badge">${row.flags.length} catatan kualitas</span>` : ''}</div><h3>${e(row.kabkota)}, ${e(row.provinsi)}</h3><p>${e(row.alamat)}</p><small>${e(row.yayasan === '-' ? 'Yayasan belum tersedia' : row.yayasan)} · versi ${row.version}</small></div><div class="review-card-meta"><span>${row.kapasitasPorsi === null ? 'Kapasitas belum diisi' : `${S.fmt(row.kapasitasPorsi)} porsi/hari`}</span><span>${row.locationAccuracy === 'alamat_presisi' ? 'Lokasi presisi' : 'Centroid kab/kota'}</span><button type="button" class="button secondary" data-review-open="${e(row.id)}">Buka data</button></div></article>`).join('') || '<div class="empty-state-wide"><b>Antrean bersih</b><p>Tidak ada data yang sesuai dengan filter ini.</p></div>';
    $$('[data-review-open]', $('#reviewQueue')).forEach((button) => button.addEventListener('click', async () => { navigateAdmin('records'); await selectRecord(button.dataset.reviewOpen); }));
  }

  /* Audit */
  async function loadAudit() {
    $('#auditTimeline').innerHTML = '<p class="empty-list-copy">Memuat audit…</p>';
    try {
      const logs = await S.api('/rest/v1/sppg_audit_log?select=*&order=changed_at.desc&limit=100', { token: session.accessToken });
      renderAudit(logs || []);
    } catch (error) { $('#auditTimeline').innerHTML = `<p class="empty-list-copy">${e(error.message)}</p>`; }
  }

  function changedFields(log) {
    if (!log.before_record) return ['Data dibuat'];
    return Object.keys(log.after_record || {}).filter((key) => AUDIT_FIELD_LABELS[key] && String(log.before_record[key] ?? '') !== String(log.after_record[key] ?? '')).map((key) => AUDIT_FIELD_LABELS[key]);
  }

  function renderAudit(logs) {
    const actors = new Set(logs.map((log) => log.changed_by).filter(Boolean)).size;
    const today = logs.filter((log) => new Date(log.changed_at).toDateString() === new Date().toDateString()).length;
    $('#auditSummary').innerHTML = `<div class="panel-head compact"><div><span class="section-kicker">100 aktivitas terakhir</span><h2>Ringkasan audit</h2></div></div><div class="audit-summary-body"><div><b>${logs.length}</b><span>Aktivitas dimuat</span></div><div><b>${today}</b><span>Hari ini</span></div><div><b>${actors}</b><span>Pelaku perubahan</span></div></div>`;
    $('#auditTimeline').innerHTML = logs.map((log) => {
      const row = rows.find((item) => item.id === log.sppg_id);
      const changes = changedFields(log);
      return `<article class="audit-item"><span class="audit-dot"></span><div class="audit-item-head"><div><b>${e(actorName(log.changed_by))}</b><span>${e(log.action.replace('workflow_', 'Workflow → '))}</span></div><time>${new Date(log.changed_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</time></div><h3>${e(row ? `${row.kabkota}, ${row.provinsi}` : log.sppg_id)}</h3><p>${changes.length ? e(changes.join(' · ')) : 'Metadata sistem diperbarui'}</p>${row ? `<button type="button" data-audit-open="${e(row.id)}">Buka data →</button>` : ''}</article>`;
    }).join('') || '<p class="empty-list-copy">Belum ada aktivitas audit.</p>';
    $$('[data-audit-open]', $('#auditTimeline')).forEach((button) => button.addEventListener('click', async () => { navigateAdmin('records'); await selectRecord(button.dataset.auditOpen); }));
  }

  /* Context */
  function renderContextForm() {
    const select = $('#contextProvince');
    const current = select.value || D.nationalProvinces[0];
    select.innerHTML = D.nationalProvinces.map((name) => `<option value="${e(name)}">${e(name)}</option>`).join('');
    select.value = D.nationalProvinces.includes(current) ? current : D.nationalProvinces[0];
    $('#contextCoverage').textContent = `${contextRows.filter((item) => item.targetPortions || item.populationTarget).length} / 38 lengkap`;
    populateContext(select.value);
  }

  function populateContext(province) {
    const item = contextRows.find((row) => row.provinsi === province) || {};
    $('#contextPopulation').value = item.populationTarget ?? ''; $('#contextTarget').value = item.targetPortions ?? '';
    $('#contextSchools').value = item.schoolCount ?? ''; $('#contextStunting').value = item.stuntingRate ?? '';
    $('#contextPoverty').value = item.povertyRate ?? ''; $('#contextPeriod').value = item.period || '';
    $('#contextSource').value = item.sourceName || ''; $('#contextUrl').value = item.sourceUrl || ''; $('#contextMessage').textContent = '';
  }

  async function saveContext(event) {
    event.preventDefault();
    if (!['operator', 'super_admin'].includes(profile.role)) return;
    const value = (selector) => $(selector).value === '' ? null : Number($(selector).value);
    const payload = { provinsi: $('#contextProvince').value, population_target: value('#contextPopulation'), target_portions: value('#contextTarget'), school_count: value('#contextSchools'), stunting_rate: value('#contextStunting'), poverty_rate: value('#contextPoverty'), period: $('#contextPeriod').value.trim() || null, source_name: $('#contextSource').value.trim() || null, source_url: $('#contextUrl').value.trim() || null };
    const button = $('#contextForm button'); button.disabled = true; $('#contextMessage').textContent = 'Menyimpan…';
    try {
      const result = await S.api('/rest/v1/province_context?on_conflict=provinsi', { method: 'POST', token: session.accessToken, body: payload, prefer: 'resolution=merge-duplicates,return=representation' });
      const saved = S.normalizeContext(result?.[0] || payload);
      contextRows = [...contextRows.filter((item) => item.provinsi !== saved.provinsi), saved];
      renderContextForm(); $('#contextMessage').textContent = 'Konteks tersimpan.'; S.toast(`Konteks ${saved.provinsi} diperbarui.`);
    } catch (error) { $('#contextMessage').textContent = error.message; }
    finally { button.disabled = !['operator', 'super_admin'].includes(profile.role); }
  }

  /* Team */
  function renderTeam() {
    $('#teamCount').textContent = `${team.length} anggota`;
    $('#teamAccessNote').textContent = profile?.role === 'super_admin' ? 'Dapat mengubah role' : 'Read only';
    $('#teamList').innerHTML = team.map((member) => `<article class="team-row"><span class="team-avatar">${e((member.display_name || 'A').slice(0, 1).toUpperCase())}</span><div><b>${e(member.display_name || 'Anggota tim')}</b><small>${member.user_id === session.user.id ? e(session.user.email) : e(member.user_id)}</small></div><label>Role<select data-team-role="${e(member.user_id)}" ${profile?.role !== 'super_admin' || member.user_id === session.user.id ? 'disabled' : ''}>${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}"${member.role === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="team-active"><input type="checkbox" data-team-active="${e(member.user_id)}" ${member.active ? 'checked' : ''} ${profile?.role !== 'super_admin' || member.user_id === session.user.id ? 'disabled' : ''} /> Aktif</label></article>`).join('');
    $$('[data-team-role]').forEach((select) => select.addEventListener('change', () => updateTeamMember(select.dataset.teamRole, { role: select.value })));
    $$('[data-team-active]').forEach((checkbox) => checkbox.addEventListener('change', () => updateTeamMember(checkbox.dataset.teamActive, { active: checkbox.checked })));
  }

  async function updateTeamMember(userId, patch) {
    try {
      const result = await S.api(`/rest/v1/admin_users?user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', token: session.accessToken, body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      team = team.map((member) => member.user_id === userId ? result[0] : member);
      renderTeam(); S.toast('Akses anggota diperbarui.');
    } catch (error) { S.toast(error.message); renderTeam(); }
  }

  async function logout() {
    if (session?.accessToken) await S.api('/auth/v1/logout', { method: 'POST', token: session.accessToken }).catch(() => {});
    clearInterval(refreshTimer); refreshTimer = null;
    setSession(null); profile = null; $('#adminWorkspace').hidden = true; $('#adminLogin').hidden = false; $('#loginPassword').value = '';
  }

  function showWorkspace() {
    $('#adminLogin').hidden = true; $('#adminWorkspace').hidden = false;
    $('#headerRole').hidden = false; $('#headerRole').textContent = ROLE_LABELS[profile.role] || profile.role;
    $('#adminIdentity').textContent = `${profile.display_name || session.user.email} · ${ROLE_LABELS[profile.role]} · perubahan tersimpan dalam audit trail.`;
    $('#seedData').hidden = profile.role !== 'super_admin';
    const canManageInputs = ['operator', 'super_admin'].includes(profile.role);
    $$('[data-admin-view-target="import"], [data-admin-view-target="context"]').forEach((node) => { node.disabled = !canManageInputs; });
    $('#contextForm').querySelectorAll('input,select,button').forEach((node) => node.disabled = !canManageInputs);
    if (!refreshTimer) refreshTimer = setInterval(async () => {
      if (!session?.refreshToken || session.expiresAt >= Date.now() + 120_000) return;
      try { await refreshSession(); } catch { await logout(); S.toast('Sesi berakhir. Silakan masuk kembali.'); }
    }, 60_000);
  }

  function bindEvents() {
    $('#loginForm').addEventListener('submit', async (event) => {
      event.preventDefault(); const button = $('#loginForm button'); button.disabled = true; $('#loginMessage').textContent = 'Memeriksa akses…';
      try { await authenticate($('#loginEmail').value.trim(), $('#loginPassword').value); $('#loginMessage').textContent = ''; showWorkspace(); await loadCoreData(); }
      catch (error) { setSession(null); $('#loginMessage').textContent = error.message; }
      finally { button.disabled = false; }
    });
    $('#logoutButton').addEventListener('click', logout); $('#seedData').addEventListener('click', seedSnapshot);
    $$('[data-admin-view-target]').forEach((button) => button.addEventListener('click', () => { if (!button.disabled) navigateAdmin(button.dataset.adminViewTarget); }));
    $('#adminSearch').addEventListener('input', renderRecordList); $('#recordWorkflowFilter').addEventListener('change', renderRecordList); $('#refreshRecords').addEventListener('click', loadCoreData);
    $('#recordForm').addEventListener('submit', saveRecord); $('#commentForm').addEventListener('submit', addComment); $('#evidenceForm').addEventListener('submit', uploadEvidence);
    $('#contextProvince').addEventListener('change', (event) => populateContext(event.target.value)); $('#contextForm').addEventListener('submit', saveContext);
    $('#importFile').addEventListener('change', (event) => handleImportFile(event.target.files[0]));
    $('#uploadDropzone').addEventListener('dragover', (event) => { event.preventDefault(); event.currentTarget.classList.add('dragging'); });
    $('#uploadDropzone').addEventListener('dragleave', (event) => event.currentTarget.classList.remove('dragging'));
    $('#uploadDropzone').addEventListener('drop', (event) => { event.preventDefault(); event.currentTarget.classList.remove('dragging'); handleImportFile(event.dataTransfer.files[0]); });
    $('#reanalyzeImport').addEventListener('click', analyzeImport); $('#commitImport').addEventListener('click', commitImport); $('#downloadTemplate').addEventListener('click', downloadTemplate);
    $$('[data-import-filter]').forEach((button) => button.addEventListener('click', () => { importState.filter = button.dataset.importFilter; $$('[data-import-filter]').forEach((node) => node.classList.toggle('active', node === button)); renderImportPreview(); }));
    $$('[data-review-filter]').forEach((button) => button.addEventListener('click', () => { reviewFilter = button.dataset.reviewFilter; $$('[data-review-filter]').forEach((node) => node.classList.toggle('active', node === button)); renderReviewQueue(); }));
    $('#refreshReview').addEventListener('click', loadCoreData); $('#refreshAudit').addEventListener('click', loadAudit);
  }

  async function init() {
    S.bindThemeButton(); bindEvents();
    if (!S.hasBackend()) { $('#configWarning').hidden = false; $('#loginForm').querySelectorAll('input,button').forEach((node) => node.disabled = true); return; }
    const candidate = getSession(); if (!candidate) return;
    try { session = await validateSession(candidate); setSession(session); showWorkspace(); await loadCoreData(); }
    catch { setSession(null); }
  }

  init();
})();
