// ─────────────────────────────────────────────
// LAGER//APP – Scanner
// ─────────────────────────────────────────────
import { app, getDBRoot } from '../js/firebase-config.js';
import { initTheme, toggleTheme } from '../js/theme.js';
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Firebase ──
const db   = getFirestore(app);
const auth = getAuth(app);

// ── Theme ──
initTheme();
// Sync icon for theme button
(function syncThemeIcon() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  btn.textContent = t === 'dark' ? '☀️' : '🌙';
})();

// ── XSS helper ──
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Nav event listeners ──
document.querySelector('.m-back')?.addEventListener('click', () => history.back());
document.getElementById('wl-nav-btn')?.addEventListener('click', () => { window.location.href = 'portal.html'; });
document.getElementById('theme-btn')?.addEventListener('click', () => {
  toggleTheme();
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  document.getElementById('theme-btn').textContent = t === 'dark' ? '☀️' : '🌙';
});

// ── State ──
let artikel  = [];
let selected = null;
let camOn    = false;
let btOn     = false;
let reader   = null;
let camSide  = 'back';
let buf      = '';
let bufTimer = null;
let lastParsed = null;

// ── Auth ──
onAuthStateChanged(auth, async user => {
  const pinOk = sessionStorage.getItem('lager-pin-auth') || localStorage.getItem('lager-pin-auth');
  if (!user && !pinOk) {
    const ret = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`login.html?tab=mitarbeiter&return=${ret}`);
    return;
  }
  const name = user?.displayName || user?.email
    || sessionStorage.getItem('lager-pin-name') || localStorage.getItem('lager-pin-name')
    || localStorage.getItem('lager-saved-name') || '';
  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.textContent = name;
  await load();
  if (localStorage.getItem('camera-auto-start') === '1') startCam();
});

