(function () {
  'use strict';

  const S = window.SPPGShared;
  const D = window.SPPG_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const e = S.escapeHTML;
  const SESSION_KEY = 'sppg-admin-session';
  let session = null;
  let rows = [];
  let contextRows = [];
  let selectedId = null;

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(value) {
    session = value;
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  function kpi(label, value, detail) {
    return `<article class="kpi-card"><small>${e(label)}</small><div><b>${value}</b><p>${e(detail)}</p></div></article>`;
  }

  async function authenticate(email, password) {
    const payload = await S.api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    const next = { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Date.now() + payload.expires_in * 1000, user: payload.user };
    const adminRows = await S.api(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(payload.user.id)}`, { token: next.accessToken });
    if (!adminRows?.length) {
      await S.api('/auth/v1/logout', { method: 'POST', token: next.accessToken }).catch(() => {});
      throw new Error('Akun ini belum terdaftar sebagai administrator.');
    }
    setSession(next);
    return next;
  }

  async function validateSession(candidate) {
    if (!candidate?.accessToken) return null;
    const user = await S.api('/auth/v1/user', { token: candidate.accessToken });
    const adminRows = await S.api(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`, { token: candidate.accessToken });
    if (!adminRows?.length) throw new Error('Akses admin tidak tersedia.');
    candidate.user = user;
    return candidate;
  }

  async function loadRows() {
    const [remote, context] = await Promise.all([S.loadRemoteRows(session.accessToken), S.loadRemoteContext(session.accessToken).catch(() => [])]);
    rows = remote.length ? remote : (D.rows || []).map(S.normalizeRecord);
    contextRows = context;
    renderWorkspace();
  }

  function renderWorkspace() {
    const model = S.derive(rows, D.nationalProvinces);
    $('#adminKpis').innerHTML = [
      kpi('Total data', S.fmt(model.total), remoteLabel()),
      kpi('Status operasional', S.fmt(model.operational), `${model.operationsKnown}% telah diverifikasi`),
      kpi('Kapasitas tercatat', S.fmt(model.capacity), `${model.capacityKnown} dapur memiliki data`),
      kpi('Penerima manfaat', S.fmt(model.beneficiaries), `${model.beneficiariesKnown} dapur memiliki data`),
    ].join('');
    renderRecordList();
    renderContextForm();
  }

  function remoteLabel() {
    return rows.some((row) => row.lastVerifiedAt || row.statusOperasional !== 'belum_diverifikasi') ? 'database operasional' : 'snapshot awal';
  }

  function renderRecordList() {
    const q = $('#adminSearch').value.trim().toLowerCase();
    const filtered = rows.filter((row) => !q || [row.no, row.provinsi, row.kabkota, row.yayasan].some((value) => String(value).toLowerCase().includes(q)));
    $('#adminRecords').innerHTML = filtered.map((row) => `<button type="button" class="admin-record-button ${row.id === selectedId ? 'active' : ''}" data-admin-record="${e(row.id)}"><span class="admin-record-no">${row.no}</span><span><b>${e(row.kabkota)} · ${e(row.provinsi)}</b><small>${e(row.yayasan === '-' ? 'Yayasan belum dicantumkan' : row.yayasan)} · ${e(S.STATUS_LABELS[row.statusOperasional])}</small></span></button>`).join('') || '<p style="padding:16px;color:var(--muted)">Tidak ada data yang sesuai.</p>';
    document.querySelectorAll('[data-admin-record]').forEach((button) => button.addEventListener('click', () => selectRecord(button.dataset.adminRecord)));
  }

  function selectRecord(id) {
    selectedId = id;
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    renderRecordList();
    $('#emptyEditor').hidden = true;
    $('#recordForm').hidden = false;
    $('#editorNumber').textContent = `SPPG #${row.no} · ${row.provinsi}`;
    $('#editorTitle').textContent = row.kabkota;
    $('#editorAddress').textContent = `${row.alamat} · ${row.yayasan === '-' ? 'Yayasan belum dicantumkan' : row.yayasan}`;
    $('#editorFlag').textContent = S.STATUS_LABELS[row.statusOperasional];
    $('#editorFlag').className = `status-badge ${row.statusOperasional}`;
    $('#editStatus').value = row.statusOperasional;
    $('#editEstablished').value = row.tanggalBerdiri || '';
    $('#editCapacity').value = row.kapasitasPorsi ?? '';
    $('#editBeneficiaries').value = row.penerimaManfaat ?? '';
    $('#editLat').value = row.locationAccuracy === 'alamat_presisi' ? row.lat : '';
    $('#editLng').value = row.locationAccuracy === 'alamat_presisi' ? row.lng : '';
    $('#editNotes').value = row.catatanOperasional || '';
    $('#saveMessage').textContent = '';
  }

  async function saveRecord(event) {
    event.preventDefault();
    const row = rows.find((item) => item.id === selectedId);
    if (!row) return;
    const latValue = $('#editLat').value;
    const lngValue = $('#editLng').value;
    if ((latValue && !lngValue) || (!latValue && lngValue)) {
      $('#saveMessage').textContent = 'Lintang dan bujur presisi harus diisi bersama.';
      return;
    }
    const patch = {
      status_operasional: $('#editStatus').value,
      tanggal_berdiri: $('#editEstablished').value || null,
      kapasitas_porsi: $('#editCapacity').value === '' ? null : Number($('#editCapacity').value),
      penerima_manfaat: $('#editBeneficiaries').value === '' ? null : Number($('#editBeneficiaries').value),
      catatan_operasional: $('#editNotes').value.trim() || null,
      last_verified_at: new Date().toISOString(),
    };
    if (latValue && lngValue) {
      patch.lat = Number(latValue);
      patch.lng = Number(lngValue);
      patch.location_accuracy = 'alamat_presisi';
    }
    const button = $('#recordForm button[type="submit"]');
    button.disabled = true;
    $('#saveMessage').textContent = 'Menyimpan…';
    try {
      const result = await S.api(`/rest/v1/sppg_records?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', token: session.accessToken, body: patch, prefer: 'return=representation' });
      const updated = S.normalizeRecord(result?.[0] || { ...S.toDatabaseRecord(row), ...patch });
      rows = rows.map((item) => item.id === row.id ? updated : item);
      $('#saveMessage').textContent = 'Perubahan tersimpan.';
      S.toast('Data operasional berhasil diperbarui.');
      renderWorkspace();
      selectRecord(updated.id);
    } catch (error) {
      $('#saveMessage').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function seedSnapshot() {
    if (!confirm('Tambahkan seluruh snapshot lokal ke database? Data dengan ID yang sudah ada akan dipertahankan agar pembaruan operasional tidak tertimpa.')) return;
    const button = $('#seedData');
    button.disabled = true;
    button.textContent = 'Menyinkronkan…';
    try {
      const source = (D.rows || []).map(S.normalizeRecord).map(S.toDatabaseRecord);
      for (let index = 0; index < source.length; index += 75) {
        await S.api('/rest/v1/sppg_records?on_conflict=id', { method: 'POST', token: session.accessToken, body: source.slice(index, index + 75), prefer: 'resolution=ignore-duplicates,return=minimal' });
      }
      await loadRows();
      S.toast('Snapshot awal berhasil disinkronkan.');
    } catch (error) {
      S.toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Sinkronkan snapshot awal';
    }
  }

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
    $('#contextPopulation').value = item.populationTarget ?? '';
    $('#contextTarget').value = item.targetPortions ?? '';
    $('#contextSchools').value = item.schoolCount ?? '';
    $('#contextStunting').value = item.stuntingRate ?? '';
    $('#contextPoverty').value = item.povertyRate ?? '';
    $('#contextPeriod').value = item.period || '';
    $('#contextSource').value = item.sourceName || '';
    $('#contextUrl').value = item.sourceUrl || '';
    $('#contextMessage').textContent = '';
  }

  async function saveContext(event) {
    event.preventDefault();
    const value = (selector) => $(selector).value === '' ? null : Number($(selector).value);
    const payload = {
      provinsi: $('#contextProvince').value,
      population_target: value('#contextPopulation'),
      target_portions: value('#contextTarget'),
      school_count: value('#contextSchools'),
      stunting_rate: value('#contextStunting'),
      poverty_rate: value('#contextPoverty'),
      period: $('#contextPeriod').value.trim() || null,
      source_name: $('#contextSource').value.trim() || null,
      source_url: $('#contextUrl').value.trim() || null,
    };
    const button = $('#contextForm button[type="submit"]');
    button.disabled = true;
    $('#contextMessage').textContent = 'Menyimpan…';
    try {
      const result = await S.api('/rest/v1/province_context?on_conflict=provinsi', { method: 'POST', token: session.accessToken, body: payload, prefer: 'resolution=merge-duplicates,return=representation' });
      const saved = S.normalizeContext(result?.[0] || payload);
      contextRows = [...contextRows.filter((item) => item.provinsi !== saved.provinsi), saved];
      $('#contextCoverage').textContent = `${contextRows.filter((item) => item.targetPortions || item.populationTarget).length} / 38 lengkap`;
      $('#contextMessage').textContent = 'Konteks tersimpan.';
      S.toast(`Konteks ${saved.provinsi} berhasil diperbarui.`);
    } catch (error) {
      $('#contextMessage').textContent = error.message;
    } finally { button.disabled = false; }
  }

  async function logout() {
    if (session?.accessToken) await S.api('/auth/v1/logout', { method: 'POST', token: session.accessToken }).catch(() => {});
    setSession(null);
    $('#adminWorkspace').hidden = true;
    $('#adminLogin').hidden = false;
    $('#loginPassword').value = '';
  }

  function showWorkspace() {
    $('#adminLogin').hidden = true;
    $('#adminWorkspace').hidden = false;
    const identity = session.user?.email || 'Administrator';
    $('#adminIdentity').textContent = `Masuk sebagai ${identity}. Setiap perubahan dicatat dengan waktu verifikasi.`;
  }

  function bindEvents() {
    $('#loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('#loginForm button[type="submit"]');
      button.disabled = true;
      $('#loginMessage').textContent = 'Memeriksa akses…';
      try {
        await authenticate($('#loginEmail').value.trim(), $('#loginPassword').value);
        $('#loginMessage').textContent = '';
        showWorkspace();
        await loadRows();
      } catch (error) {
        setSession(null);
        $('#loginMessage').textContent = error.message;
      } finally { button.disabled = false; }
    });
    $('#logoutButton').addEventListener('click', logout);
    $('#seedData').addEventListener('click', seedSnapshot);
    $('#adminSearch').addEventListener('input', renderRecordList);
    $('#recordForm').addEventListener('submit', saveRecord);
    $('#contextProvince').addEventListener('change', (event) => populateContext(event.target.value));
    $('#contextForm').addEventListener('submit', saveContext);
  }

  async function init() {
    S.bindThemeButton();
    bindEvents();
    if (!S.hasBackend()) {
      $('#configWarning').hidden = false;
      $('#loginForm').querySelectorAll('input,button').forEach((node) => node.disabled = true);
      return;
    }
    const candidate = getSession();
    if (!candidate) return;
    try {
      session = await validateSession(candidate);
      setSession(session);
      showWorkspace();
      await loadRows();
    } catch {
      setSession(null);
    }
  }

  init();
})();