// ── Artikel laden ──
async function load() {
  try {
    const snap = await getDocs(collection(db, `${getDBRoot()}/artikel`));
    artikel = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (e) {
    console.warn('[scanner] Artikel laden fehlgeschlagen:', e.code || e.message);
  }
}

// ── GS1 Parser ──
function parseGS1(raw) {
  const r = { gtin: null, lot: null, verfall: null };
  const s = raw.replace(/[\x00-\x1F\x7F]/g, '').trim();

  if (s.includes('(')) {
    const g = s.match(/\(01\)(\d{14})/);
    const l = s.match(/\(10\)([^\(]+)/i);
    const v = s.match(/\(17\)(\d{6})/);
    if (g) r.gtin = g[1];
    if (l) r.lot  = l[1].trim();
    if (v) {
      const d = v[1];
      const yy = parseInt(d.substring(0, 2)), mm = parseInt(d.substring(2, 4));
      let dd = parseInt(d.substring(4, 6));
      if (mm >= 1 && mm <= 12 && yy >= 20 && yy <= 40) {
        if (dd === 0) dd = new Date(2000 + yy, mm, 0).getDate();
        r.verfall = `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
    return r;
  }

  if (s.startsWith('01') && s.length >= 16) {
    r.gtin = s.substring(2, 16);
    const rest = s.substring(16);

    const m17 = rest.match(/17([2-3]\d)(0[1-9]|1[0-2])(\d{2})/);
    if (m17) {
      const yy = parseInt(m17[1]), mm = parseInt(m17[2]);
      let dd = parseInt(m17[3]);
      if (dd === 0) dd = new Date(2000 + yy, mm, 0).getDate();
      r.verfall = `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }

    const m10 = rest.match(/10([A-Z0-9]+?)(?:17[0-9]{6}|11[0-9]{6}|30[0-9]{1,8}|$)/i);
    if (m10) {
      r.lot = m10[1].trim();
    } else {
      const idx10 = rest.indexOf('10');
      if (idx10 >= 0) {
        const afterLot = rest.substring(idx10 + 2);
        const m17pos   = afterLot.match(/17[2-3]\d(0[1-9]|1[0-2])\d{2}/);
        r.lot = m17pos ? afterLot.substring(0, m17pos.index).trim() : afterLot.trim();
      }
    }
  }
  return r;
}

// ── HIBC Parser ──
function parseHIBC(raw) {
  const r = { gtin: null, lot: null, verfall: null };
  const parts = raw.split('/$$');
  if (parts.length < 2) return r;
  const sec = parts[1];
  const mm  = parseInt(sec.substring(0, 2));
  const yy  = 2000 + parseInt(sec.substring(2, 4));
  if (mm >= 1 && mm <= 12 && yy >= 2020 && yy <= 2040) {
    const last = new Date(yy, mm, 0).getDate();
    r.verfall = `${yy}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    const lot = sec.substring(4);
    r.lot = lot.length > 1 ? lot.slice(0, -1).trim() : lot.trim();
  }
  return r;
}

// ── Scan Result ──
function onScan(raw, source) {
  if (!raw || raw.trim().length < 6) return;
  const rawTrimmed = raw.trim();
  if (source === 'cam') {
    if (window._lastScannedCode === rawTrimmed) return;
    window._lastScannedCode = rawTrimmed;
    setTimeout(() => { if (window._lastScannedCode === rawTrimmed) window._lastScannedCode = null; }, 1000);
  }
  if (navigator.vibrate) navigator.vibrate(80);
  const parsed = raw.startsWith('+') || raw.startsWith('/') ? parseHIBC(raw) : parseGS1(raw);

  lastParsed = parsed;

  selected = null;
  document.getElementById('inp-lot').value       = '';
  document.getElementById('inp-verfall').value    = '';
  document.getElementById('inp-lot').classList.remove('filled');
  document.getElementById('inp-verfall').classList.remove('filled');
  document.getElementById('verfall-info').textContent = '';
  document.getElementById('artikel-search-wrap').classList.remove('hidden');
  document.getElementById('artikel-sel-wrap').classList.add('hidden');
  document.getElementById('chargen-wrap').classList.add('hidden');
  document.getElementById('inp-search').value    = '';
  document.getElementById('suggestions').innerHTML = '';

  let foundArtikel = null;
  if (parsed.gtin) {
    foundArtikel = artikel.find(x =>
      x.gtin === parsed.gtin ||
      (Array.isArray(x.gtins) && x.gtins.includes(parsed.gtin)) ||
      (x.chargen || []).some(c => c.gtin === parsed.gtin)
    );
    if (foundArtikel) selectArtikel(foundArtikel);
  }

  if (parsed.lot) {
    document.getElementById('inp-lot').value = parsed.lot;
    document.getElementById('inp-lot').classList.add('filled');
    document.getElementById('sheet-lot').value = parsed.lot;
    document.getElementById('sheet-lot').classList.add('filled');
  }
  if (parsed.verfall) {
    document.getElementById('inp-verfall').value = parsed.verfall;
    document.getElementById('inp-verfall').classList.add('filled');
    document.getElementById('sheet-verfall').value = parsed.verfall;
    document.getElementById('sheet-verfall').classList.add('filled');
    showVerfallInfo();
    showSheetVerfallInfo();
  }

  if (source === 'cam') {
    const resultEl = document.getElementById('sheet-result');
    const photoEl  = document.getElementById('sheet-art-photo');
    const gtinEl   = document.getElementById('sheet-gtin');
    const nameEl   = document.getElementById('sheet-artname');
    const chipEl   = document.getElementById('sheet-art-chip');
    const saveBtn  = document.getElementById('sheet-save-btn');

    resultEl.classList.add('show');
    gtinEl.textContent = parsed.gtin ? `GTIN ${parsed.gtin}` : '';

    if (foundArtikel) {
      nameEl.textContent = foundArtikel.name;
      photoEl.innerHTML  = foundArtikel.fotoUrl
        ? `<img src="${esc(foundArtikel.fotoUrl)}" alt="${esc(foundArtikel.name)}">` : '📦';
      chipEl.innerHTML   = `<span class="la-chip ok" style="height:18px;font-size:10px;"><span class="dot"></span>Bekannt</span>`;
      saveBtn.classList.remove('unknown');
      saveBtn.innerHTML  = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10l4 4 6-6"/></svg> Charge speichern`;
    } else {
      nameEl.textContent = parsed.gtin ? 'Unbekannter Artikel' : 'Code erkannt';
      photoEl.innerHTML  = '❓';
      chipEl.innerHTML   = `<span class="la-chip low" style="height:18px;font-size:10px;"><span class="dot"></span>Unbekannt</span>`;
      saveBtn.classList.add('unknown');
      saveBtn.innerHTML  = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5v10M5 10h10"/></svg> Artikel zuordnen`;
    }
  }

  toast('✅ Code erkannt');
}

// ── Artikel Suche ──
function doSearch(q) {
  const el = document.getElementById('suggestions');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }
  const hits = artikel.filter(a =>
    a.name?.toLowerCase().includes(q.toLowerCase()) ||
    a.lp?.toLowerCase().includes(q.toLowerCase()) ||
    (a.aliases || []).some(al => al.toLowerCase().includes(q.toLowerCase()))
  ).slice(0, 8);
  el.innerHTML = '';
  hits.forEach(a => {
    const d  = document.createElement('div');
    d.className = 'sug';
    const nm = document.createElement('div'); nm.className = 'sug-name'; nm.textContent = a.name;
    const lp = document.createElement('div'); lp.className = 'sug-lp';  lp.textContent = a.lp || '';
    d.appendChild(nm); d.appendChild(lp);
    d.addEventListener('click', () => selectArtikel(a));
    el.appendChild(d);
  });
}

function selectArtikel(a) {
  selected = a;
  document.getElementById('inp-search').value = '';
  document.getElementById('suggestions').innerHTML = '';
  document.getElementById('artikel-search-wrap').classList.add('hidden');
  document.getElementById('artikel-sel-wrap').classList.remove('hidden');
  document.getElementById('artikel-sel-name').textContent = a.name;
  showChargen(a);
}

function clearArtikel() {
  selected = null;
  document.getElementById('artikel-search-wrap').classList.remove('hidden');
  document.getElementById('artikel-sel-wrap').classList.add('hidden');
  document.getElementById('chargen-wrap').classList.add('hidden');
}

// ── Verfall Input Formatter ──
function formatVerfallInput(el) {
  let digits    = el.value.replace(/\D/g, '').substring(0, 8);
  let formatted = digits;
  if (digits.length > 4) formatted = digits.slice(0, 4) + '-' + digits.slice(4);
  if (digits.length > 6) formatted = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
  el.value = formatted;
}

// ── Verfall Info ──
function showVerfallInfo() {
  const val  = document.getElementById('inp-verfall').value;
  const info = document.getElementById('verfall-info');
  if (!val || val.length < 10) { info.textContent = ''; return; }
  const p    = val.split('-');
  const d    = new Date(+p[0], +p[1] - 1, +p[2]);
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const days  = Math.round((d - heute) / 86400000);
  if      (days <= 0)  info.innerHTML = '<span style="color:var(--crit)">Abgelaufen</span>';
  else if (days <= 7)  info.innerHTML = `<span style="color:var(--crit)">Kritisch – ${days} Tage</span>`;
  else if (days <= 30) info.innerHTML = `<span style="color:var(--low)">${days} Tage verbleibend</span>`;
  else                 info.innerHTML = `<span style="color:var(--ok)">OK – ${Math.round(days / 30)} Monate</span>`;
}

// ── Chargen ──
function showChargen(a) {
  const wrap = document.getElementById('chargen-wrap');
  const list = document.getElementById('chargen-list');
  const ch   = (a.chargen || []).sort((x, y) => (x.verfall || '').localeCompare(y.verfall || ''));
  if (!ch.length) { wrap.classList.add('hidden'); return; }

  list.innerHTML = '';
  ch.forEach((c, i) => {
    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    const p     = c.verfall ? c.verfall.split('-') : null;
    const days  = p ? Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - heute) / 86400000) : null;
    const col   = days === null ? 'var(--ink-4)' : days <= 7 ? 'var(--crit)' : days <= 30 ? 'var(--low)' : 'var(--ok)';
    const lbl   = days === null ? '–' : days <= 0 ? 'Abgelaufen' : days <= 30 ? days + 'd' : Math.round(days / 30) + 'M';
    const dt    = p ? new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' }) : '–';

    const row = document.createElement('div');
    row.className = 'charge';
    row.innerHTML = `
      <div class="charge-dot" style="background:${col}"></div>
      <span style="flex:1;">${esc(c.lot || '–')} · ${esc(dt)}</span>
      <span style="color:${col};font-weight:600;">${lbl}</span>`;

    const delBtn = document.createElement('button');
    delBtn.className = 'charge-del';
    delBtn.textContent = '✕';
    delBtn.dataset.artikelId = a.id;
    delBtn.dataset.chargeIdx = String(i);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
  wrap.classList.remove('hidden');
}

// Event delegation for charge-del buttons
document.getElementById('chargen-list').addEventListener('click', e => {
  const btn = e.target.closest('.charge-del');
  if (!btn) return;
  delCharge(btn.dataset.artikelId, parseInt(btn.dataset.chargeIdx, 10));
});

async function delCharge(aid, idx) {
  if (!confirm('Charge löschen?')) return;
  const a = artikel.find(x => x.id === aid);
  if (!a) return;
  const ch = [...(a.chargen || [])];
  ch.splice(idx, 1);
  await updateDoc(doc(db, `${getDBRoot()}/artikel`, aid), { chargen: ch });
  a.chargen = ch;
  if (selected?.id === aid) { selected.chargen = ch; showChargen(selected); }
}

// ── Speichern ──
async function saveCharge() {
  if (!selected) { toast('Bitte Artikel wählen', 'err'); return; }
  const lot    = document.getElementById('inp-lot').value.trim();
  const verfall = document.getElementById('inp-verfall').value;
  if (!lot && !verfall) { toast('Charge oder Datum eingeben', 'err'); return; }
  const saveBtn = document.querySelector('.s-save');
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;

  try {
    const ref  = doc(db, `${getDBRoot()}/artikel`, selected.id);
    const snap = await getDoc(ref);
    const data = snap.data() || {};
    const ch   = [...(data.chargen || [])];
    const idx  = ch.findIndex(c => c.lot && c.lot === lot);

    const updateData = { chargen: ch };
    if (lastParsed?.gtin) {
      const existingGtins = Array.isArray(data.gtins) ? [...data.gtins] : (data.gtin ? [data.gtin] : []);
      if (!existingGtins.includes(lastParsed.gtin)) existingGtins.push(lastParsed.gtin);
      updateData.gtin  = lastParsed.gtin;
      updateData.gtins = existingGtins;
    }

    if (idx >= 0) { ch[idx] = { ...ch[idx], verfall: verfall || ch[idx].verfall }; toast('Charge aktualisiert ✅'); }
    else { ch.push({ lot: lot || '?', verfall: verfall || null, gtin: lastParsed?.gtin || null, erfasst: new Date().toISOString() }); toast('Charge gespeichert ✅'); }

    await updateDoc(ref, updateData);

    const artIdx = artikel.findIndex(a => a.id === selected.id);
    if (artIdx >= 0) { artikel[artIdx] = { ...artikel[artIdx], ...updateData }; }

    resetForm();
  } catch (e) {
    toast('Fehler beim Speichern', 'err');
  } finally {
    saveBtn.disabled = false;
  }
}

function resetForm() {
  selected   = null;
  lastParsed = null;
  window._lastScannedCode = null;
  document.getElementById('inp-lot').value = '';
  document.getElementById('inp-verfall').value = '';
  document.getElementById('inp-lot').classList.remove('filled');
  document.getElementById('inp-verfall').classList.remove('filled');
  document.getElementById('verfall-info').textContent = '';
  document.getElementById('artikel-search-wrap').classList.remove('hidden');
  document.getElementById('artikel-sel-wrap').classList.add('hidden');
  document.getElementById('chargen-wrap').classList.add('hidden');
  document.getElementById('inp-search').value = '';
  document.getElementById('suggestions').innerHTML = '';
}

// ── Kamera ──
function toggleCam() { camOn ? stopCam() : startCam(); }

async function startCam() {
  camOn = true;
  document.getElementById('btn-cam').classList.add('on');
  document.getElementById('cam-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  localStorage.setItem('camera-auto-start', '1');
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.DATA_MATRIX,
    ]);
    reader = new ZXing.BrowserMultiFormatReader(hints);
    await reader.decodeFromConstraints(
      { video: { facingMode: camSide === 'back' ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
      'video',
      result => { if (result) onScan(result.getText(), 'cam'); }
    );
  } catch (e) {
    if (e.name === 'NotAllowedError') localStorage.removeItem('camera-auto-start');
    toast(e.name === 'NotAllowedError' ? 'Kamera-Zugriff verweigert' : 'Kamera: ' + e.message, 'err');
    stopCam();
  }
}

function stopCam() {
  camOn = false;
  document.getElementById('btn-cam').classList.remove('on');
  document.getElementById('cam-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  if (reader) { try { reader.reset(); } catch (e) {} reader = null; }
  const v = document.getElementById('video');
  if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
}

function flipCam() {
  camSide = camSide === 'back' ? 'front' : 'back';
  stopCam();
  setTimeout(startCam, 300);
}

// ── Sheet Verfall Info ──
function showSheetVerfallInfo() {
  const val  = document.getElementById('sheet-verfall').value;
  const info = document.getElementById('sheet-verfall-info');
  if (!val || val.length < 10) { info.textContent = ''; return; }
  const p    = val.split('-');
  const d    = new Date(+p[0], +p[1] - 1, +p[2]);
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const days  = Math.round((d - heute) / 86400000);
  if      (days <= 0)  info.innerHTML = '<span style="color:var(--crit)">Abgelaufen</span>';
  else if (days <= 7)  info.innerHTML = `<span style="color:var(--crit)">${days} Tage – Kritisch</span>`;
  else if (days <= 30) info.innerHTML = `<span style="color:var(--low)">${days} Tage</span>`;
  else                 info.innerHTML = `<span style="color:var(--ok)">OK</span>`;
}

// ── Save from Sheet ──
async function saveFromSheet() {
  const lot    = document.getElementById('sheet-lot').value.trim();
  const verfall = document.getElementById('sheet-verfall').value;
  if (!selected) { toast('Artikel nicht erkannt – bitte manuell zuordnen', 'err'); return; }
  if (!lot && !verfall) { toast('Charge oder Datum eingeben', 'err'); return; }
  const btn = document.getElementById('sheet-save-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const ref  = doc(db, `${getDBRoot()}/artikel`, selected.id);
    const snap = await getDoc(ref);
    const data = snap.data() || {};
    const ch   = [...(data.chargen || [])];
    const idx  = ch.findIndex(c => c.lot && c.lot === lot);
    const updateData = { chargen: ch };
    if (lastParsed?.gtin) {
      const existingGtins = Array.isArray(data.gtins) ? [...data.gtins] : (data.gtin ? [data.gtin] : []);
      if (!existingGtins.includes(lastParsed.gtin)) existingGtins.push(lastParsed.gtin);
      updateData.gtin = lastParsed.gtin; updateData.gtins = existingGtins;
    }
    if (idx >= 0) { ch[idx] = { ...ch[idx], verfall: verfall || ch[idx].verfall }; toast('Charge aktualisiert ✅'); }
    else { ch.push({ lot: lot || '?', verfall: verfall || null, gtin: lastParsed?.gtin || null, erfasst: new Date().toISOString() }); toast('Charge gespeichert ✅'); }
    await updateDoc(ref, updateData);
    const artIdx = artikel.findIndex(a => a.id === selected.id);
    if (artIdx >= 0) artikel[artIdx] = { ...artikel[artIdx], ...updateData };
    document.getElementById('inp-lot').value    = lot;
    document.getElementById('inp-verfall').value = verfall;
    stopCam();
    resetForm();
  } catch (e) {
    toast('Fehler beim Speichern', 'err');
  } finally { btn.disabled = false; }
}

async function toggleLight() {
  const v = document.getElementById('video');
  if (!v.srcObject) return;
  const t = v.srcObject.getVideoTracks()[0];
  if (!t) return;
  try {
    const torch = !t.getSettings().torch;
    await t.applyConstraints({ advanced: [{ torch }] });
    document.getElementById('sheet-light').classList.toggle('on', torch);
  } catch (e) { toast('Licht nicht verfügbar'); }
}

// ── Bluetooth ──
function toggleBT() {
  btOn = !btOn;
  buf = '';
  clearTimeout(bufTimer);
  document.getElementById('btn-bt').classList.toggle('bt-on', btOn);
  document.getElementById('btn-bt').querySelector('svg').style.opacity = btOn ? '1' : '0.7';
  const label = document.getElementById('btn-bt');
  label.childNodes[label.childNodes.length - 1].textContent = btOn ? ' BT Aktiv' : ' Bluetooth';
  document.getElementById('bt-hint').classList.toggle('show', btOn);
}

const USER_INPUTS = ['inp-search', 'inp-lot'];

function isUserInputFocused() {
  return USER_INPUTS.includes(document.activeElement?.id);
}

let userTyping = false;
let userTypingTimer = null;

USER_INPUTS.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('focus', () => { userTyping = true; clearTimeout(userTypingTimer); });
  el.addEventListener('blur',  () => { userTypingTimer = setTimeout(() => { userTyping = false; }, 300); });
});

document.addEventListener('keydown', e => {
  if (!btOn || userTyping) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(bufTimer);
    const code = buf.trim(); buf = '';
    if (code.length >= 4) onScan(code, 'bt');
    return;
  }
  if (e.key.length === 1) {
    e.preventDefault();
    buf += e.key;
    clearTimeout(bufTimer);
    bufTimer = setTimeout(() => {
      const code = buf.trim(); buf = '';
      if (code.length >= 4) onScan(code, 'bt');
    }, 150);
  }
});

// ── Toast ──
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  t.style.background = type === 'err' ? 'var(--crit)' : 'var(--ok)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Wire up remaining DOM event listeners ──
document.getElementById('btn-cam').addEventListener('click', toggleCam);
document.getElementById('btn-bt').addEventListener('click', toggleBT);
document.querySelector('.cam-close-btn').addEventListener('click', stopCam);
document.getElementById('sheet-flip').addEventListener('click', flipCam);
document.getElementById('sheet-light').addEventListener('click', toggleLight);
document.getElementById('sheet-save-btn').addEventListener('click', saveFromSheet);
document.getElementById('artikel-clear-btn').addEventListener('click', clearArtikel);
document.querySelector('.s-reset').addEventListener('click', resetForm);
document.querySelector('.s-save').addEventListener('click', saveCharge);
document.getElementById('inp-search').addEventListener('input', e => doSearch(e.target.value));
document.getElementById('inp-verfall').addEventListener('input', e => { formatVerfallInput(e.target); showVerfallInfo(); });
document.getElementById('sheet-verfall').addEventListener('input', e => { formatVerfallInput(e.target); showSheetVerfallInfo(); });
