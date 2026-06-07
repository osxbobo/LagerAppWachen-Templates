import { app, firebaseConfig, getDBRoot, getActiveWache, switchWache, WACHEN } from '../js/firebase-config.js';
import { initTheme, toggleTheme } from '../js/theme.js';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail }
                          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, query, orderBy, limit, onSnapshot }
                          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Theme ──
initTheme();

// ── Firebase ──
const auth = getAuth(app);
const db   = getFirestore(app);

// Cloudinary config
const CLOUDINARY_CLOUD  = 'YOUR_CLOUDINARY_CLOUD_NAME';
const CLOUDINARY_PRESET = 'YOUR_CLOUDINARY_UPLOAD_PRESET';

let alleArtikel    = [];
let alleBereiche   = [];
let alleUsers      = [];
let adminEditWache = null; // welche Wache gerade im Admin bearbeitet wird

function getAdminRoot() {
  if (!adminEditWache) adminEditWache = getActiveWache() || null;
  return `wachen/${adminEditWache}`;
}

function syncAdminWacheSelectors() {
  document.querySelectorAll('[data-action="admin-wache-switch"]').forEach(sel => {
    sel.value = adminEditWache;
  });
}

// ── Escape helper (XSS) ──
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prettyBereich(name) {
  return String(name ?? '').replace(/^Lager\s*[-–]\s*/i, '').trim();
}

// ── Toast ──
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Auth ──
onAuthStateChanged(auth, async user => {
  if (!user || user.isAnonymous) { window.location.href = 'login.html?tab=wachenleiter'; return; }
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const role     = userSnap.exists() ? userSnap.data().role : null;
  if (role !== 'admin' && role !== 'wachenleiter') { window.location.href = 'login.html?tab=wachenleiter'; return; }
  const displayName = userSnap.data()?.name || user.email;
  window._adminDisplayName = displayName;
  document.getElementById('nav-user').textContent = '';
  document.getElementById('auth-loading').classList.add('hidden');
  document.getElementById('admin-layout').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  const sidebarName = document.getElementById('sidebar-user-name');
  if (sidebarName) sidebarName.textContent = displayName;
  const sidebarAvatar = document.getElementById('sidebar-user-avatar');
  if (sidebarAvatar) sidebarAvatar.textContent = (displayName[0] || 'A').toUpperCase();

  // Benutzer-Bereich nur für Admin sichtbar
  if (role !== 'admin') {
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = 'none';
    const usersSection = document.getElementById('section-users');
    if (usersSection) {
      const addForm = usersSection.querySelector('div[style*="border-radius:12px"]');
      if (addForm) addForm.style.display = 'none';
    }
  }

  await loadAll();
});

async function doLogout() {
  await signOut(auth);
  window.location.href = 'login.html';
}

function goToMitarbeiter() {
  const name = window._adminDisplayName || document.getElementById('nav-user').textContent;
  sessionStorage.setItem('lager-pin-auth', 'true');
  sessionStorage.setItem('lager-portal-role', 'admin');
  if (name) sessionStorage.setItem('lager-pin-name', name);
  window.location.href = 'mitarbeiter.html';
}

// ── Neuen Benutzer anlegen ──
async function createNewUser() {
  const name     = document.getElementById('new-user-name').value.trim();
  const email    = document.getElementById('new-user-email').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role     = document.getElementById('new-user-role').value;
  const msg      = document.getElementById('new-user-msg');

  if (!name || !email || !password) {
    msg.style.color = 'var(--red)';
    msg.textContent = '❌ Bitte alle Felder ausfüllen.';
    return;
  }

  if (password.length < 6) {
    msg.style.color = 'var(--red)';
    msg.textContent = '❌ Passwort muss mindestens 6 Zeichen haben.';
    return;
  }

  msg.style.color = 'var(--accent2)';
  msg.textContent = '⏳ Benutzer wird angelegt...';

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    const data = await res.json();

    if (data.error) {
      const msgs = {
        'EMAIL_EXISTS':           'Diese E-Mail ist bereits registriert.',
        'INVALID_EMAIL':          'Ungültige E-Mail-Adresse.',
        'WEAK_PASSWORD':          'Passwort zu schwach (min. 6 Zeichen).',
        'OPERATION_NOT_ALLOWED':  'E-Mail/Passwort Login ist nicht aktiviert.',
      };
      throw new Error(msgs[data.error.message] || data.error.message);
    }

    const uid   = data.localId;
    const wache = document.getElementById('new-user-wache')?.value || null;

    await setDoc(doc(db, 'users', uid), {
      name, email, role, wache,
      createdAt: new Date().toISOString(),
    });

    alleUsers.push({ id: uid, name, email, role, wache });
    renderUsers();

    ['new-user-name', 'new-user-email', 'new-user-password'].forEach(id => {
      document.getElementById(id).value = '';
    });

    msg.style.color = 'var(--green)';
    msg.textContent = `✅ ${name} wurde erfolgreich angelegt!`;
    toast(`${name} angelegt!`);
    logActivity('Benutzer angelegt', name + ' · ' + (role || ''));
    setTimeout(() => msg.textContent = '', 4000);

  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = '❌ ' + e.message;
  }
}

// ── Alle Wachen Übersicht ──
window.loadAllWachenOverview = async function() {
  const el = document.getElementById('all-wachen-overview');
  if (!el) return;
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span style="font-size:0.82rem;color:var(--ink-3);">Lade alle Wachen…</span></div>';
  const wachenIds = Object.keys(WACHEN);
  try {
    const results = await Promise.all(wachenIds.map(async id => {
      const [aSnap, bSnap, bestSnap] = await Promise.all([
        getDocs(collection(db, `wachen/${id}/artikel`)),
        getDocs(collection(db, `wachen/${id}/bereiche`)),
        getDocs(query(collection(db, `wachen/${id}/bestellungen`), limit(5))),
      ]);
      const daten = bestSnap.docs.map(d => {
        const ts = d.data().datum;
        return ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      }).filter(Boolean);
      const lastDate = daten.length ? new Date(Math.max(...daten.map(d => d.getTime()))) : null;
      return { id, label: WACHEN[id]?.label ?? id, artikel: aSnap.size, bereiche: bSnap.size, lastDate };
    }));
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="padding:8px 14px;text-align:left;font-size:0.65rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--hairline);background:var(--surface-2);">Wache</th>
        <th style="padding:8px 14px;text-align:right;font-size:0.65rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--hairline);background:var(--surface-2);">Artikel</th>
        <th style="padding:8px 14px;text-align:right;font-size:0.65rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--hairline);background:var(--surface-2);">Bereiche</th>
        <th style="padding:8px 14px;text-align:right;font-size:0.65rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--hairline);background:var(--surface-2);">Letzte Bestellung</th>
      </tr></thead>
      <tbody>${results.map(r => `<tr>
        <td style="padding:10px 14px;font-size:0.82rem;font-weight:600;border-bottom:1px solid var(--hairline);">${esc(r.label)}</td>
        <td style="padding:10px 14px;font-size:0.82rem;text-align:right;font-family:var(--font-mono);border-bottom:1px solid var(--hairline);">${r.artikel}</td>
        <td style="padding:10px 14px;font-size:0.82rem;text-align:right;font-family:var(--font-mono);border-bottom:1px solid var(--hairline);">${r.bereiche}</td>
        <td style="padding:10px 14px;font-size:0.72rem;text-align:right;color:var(--ink-3);font-family:var(--font-mono);border-bottom:1px solid var(--hairline);">${r.lastDate ? r.lastDate.toLocaleDateString('de-DE') : '–'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (e) {
    el.innerHTML = `<div style="padding:14px;font-size:0.82rem;color:var(--crit);">Fehler: ${esc(e.message)}</div>`;
  }
};

// ── Load All ──
async function loadAll() {
  if (!adminEditWache) adminEditWache = getActiveWache() || null;
  syncAdminWacheSelectors();
  const [bSnap, aSnap, bestSnap, uSnap, configSnap] = await Promise.all([
    getDocs(query(collection(db, `${getAdminRoot()}/bereiche`), orderBy('reihenfolge'))),
    getDocs(collection(db, `${getAdminRoot()}/artikel`)),
    getDocs(query(collection(db, `${getAdminRoot()}/bestellungen`), orderBy('datum', 'desc'), limit(5))),
    getDocs(collection(db, 'users')),
    getDoc(doc(db, `${getAdminRoot()}/config`, 'app')),
  ]);

  alleBereiche = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  alleArtikel  = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  alleUsers    = uSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const bestellungen = bestSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  renderDashboard(bestellungen);
  renderArtikelTable(alleArtikel);
  renderBereiche();
  renderUsers();
  renderFotoSection();
  populateBereichFilter();
  populateFotoArtikelSelect();
  populateSsBereichFilter();
  loadAllWachenOverview();

  // Wachen-Dropdowns für Fotos auf aktive Wache setzen
  const fotoWacheSel = document.getElementById('foto-wache');
  if (fotoWacheSel) fotoWacheSel.value = adminEditWache;
  const ssFotoWacheSel = document.getElementById('ss-foto-wache');
  if (ssFotoWacheSel) ssFotoWacheSel.value = adminEditWache;
}

// ── Navigation ──
const moreSheetSections = ['bereiche', 'fotos', 'ss-fotos', 'backup', 'diagnose'];

function showSection(name) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.bottom-tab').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.bottom-sheet-item').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  if (name === 'ss-fotos') renderSsFotos();
  if (name === 'diagnose') startSessionMonitor();
  else stopSessionMonitor();
  const navItem = document.getElementById(`nav-${name}`);
  if (navItem) navItem.classList.add('active');
  const bottomTab = document.querySelector(`.bottom-tab[data-section="${name}"]`);
  if (bottomTab) {
    bottomTab.classList.add('active');
  } else if (moreSheetSections.includes(name)) {
    document.getElementById('bottom-more-tab').classList.add('active');
    const sheetItem = document.querySelector(`.bottom-sheet-item[data-section="${name}"]`);
    if (sheetItem) sheetItem.classList.add('active');
  }
}

function openBottomSheet() {
  document.getElementById('bottom-sheet-backdrop').classList.remove('hidden');
  document.getElementById('bottom-sheet-backdrop').classList.add('open');
  document.getElementById('bottom-sheet').classList.add('open');
}

function closeBottomSheet() {
  document.getElementById('bottom-sheet-backdrop').classList.remove('open');
  document.getElementById('bottom-sheet').classList.remove('open');
  setTimeout(() => document.getElementById('bottom-sheet-backdrop').classList.add('hidden'), 300);
}

// ── DASHBOARD ──
function renderDashboard(bestellungen) {
  document.getElementById('stat-artikel').textContent      = alleArtikel.length;
  document.getElementById('stat-bereiche').textContent     = alleBereiche.length;
  document.getElementById('stat-bestellungen').textContent = bestellungen.length;
  renderActivityLog();
  document.getElementById('stat-ohne-foto').textContent    = alleArtikel.filter(a => !a.fotoUrl).length;

  const tbody = document.getElementById('dashboard-bestellungen');
  if (bestellungen.length === 0) {
    tbody.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:0.82rem;">Noch keine Lagerchecks</div>';
    return;
  }
  tbody.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr>
      <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">Mitarbeiter</th>
      <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">Datum</th>
      <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">Nachbestell.</th>
    </tr></thead>
    <tbody>${bestellungen.map(b => {
      const d  = b.datum?.toDate ? b.datum.toDate() : new Date();
      const nb = b.nachbestellungen?.length || 0;
      return `<tr>
        <td style="padding:10px 14px;font-size:0.82rem;font-weight:600;border-bottom:1px solid var(--border);">${b.mitarbeiter || '–'}</td>
        <td style="padding:10px 14px;font-size:0.75rem;font-family:'IBM Plex Mono',monospace;color:var(--muted);border-bottom:1px solid var(--border);">${d.toLocaleDateString('de-DE')}</td>
        <td style="padding:10px 14px;font-size:0.75rem;border-bottom:1px solid var(--border);color:${nb > 0 ? 'var(--red)' : 'var(--green)'};">${nb > 0 ? `⚠️ ${nb}` : '✅ Keine'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ── ARTIKEL TABLE ──
function renderArtikelTable(data) {
  const tbody = document.getElementById('artikel-tbody');
  tbody.innerHTML = data.map(a => {
    const b = alleBereiche.find(x => x.id === a.bereich);
    return `<tr>
      <td data-label="Artikel" class="td-name">${esc(a.name)}</td>
      <td data-label="Standort" class="td-loc">${esc(a.location || '–')}<br><span style="color:var(--muted);font-size:0.62rem;">${esc(b?.name || a.bereich || '–')}</span></td>
      <td data-label="MIN / MAX" class="td-minmax">${a.min ?? '–'} ${esc(a.minEinheit || '')} / ${a.max ?? '–'} ${esc(a.maxEinheit || '')}</td>
      <td data-label="Foto">${a.fotoUrl ? '<span style="color:var(--green);font-size:0.75rem;">✅ Foto</span>' : '<span style="color:var(--muted);font-size:0.75rem;">Kein Foto</span>'}</td>
      <td data-label="Aktionen" class="td-actions">
        <button class="tbl-btn" data-action="edit-artikel" data-id="${esc(a.id)}">✏️ Edit</button>
        <button class="tbl-btn del" data-action="delete-artikel" data-id="${esc(a.id)}" data-name="${esc(a.name)}">🗑️</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--muted);">Keine Artikel gefunden</td></tr>';
}

function filterArtikel(val) {
  const q       = (val !== undefined ? val : (document.getElementById('artikel-search').value || '')).toLowerCase();
  const bereich = document.getElementById('bereich-filter').value;
  const filtered = alleArtikel.filter(a =>
    (!q || a.name?.toLowerCase().includes(q) || a.lp?.toLowerCase().includes(q)) &&
    (!bereich || a.bereich === bereich)
  );
  renderArtikelTable(filtered);
}

function populateBereichFilter() {
  const sel = document.getElementById('bereich-filter');
  alleBereiche.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id; opt.textContent = prettyBereich(b.name);
    sel.appendChild(opt);
  });
}

// ── ARTIKEL MODAL ──
function openArtikelModal(id) {
  const modal = document.getElementById('artikel-modal');
  const sel   = document.getElementById('edit-bereich');
  sel.innerHTML = '';
  alleBereiche.forEach(b => {
    const o = document.createElement('option'); o.value = b.id; o.textContent = prettyBereich(b.name);
    sel.appendChild(o);
  });

  if (id) {
    const a = alleArtikel.find(x => x.id === id);
    document.getElementById('artikel-modal-title').textContent = 'Artikel bearbeiten';
    document.getElementById('edit-id').value         = a.id;
    document.getElementById('edit-name').value       = a.name || '';
    document.getElementById('edit-lp').value         = a.lp || '';
    document.getElementById('edit-location').value   = a.location || '';
    document.getElementById('edit-bereich').value    = a.bereich || '';
    document.getElementById('edit-min').value        = a.min ?? '';
    document.getElementById('edit-minE').value       = a.minEinheit || '';
    document.getElementById('edit-max').value        = a.max ?? '';
    document.getElementById('edit-maxE').value       = a.maxEinheit || '';
    document.getElementById('edit-aliases').value    = (a.aliases || []).join(', ');
    document.getElementById('edit-hinweis').value    = a.hinweis || '';
    document.getElementById('edit-lieferant').value  = a.lieferant || '';
    document.getElementById('edit-formularfeld').value = a.formularFeld || '';
  } else {
    document.getElementById('artikel-modal-title').textContent = 'Neuer Artikel';
    ['edit-id', 'edit-name', 'edit-lp', 'edit-location', 'edit-min', 'edit-minE', 'edit-max', 'edit-maxE', 'edit-aliases', 'edit-hinweis', 'edit-formularfeld'].forEach(fid => { document.getElementById(fid).value = ''; });
    document.getElementById('edit-lieferant').value = '';
  }
  modal.classList.remove('hidden');
}

function closeArtikelModal() {
  document.getElementById('artikel-modal').classList.add('hidden');
}

async function saveArtikel() {
  const id   = document.getElementById('edit-id').value;
  const name = document.getElementById('edit-name').value.trim();
  if (!name) { toast('Name ist Pflichtfeld', 'error'); return; }

  const data = {
    name,
    lp:          document.getElementById('edit-lp').value.trim(),
    location:    document.getElementById('edit-location').value.trim(),
    bereich:     document.getElementById('edit-bereich').value,
    min:         parseFloat(document.getElementById('edit-min').value) || null,
    minEinheit:  document.getElementById('edit-minE').value.trim(),
    max:         parseFloat(document.getElementById('edit-max').value) || null,
    maxEinheit:  document.getElementById('edit-maxE').value.trim(),
    aliases:     document.getElementById('edit-aliases').value.split(',').map(s => s.trim()).filter(Boolean),
    hinweis:     document.getElementById('edit-hinweis').value.trim(),
    lieferant:   document.getElementById('edit-lieferant').value || '',
    formularFeld: document.getElementById('edit-formularfeld').value.trim(),
  };

  try {
    if (id) {
      await updateDoc(doc(db, `${getAdminRoot()}/artikel`, id), data);
      const idx = alleArtikel.findIndex(a => a.id === id);
      if (idx >= 0) alleArtikel[idx] = { ...alleArtikel[idx], ...data };
      toast('Artikel aktualisiert');
    } else {
      const ref = await addDoc(collection(db, `${getAdminRoot()}/artikel`), { ...data, fotoUrl: '', chargen: [], aktiv: true });
      alleArtikel.push({ id: ref.id, ...data, fotoUrl: '', chargen: [] });
      toast('Artikel hinzugefügt');
    }
    closeArtikelModal();
    filterArtikel();
    document.getElementById('stat-artikel').textContent = alleArtikel.length;
  } catch (e) { logError('saveArtikel', e); toast(e.message, 'error'); }
}

async function deleteArtikel(id, name) {
  if (!confirm(`„${name}" wirklich löschen?`)) return;
  try {
    await deleteDoc(doc(db, `${getAdminRoot()}/artikel`, id));
    alleArtikel = alleArtikel.filter(a => a.id !== id);
    filterArtikel();
    toast('Artikel gelöscht');
    document.getElementById('stat-artikel').textContent = alleArtikel.length;
    logActivity('Artikel gelöscht', name + ' · ' + adminEditWache);
  } catch (e) { logError('deleteArtikel', e); toast(e.message, 'error'); }
}

// ── BEREICHE ──
function renderBereiche() {
  const list = document.getElementById('bereich-list');
  list.innerHTML = alleBereiche.map(b => {
    const count = alleArtikel.filter(a => a.bereich === b.id).length;
    return `
      <div class="bereich-item">
        <div class="bereich-icon">${getBereichIcon(b.name)}</div>
        <div style="flex:1;">
          <div class="bereich-name">${esc(prettyBereich(b.name))}</div>
          <div class="bereich-count">${count} Artikel · Reihenfolge: ${b.reihenfolge}</div>
        </div>
        <button class="tbl-btn" data-action="edit-bereich" data-id="${esc(b.id)}">✏️ Edit</button>
      </div>`;
  }).join('');
}

function getBereichIcon(name) {
  const n = name.toLowerCase();
  if (n.includes('schrank')) return '🗄️';
  if (n.includes('regal'))   return '📦';
  if (n.includes('sauer'))   return '🫧';
  if (n.includes('büro'))    return '📋';
  if (n.includes('küche'))   return '🍽️';
  if (n.includes('wasch'))   return '🚿';
  if (n.includes('mpg'))     return '🔋';
  if (n.includes('medika'))  return '💊';
  return '📁';
}

function openBereichModal(id) {
  if (id) {
    const b = alleBereiche.find(x => x.id === id);
    document.getElementById('bereich-modal-title').textContent        = 'Bereich bearbeiten';
    document.getElementById('bereich-edit-id').value                  = b.id;
    document.getElementById('bereich-edit-name').value                = b.name;
    document.getElementById('bereich-edit-reihenfolge').value         = b.reihenfolge;
  } else {
    document.getElementById('bereich-modal-title').textContent        = 'Neuer Bereich';
    document.getElementById('bereich-edit-id').value                  = '';
    document.getElementById('bereich-edit-name').value                = '';
    document.getElementById('bereich-edit-reihenfolge').value         = alleBereiche.length + 1;
  }
  document.getElementById('bereich-modal').classList.remove('hidden');
}

function closeBereichModal() {
  document.getElementById('bereich-modal').classList.add('hidden');
}

async function saveBereich() {
  const id          = document.getElementById('bereich-edit-id').value;
  const name        = document.getElementById('bereich-edit-name').value.trim();
  const reihenfolge = parseInt(document.getElementById('bereich-edit-reihenfolge').value) || 99;
  if (!name) { toast('Name ist Pflichtfeld', 'error'); return; }

  try {
    if (id) {
      await updateDoc(doc(db, `${getAdminRoot()}/bereiche`, id), { name, reihenfolge });
      const idx = alleBereiche.findIndex(b => b.id === id);
      if (idx >= 0) alleBereiche[idx] = { ...alleBereiche[idx], name, reihenfolge };
      toast('Bereich aktualisiert');
    } else {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9-]/g, '');
      await setDoc(doc(db, `${getAdminRoot()}/bereiche`, slug), { name, reihenfolge, aktiv: true });
      alleBereiche.push({ id: slug, name, reihenfolge, aktiv: true });
      toast('Bereich hinzugefügt');
    }
    closeBereichModal();
    alleBereiche.sort((a, b) => a.reihenfolge - b.reihenfolge);
    renderBereiche();
    logActivity(id ? 'Bereich bearbeitet' : 'Bereich erstellt', name);
  } catch (e) { logError('saveBereich', e); toast(e.message, 'error'); }
}

// ── FOTOS ──
function populateFotoArtikelSelect() {
  const sel = document.getElementById('foto-artikel-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Artikel wählen --</option>';
  [...alleArtikel].sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.lp ? `${a.lp} – ${a.name}` : a.name;
    sel.appendChild(opt);
  });
}

function naturalSort(a, b) {
  const seg = s => s.split(/[\.\-]/).map(x => isNaN(x) ? x : parseInt(x, 10));
  const sa = seg(a), sb = seg(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i] ?? '', y = sb[i] ?? '';
    if (x < y) return -1;
    if (x > y) return  1;
  }
  return 0;
}

let fotoUploadTargetId = null;
let fotoUploadType     = 'produkt';

function populateFotoBereichFilter() {
  const sel = document.getElementById('foto-bereich');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  alleBereiche.forEach(b => {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = prettyBereich(b.name);
    sel.appendChild(o);
  });
}

function triggerFotoUpload(id, type) {
  fotoUploadTargetId = id;
  fotoUploadType     = type;
  const inp = document.getElementById('foto-file-input');
  inp.value = '';
  inp.click();
}

async function uploadFotoFromGrid() {
  const file = document.getElementById('foto-file-input').files[0];
  if (!file || !fotoUploadTargetId) return;
  toast('Foto wird hochgeladen…');
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    formData.append('folder', 'lagerapp/artikel');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload fehlgeschlagen');
    const data  = await res.json();
    const field = fotoUploadType === 'lager' ? 'lagerFotoUrl' : 'fotoUrl';
    await updateDoc(doc(db, `${getAdminRoot()}/artikel`, fotoUploadTargetId), { [field]: data.secure_url });
    const idx = alleArtikel.findIndex(a => a.id === fotoUploadTargetId);
    if (idx >= 0) alleArtikel[idx][field] = data.secure_url;
    renderFotoSection();
    toast('Foto gespeichert ✅');
  } catch (e) { logError('uploadFoto', e); toast(e.message, 'error'); }
}

async function deleteFotoFromGrid(id, type) {
  if (!confirm('Foto wirklich löschen?')) return;
  const field = type === 'lager' ? 'lagerFotoUrl' : 'fotoUrl';
  try {
    await updateDoc(doc(db, `${getAdminRoot()}/artikel`, id), { [field]: '' });
    const idx = alleArtikel.findIndex(a => a.id === id);
    if (idx >= 0) alleArtikel[idx][field] = '';
    renderFotoSection();
    toast('Foto gelöscht');
  } catch (e) { logError('deleteFoto', e); toast(e.message, 'error'); }
}

async function updateArtikelLP(id, lp) {
  try {
    await updateDoc(doc(db, `${getAdminRoot()}/artikel`, id), { lp });
    const idx = alleArtikel.findIndex(a => a.id === id);
    if (idx >= 0) alleArtikel[idx].lp = lp;
    toast('LP gespeichert');
  } catch (e) { toast(e.message, 'error'); }
}

function getLpOptions(currentLp) {
  const lps = [...new Set(alleArtikel.map(a => a.lp).filter(Boolean))].sort((a, b) => naturalSort(a, b));
  return lps.map(lp => `<option value="${esc(lp)}"${lp === currentLp ? ' selected' : ''}>${esc(lp)}</option>`).join('');
}

function renderFotoSection() {
  const grid    = document.getElementById('foto-grid');
  const search  = (document.getElementById('foto-search')?.value  || '').toLowerCase();
  const filter  = document.getElementById('foto-filter')?.value   || 'alle';
  const bereich = document.getElementById('foto-bereich')?.value  || '';
  const sort    = document.getElementById('foto-sort')?.value     || 'name';

  let items = alleArtikel.filter(a => {
    const matchSearch  = !search || (a.name || '').toLowerCase().includes(search) || (a.lp || '').toLowerCase().includes(search);
    const matchFilter  = filter === 'ohne-produkt' ? !a.fotoUrl
                       : filter === 'ohne-lager'   ? !a.lagerFotoUrl
                       : filter === 'ohne-beide'   ? !a.fotoUrl && !a.lagerFotoUrl
                       : filter === 'vollstaendig' ? !!a.fotoUrl && !!a.lagerFotoUrl
                       : true;
    const matchBereich = !bereich || a.bereich === bereich;
    return matchSearch && matchFilter && matchBereich;
  });

  if (sort === 'lp') items.sort((a, b) => naturalSort(a.lp || '', b.lp || ''));
  else               items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  document.getElementById('stat-ohne-foto').textContent    = alleArtikel.filter(a => !a.fotoUrl).length;
  document.getElementById('foto-grid-label').textContent   = `${items.length} Artikel`;
  items = items.slice(0, 60);

  grid.innerHTML = items.map(a => {
    const short = a.name.length > 24 ? a.name.substring(0, 21) + '…' : a.name;
    const slotP = a.fotoUrl
      ? `<img src="${esc(a.fotoUrl)}" style="width:100%;height:110px;object-fit:cover;display:block;" loading="lazy">`
      : `<div style="width:100%;height:110px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;"><span style="font-size:1.8rem;">📦</span><span style="font-size:0.58rem;color:var(--muted);">Kein Produktfoto</span></div>`;
    const slotL = a.lagerFotoUrl
      ? `<img src="${esc(a.lagerFotoUrl)}" style="width:100%;height:110px;object-fit:cover;display:block;" loading="lazy">`
      : `<div style="width:100%;height:110px;background:var(--surface3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;"><span style="font-size:1.8rem;">🗄️</span><span style="font-size:0.58rem;color:var(--muted);">Kein Lagerortfoto</span></div>`;
    const delP = a.fotoUrl
      ? `<button data-action="delete-foto" data-id="${esc(a.id)}" data-type="produkt" style="padding:6px 10px;background:none;border:none;color:var(--red);cursor:pointer;font-size:0.85rem;flex-shrink:0;" title="Löschen">🗑</button>`
      : '';
    const delL = a.lagerFotoUrl
      ? `<button data-action="delete-foto" data-id="${esc(a.id)}" data-type="lager" style="padding:6px 10px;background:none;border:none;color:var(--red);cursor:pointer;font-size:0.85rem;flex-shrink:0;" title="Löschen">🗑</button>`
      : '';
    return `
      <div class="foto-card">
        ${slotP}
        <div style="display:flex;align-items:center;border-top:1px solid var(--border);">
          <button class="foto-upload-btn" data-action="upload-foto" data-id="${esc(a.id)}" data-type="produkt" style="flex:1;border:none;text-align:left;">📸 Produktfoto</button>
          ${delP}
        </div>
        <div style="border-top:1px solid var(--border);">${slotL}</div>
        <div style="display:flex;align-items:center;border-top:1px solid var(--border);">
          <button class="foto-upload-btn" data-action="upload-foto" data-id="${esc(a.id)}" data-type="lager" style="flex:1;border:none;text-align:left;">🗄️ Lagerortfoto</button>
          ${delL}
        </div>
        <div class="foto-name" style="padding-bottom:4px;">
          ${esc(short)}
        </div>
        <div style="padding:0 8px 8px;">
          <select data-action="update-lp" data-id="${esc(a.id)}"
            style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:0.68rem;color:var(--accent2);font-family:'IBM Plex Mono',monospace;cursor:pointer;">
            <option value="">— kein LP —</option>
            ${getLpOptions(a.lp)}
          </select>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state">Keine Artikel gefunden</div>';
}

// ── STOCKSWIPE FOTOS ──
let ssFotoTargetId = null;

function populateSsBereichFilter() {
  const sel = document.getElementById('ss-foto-bereich');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  alleBereiche.forEach(b => {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = prettyBereich(b.name);
    sel.appendChild(o);
  });
}

function renderSsFotos() {
  const grid    = document.getElementById('ss-foto-grid');
  if (!grid) return;
  const search  = (document.getElementById('ss-foto-search')?.value || '').toLowerCase();
  const filter  = document.getElementById('ss-foto-filter')?.value  || 'alle';
  const bereich = document.getElementById('ss-foto-bereich')?.value || '';

  let items = alleArtikel.filter(a => {
    const matchSearch  = !search || (a.name || '').toLowerCase().includes(search) || (a.lp || '').toLowerCase().includes(search);
    const matchFilter  = filter === 'ohne-ss' ? !a.stockswipeFotoUrl
                       : filter === 'mit-ss'  ? !!a.stockswipeFotoUrl
                       : true;
    const matchBereich = !bereich || a.bereich === bereich;
    return matchSearch && matchFilter && matchBereich;
  });
  items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  document.getElementById('ss-foto-grid-label').textContent = `${items.length} Artikel`;

  grid.innerHTML = items.map(a => {
    const short     = a.name.length > 26 ? a.name.substring(0, 23) + '…' : a.name;
    const hasSsFoto = !!a.stockswipeFotoUrl;
    const photoSlot = hasSsFoto
      ? `<img src="${esc(a.stockswipeFotoUrl)}" style="width:100%;height:120px;object-fit:cover;display:block;" loading="lazy">`
      : (a.fotoUrl
          ? `<div style="position:relative;"><img src="${esc(a.fotoUrl)}" style="width:100%;height:120px;object-fit:cover;display:block;filter:grayscale(0.4);opacity:0.7;" loading="lazy"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);font-size:0.6rem;color:white;font-family:'IBM Plex Mono',monospace;letter-spacing:0.05em;">STANDARD FOTO</div></div>`
          : `<div style="width:100%;height:120px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;"><span style="font-size:2rem;">📦</span><span style="font-size:0.62rem;color:var(--muted);">Kein Foto</span></div>`
        );
    return `
      <div class="foto-card">
        ${photoSlot}
        <div class="foto-name">
          ${a.lp ? `<div style="font-size:0.6rem;color:var(--accent2);margin-bottom:2px;font-family:'IBM Plex Mono',monospace;">${esc(a.lp)}</div>` : ''}
          ${esc(short)}
          ${hasSsFoto ? '<div style="font-size:0.58rem;color:var(--green);margin-top:2px;">✓ StockSwipe-Foto</div>' : ''}
        </div>
        <button class="foto-upload-btn" data-action="upload-ss-foto" data-id="${esc(a.id)}">
          🃏 StockSwipe-Foto ${hasSsFoto ? 'ändern' : 'hochladen'}
        </button>
      </div>`;
  }).join('') || '<div class="empty-state">Keine Artikel gefunden</div>';
}

function triggerSsFotoUpload(id) {
  ssFotoTargetId = id;
  const inp = document.getElementById('ss-foto-file-input');
  inp.value = '';
  inp.click();
}

async function uploadSsFoto() {
  const file = document.getElementById('ss-foto-file-input').files[0];
  if (!file || !ssFotoTargetId) return;
  toast('StockSwipe-Foto wird hochgeladen…');
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    formData.append('folder', 'lagerapp/stockswipe');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload fehlgeschlagen');
    const data = await res.json();
    await updateDoc(doc(db, `${getAdminRoot()}/artikel`, ssFotoTargetId), { stockswipeFotoUrl: data.secure_url });
    const idx = alleArtikel.findIndex(a => a.id === ssFotoTargetId);
    if (idx >= 0) alleArtikel[idx].stockswipeFotoUrl = data.secure_url;
    renderSsFotos();
    toast('StockSwipe-Foto gespeichert ✅');
  } catch (e) { toast(e.message, 'error'); }
}

// ── USERS ──
let _userAvatarTargetId = null;

function renderUsers() {
  const list = document.getElementById('user-list');
  const roleLabels = { admin: 'ADMIN', wachenleiter: 'WACHENLEITER' };
  const roleColors = { admin: 'badge-orange', wachenleiter: 'badge-blue' };
  const wachenOpts = `<option value="">— keine —</option>${Object.entries(WACHEN).map(([id, w]) => `<option value="${id}"${w ? '' : ''}>${esc(w.label)}</option>`).join('')}`;

  list.innerHTML = alleUsers.map(u => {
    const avatarHtml = u.avatarUrl
      ? `<img src="${esc(u.avatarUrl)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
      : `<div class="user-avatar" style="cursor:pointer;" data-action="upload-user-avatar" data-uid="${esc(u.id)}">${u.role === 'admin' ? '👑' : '🧑‍💼'}</div>`;
    const wachenSel = wachenOpts.replace(`value="${u.wache || ''}"`, `value="${u.wache || ''}" selected`);
    return `
    <div class="user-item" style="flex-wrap:wrap;gap:8px;align-items:center;">
      <div style="cursor:pointer;flex-shrink:0;" data-action="upload-user-avatar" data-uid="${esc(u.id)}">${avatarHtml}</div>
      <div class="user-info" style="flex:1;min-width:140px;">
        <div class="user-email">${esc(u.email)}</div>
        <div class="user-name">${esc(u.name || '')}</div>
      </div>
      <select class="form-input" style="max-width:140px;font-size:0.78rem;" data-action="change-role" data-uid="${esc(u.id)}">
        <option value="wachenleiter" ${u.role === 'wachenleiter' ? 'selected' : ''}>Wachenleiter</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select>
      <select class="form-input" style="max-width:140px;font-size:0.78rem;" data-action="change-user-wache" data-uid="${esc(u.id)}">
        ${wachenSel}
      </select>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="tbl-btn" data-action="reset-user-pw" data-uid="${esc(u.id)}" data-email="${esc(u.email)}" title="Passwort-Reset E-Mail senden">🔑</button>
        <button class="tbl-btn del" data-action="delete-user" data-uid="${esc(u.id)}" data-name="${esc(u.name || u.email)}" title="Benutzer löschen">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<div style="padding:20px;text-align:center;color:var(--muted);">Keine Accounts gefunden</div>';
}

async function changeRole(uid, role) {
  try {
    await updateDoc(doc(db, 'users', uid), { role });
    const idx = alleUsers.findIndex(u => u.id === uid);
    if (idx >= 0) alleUsers[idx].role = role;
    toast('Rolle geändert');
    renderUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function changeUserWache(uid, wache) {
  try {
    await updateDoc(doc(db, 'users', uid), { wache: wache || null });
    const idx = alleUsers.findIndex(u => u.id === uid);
    if (idx >= 0) alleUsers[idx].wache = wache || null;
    toast('Wache gespeichert');
  } catch (e) { logError('changeUserWache', e); toast(e.message, 'error'); }
}

async function resetUserPassword(uid, email) {
  if (!confirm(`Passwort-Reset E-Mail an ${email} senden?`)) return;
  try {
    await sendPasswordResetEmail(auth, email);
    toast(`Reset-E-Mail an ${email} gesendet`);
  } catch (e) { logError('resetUserPassword', e); toast(e.message, 'error'); }
}

async function deleteUser(uid, name) {
  if (!confirm(`„${name}" wirklich löschen? Der Zugang wird sofort gesperrt.`)) return;
  try {
    await deleteDoc(doc(db, 'users', uid));
    alleUsers = alleUsers.filter(u => u.id !== uid);
    renderUsers();
    toast(`${name} gelöscht`);
  } catch (e) { logError('deleteUser', e); toast(e.message, 'error'); }
}

function triggerUserAvatarUpload(uid) {
  _userAvatarTargetId = uid;
  const inp = document.getElementById('user-avatar-file-input');
  if (inp) { inp.value = ''; inp.click(); }
}

async function uploadUserAvatar() {
  const file = document.getElementById('user-avatar-file-input')?.files[0];
  if (!file || !_userAvatarTargetId) return;
  toast('Foto wird hochgeladen…');
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    fd.append('folder', 'lagerapp/avatars');
    const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload fehlgeschlagen');
    const data = await res.json();
    await updateDoc(doc(db, 'users', _userAvatarTargetId), { avatarUrl: data.secure_url });
    const idx = alleUsers.findIndex(u => u.id === _userAvatarTargetId);
    if (idx >= 0) alleUsers[idx].avatarUrl = data.secure_url;
    renderUsers();
    toast('Foto gespeichert ✅');
  } catch (e) { logError('uploadUserAvatar', e); toast(e.message, 'error'); }
}

// ── BACKUP ──
async function exportWacheData(root) {
  const [aSnap, bSnap, cSnap, bestSnap] = await Promise.all([
    getDocs(collection(db, `${root}/artikel`)),
    getDocs(query(collection(db, `${root}/bereiche`), orderBy('reihenfolge'))),
    getDoc(doc(db, `${root}/config`, 'app')),
    getDocs(query(collection(db, `${root}/bestellungen`), orderBy('datum', 'desc'))),
  ]);
  return {
    artikel:      aSnap.docs.map(d => ({ _id: d.id, ...d.data() })),
    bereiche:     bSnap.docs.map(d => ({ _id: d.id, ...d.data() })),
    config:       cSnap.exists() ? cSnap.data() : null,
    bestellungen: bestSnap.docs.map(d => ({
      _id: d.id, ...d.data(),
      datum: d.data().datum?.toDate?.().toISOString() || d.data().datum,
    })),
  };
}

async function exportDB(typ, wacheId) {
  toast('Export wird erstellt...');
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    let exportObj = { exportiert: new Date().toISOString(), typ, version: '1.0' };
    let filename  = '';

    if (typ === 'komplett' || typ === 'artikel') {
      const aSnap = await getDocs(collection(db, `${getAdminRoot()}/artikel`));
      exportObj.artikel = aSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
      document.getElementById('export-artikel-count').textContent = exportObj.artikel.length;
    }
    if (typ === 'komplett') {
      const bSnap = await getDocs(query(collection(db, `${getAdminRoot()}/bereiche`), orderBy('reihenfolge')));
      exportObj.bereiche = bSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
      document.getElementById('export-bereiche-count').textContent = exportObj.bereiche.length;
      const cSnap = await getDoc(doc(db, `${getAdminRoot()}/config`, 'app'));
      if (cSnap.exists()) exportObj.config = cSnap.data();
      const bestSnap = await getDocs(query(collection(db, `${getAdminRoot()}/bestellungen`), orderBy('datum', 'desc')));
      exportObj.bestellungen = bestSnap.docs.map(d => ({
        _id: d.id, ...d.data(),
        datum: d.data().datum?.toDate?.().toISOString() || d.data().datum,
      }));
      document.getElementById('export-bestellungen-count').textContent = exportObj.bestellungen.length;
      filename = `lagerapp_backup_${timestamp}.json`;
    } else if (typ === 'artikel') {
      filename = `lagerapp_artikel_${timestamp}.json`;
    } else if (typ === 'chargen') {
      const aSnap = await getDocs(collection(db, `${getAdminRoot()}/artikel`));
      exportObj.artikel = aSnap.docs.map(d => ({ _id: d.id, ...d.data() }))
        .filter(a => a.chargen && a.chargen.length > 0)
        .map(a => ({ _id: a._id, name: a.name, gtin: a.gtin, gtins: a.gtins, chargen: a.chargen }));
      filename = `lagerapp_chargen_${timestamp}.json`;
    } else if (typ === 'mitarbeiter') {
      const mSnap = await getDocs(collection(db, 'mitarbeiter'));
      exportObj.mitarbeiter = mSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
      document.getElementById('export-mitarbeiter-count').textContent = exportObj.mitarbeiter.length;
      filename = `lagerapp_mitarbeiter_${timestamp}.json`;
    } else if (typ === 'wache' && wacheId) {
      const data = await exportWacheData(`wachen/${wacheId}`);
      exportObj = { ...exportObj, wache: wacheId, ...data };
      filename = `lagerapp_${wacheId}_${timestamp}.json`;
    }

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);

    const hist = JSON.parse(localStorage.getItem('lagerapp-backups') || '[]');
    hist.unshift({ datum: new Date().toISOString(), filename });
    localStorage.setItem('lagerapp-backups', JSON.stringify(hist.slice(0, 5)));
    renderBackupHistory();
    toast('✅ ' + filename);
  } catch (e) { toast(e.message, 'error'); }
}

function sanitizeLP(lp) {
  return (lp || 'unbekannt').replace(/\./g, '-').replace(/\//g, '_').replace(/\s+/g, '_');
}

function extFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
    return m ? m[1].toLowerCase() : 'jpg';
  } catch { return 'jpg'; }
}

async function exportBilder() {
  if (typeof JSZip === 'undefined') { toast('JSZip nicht geladen', 'error'); return; }
  const logEl   = document.getElementById('bilder-export-log');
  const progEl  = document.getElementById('bilder-export-progress-fill');
  const textEl  = document.getElementById('bilder-export-progress-text');
  const progBox = document.getElementById('bilder-export-progress');
  progBox.classList.remove('hidden');
  logEl.innerHTML = '';

  function log(msg, color = 'var(--text2)') {
    const d = document.createElement('div');
    d.style.color = color; d.textContent = msg;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  }
  function setProgress(pct) {
    progEl.style.width = pct + '%';
    textEl.textContent = Math.round(pct) + '%';
  }

  try {
    log('📦 Lade Artikel aus Firestore...');
    const snap   = await getDocs(collection(db, `${getAdminRoot()}/artikel`));
    const artikel = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    const withFoto  = artikel.filter(a => a.fotoUrl);
    const withLager = artikel.filter(a => a.lagerFotoUrl);
    document.getElementById('bilder-export-produkt-count').textContent = withFoto.length;
    document.getElementById('bilder-export-lager-count').textContent   = withLager.length;

    const totalImages = withFoto.length + withLager.length;
    if (totalImages === 0) { toast('Keine Bilder vorhanden', 'error'); return; }

    log(`🖼️ ${totalImages} Bilder werden heruntergeladen...`);
    const zip      = new JSZip();
    const manifest = [];
    let done = 0;

    for (const a of artikel) {
      const lpSafe = sanitizeLP(a.lp);

      for (const typ of ['produkt', 'lager']) {
        const url = typ === 'produkt' ? a.fotoUrl : a.lagerFotoUrl;
        if (!url) continue;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob     = await resp.blob();
          const ext      = extFromUrl(url);
          const filename = `${lpSafe}_${typ}.${ext}`;
          zip.file(filename, blob);
          manifest.push({ filename, lp: a.lp, artikelId: a._id, name: a.name, typ });
          done++;
          setProgress(done / totalImages * 95);
          log(`   ✅ ${filename}`, 'var(--green)');
        } catch (e) {
          log(`   ⚠️ ${a.name} (${typ}): ${e.message}`, 'var(--yellow)');
          done++;
          setProgress(done / totalImages * 95);
        }
      }
    }

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    log('🗜️ ZIP wird erstellt...');
    const blob      = await zip.generateAsync({ type: 'blob' }, meta => setProgress(95 + meta.percent * 0.05));
    const timestamp = new Date().toISOString().split('T')[0];
    const filename  = `lagerapp_bilder_${timestamp}.zip`;
    const url       = URL.createObjectURL(blob);
    const a         = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    setProgress(100);
    log(`🎉 ${filename} (${manifest.length} Bilder)`, 'var(--green)');
    toast('✅ ' + filename);
  } catch (e) { log('❌ ' + e.message, 'var(--red)'); toast(e.message, 'error'); }
}

function renderBackupHistory() {
  const el = document.getElementById('backup-history');
  if (!el) return;
  const hist = JSON.parse(localStorage.getItem('lagerapp-backups') || '[]');
  if (hist.length === 0) { el.textContent = 'Noch keine Backups erstellt'; return; }
  el.innerHTML = hist.map(h => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
      <span style="font-family:'IBM Plex Mono',monospace;font-size:0.72rem;">${esc(h.filename)}</span>
      <span style="color:var(--muted);">${new Date(h.datum).toLocaleDateString('de-DE')}</span>
    </div>`).join('');
}

function loadImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      window._importData = JSON.parse(e.target.result);
      const infos = [];
      if (window._importData.artikel)      infos.push(`📦 ${window._importData.artikel.length} Artikel`);
      if (window._importData.bereiche)     infos.push(`🏠 ${window._importData.bereiche.length} Bereiche`);
      if (window._importData.bestellungen) infos.push(`📋 ${window._importData.bestellungen.length} Bestellungen`);
      if (window._importData.config)       infos.push(`⚙️ Config`);
      document.getElementById('import-preview').classList.remove('hidden');
      document.getElementById('import-preview-content').innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          ${infos.map(i => `<span class="badge badge-blue">${esc(i)}</span>`).join('')}
        </div>
        <div style="font-size:0.72rem;color:var(--muted);">
          Exportiert: ${window._importData.exportiert ? new Date(window._importData.exportiert).toLocaleString('de-DE') : 'Unbekannt'}
        </div>`;
      const btn = document.getElementById('btn-import-start');
      btn.disabled = false; btn.style.opacity = '1';
      document.getElementById('drop-zone').style.borderColor = 'var(--green)';
    } catch (e) { toast('Ungültige Datei: ' + e.message, 'error'); }
  };
  reader.readAsText(file);
}

async function startImport() {
  const importData = window._importData;
  if (!importData) return;
  const mode   = document.querySelector('input[name="import-mode"]:checked').value;
  const logEl  = document.getElementById('import-log');
  const progEl = document.getElementById('import-progress-fill');
  const textEl = document.getElementById('import-progress-text');
  document.getElementById('import-progress').classList.remove('hidden');
  document.getElementById('btn-import-start').disabled = true;
  logEl.innerHTML = '';

  function log(msg, color = 'var(--text2)') {
    const d = document.createElement('div');
    d.style.color = color; d.textContent = msg;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  }
  function setProgress(pct) {
    progEl.style.width = pct + '%';
    textEl.textContent = Math.round(pct) + '%';
  }

  try {
    if (mode === 'replace') {
      log('🗑️ Lösche bestehende Daten...');
      if (importData.artikel) {
        const aSnap = await getDocs(collection(db, `${getAdminRoot()}/artikel`));
        if (aSnap.size > 0) {
          const b = writeBatch(db);
          aSnap.docs.forEach(d => b.delete(d.ref));
          await b.commit();
        }
        log(`   ✅ ${aSnap.size} Artikel gelöscht`, 'var(--yellow)');
      }
      if (importData.bereiche) {
        const bSnap = await getDocs(collection(db, `${getAdminRoot()}/bereiche`));
        if (bSnap.size > 0) {
          const b = writeBatch(db);
          bSnap.docs.forEach(d => b.delete(d.ref));
          await b.commit();
        }
        log(`   ✅ ${bSnap.size} Bereiche gelöscht`, 'var(--yellow)');
      }
    }

    const total = (importData.artikel?.length || 0) + (importData.bereiche?.length || 0);
    let done = 0;

    if (importData.artikel?.length > 0) {
      log('📦 Importiere Artikel...');
      for (let i = 0; i < importData.artikel.length; i += 400) {
        const b     = writeBatch(db);
        const chunk = importData.artikel.slice(i, i + 400);
        for (const a of chunk) {
          const { _id, ...data } = a;
          const r = _id ? doc(db, `${getAdminRoot()}/artikel`, _id) : doc(collection(db, `${getAdminRoot()}/artikel`));
          b.set(r, data, { merge: mode === 'merge' });
          done++; setProgress(total > 0 ? done / total * 100 : 50);
        }
        await b.commit();
        log(`   ✅ ${Math.min(i + 400, importData.artikel.length)} / ${importData.artikel.length}`, 'var(--green)');
      }
    }

    if (importData.bereiche?.length > 0) {
      log('🏠 Importiere Bereiche...');
      for (const be of importData.bereiche) {
        const { _id, ...data } = be;
        const r = _id ? doc(db, `${getAdminRoot()}/bereiche`, _id) : doc(collection(db, `${getAdminRoot()}/bereiche`));
        await setDoc(r, data, { merge: mode === 'merge' });
        done++; setProgress(total > 0 ? done / total * 100 : 75);
      }
      log(`   ✅ ${importData.bereiche.length} Bereiche`, 'var(--green)');
    }

    if (importData.config) {
      await setDoc(doc(db, `${getAdminRoot()}/config`, 'app'), importData.config, { merge: true });
      log('   ✅ Config importiert', 'var(--green)');
    }

    if (importData.bestellungen?.length > 0) {
      log('📋 Importiere Bestellungen...');
      for (let i = 0; i < importData.bestellungen.length; i += 400) {
        const b     = writeBatch(db);
        const chunk = importData.bestellungen.slice(i, i + 400);
        for (const best of chunk) {
          const { _id, datum, ...data } = best;
          // Datum-String zurück in Timestamp umwandeln falls vorhanden
          const datumVal = datum ? new Date(datum) : new Date();
          const r = _id ? doc(db, `${getAdminRoot()}/bestellungen`, _id) : doc(collection(db, `${getAdminRoot()}/bestellungen`));
          b.set(r, { ...data, datum: datumVal }, { merge: mode === 'merge' });
        }
        await b.commit();
        log(`   ✅ ${Math.min(i + 400, importData.bestellungen.length)} / ${importData.bestellungen.length}`, 'var(--green)');
      }
    }

    setProgress(100);
    log('🎉 Import abgeschlossen!', 'var(--green)');
    toast('Import abgeschlossen ✅');
    await loadAll();

  } catch (e) {
    log('❌ ' + e.message, 'var(--red)');
    toast(e.message, 'error');
    document.getElementById('btn-import-start').disabled = false;
  }
}

async function loadBilderImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (typeof JSZip === 'undefined') { toast('JSZip nicht geladen', 'error'); return; }
  try {
    const zip          = await JSZip.loadAsync(file);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) { toast('Ungültiges ZIP: manifest.json fehlt', 'error'); return; }
    const manifest     = JSON.parse(await manifestFile.async('string'));
    const produktCount = manifest.filter(e => e.typ === 'produkt').length;
    const lagerCount   = manifest.filter(e => e.typ === 'lager').length;
    window._bilderImportData = { manifest, zip };
    document.getElementById('bilder-import-preview').classList.remove('hidden');
    document.getElementById('bilder-import-preview-content').innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <span class="badge badge-blue">📦 ${produktCount} Produktfotos</span>
        <span class="badge badge-blue">🗄️ ${lagerCount} Lagerfotos</span>
      </div>
      <div style="font-size:0.72rem;color:var(--muted);">${manifest.length} Bilder in ${esc(file.name)}</div>`;
    const btn = document.getElementById('btn-bilder-import-start');
    btn.disabled = false; btn.style.opacity = '1';
    document.getElementById('bilder-drop-zone').style.borderColor = 'var(--green)';
  } catch (e) { toast('Ungültige Datei: ' + e.message, 'error'); }
}

async function startBilderImport() {
  const data = window._bilderImportData;
  if (!data) return;
  const { manifest, zip } = data;
  const logEl  = document.getElementById('bilder-import-log');
  const progEl = document.getElementById('bilder-import-progress-fill');
  const textEl = document.getElementById('bilder-import-progress-text');
  document.getElementById('bilder-import-progress').classList.remove('hidden');
  document.getElementById('btn-bilder-import-start').disabled = true;
  logEl.innerHTML = '';

  function log(msg, color = 'var(--text2)') {
    const d = document.createElement('div');
    d.style.color = color; d.textContent = msg;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  }
  function setProgress(pct) {
    progEl.style.width = pct + '%';
    textEl.textContent = Math.round(pct) + '%';
  }

  try {
    log('📋 Lade Artikel aus Firestore...');
    const snap  = await getDocs(collection(db, `${getAdminRoot()}/artikel`));
    const lpMap = {};
    snap.docs.forEach(d => { if (d.data().lp) lpMap[d.data().lp] = d.id; });

    const total = manifest.length;
    let done = 0, ok = 0, skipped = 0;

    for (const entry of manifest) {
      const { filename, lp, artikelId, name, typ } = entry;
      const docId = lpMap[lp] || artikelId;
      if (!docId) {
        log(`   ⚠️ Kein Artikel für LP "${lp}" gefunden – übersprungen`, 'var(--yellow)');
        skipped++; done++; setProgress(done / total * 100); continue;
      }

      const zipEntry = zip.file(filename);
      if (!zipEntry) {
        log(`   ⚠️ Datei "${filename}" nicht im ZIP – übersprungen`, 'var(--yellow)');
        skipped++; done++; setProgress(done / total * 100); continue;
      }

      try {
        const blob = await zipEntry.async('blob');
        const fd   = new FormData();
        fd.append('file', blob, filename);
        fd.append('upload_preset', 'YOUR_CLOUDINARY_UPLOAD_PRESET');
        fd.append('folder', 'lagerapp/artikel');
        const res    = await fetch('https://api.cloudinary.com/v1_1/YOUR_CLOUDINARY_CLOUD_NAME/image/upload', { method: 'POST', body: fd });
        const result = await res.json();
        if (!result.secure_url) throw new Error(result.error?.message || 'Upload fehlgeschlagen');

        const field = typ === 'produkt' ? 'fotoUrl' : 'lagerFotoUrl';
        await updateDoc(doc(db, `${getAdminRoot()}/artikel`, docId), { [field]: result.secure_url });
        log(`   ✅ ${name} → ${typ}`, 'var(--green)');
        ok++;
      } catch (e) {
        log(`   ❌ ${name} (${typ}): ${e.message}`, 'var(--red)');
        skipped++;
      }
      done++; setProgress(done / total * 100);
    }

    setProgress(100);
    log(`🎉 Fertig: ${ok} importiert, ${skipped} übersprungen`, 'var(--green)');
    toast(`✅ ${ok} Bilder importiert`);
    await loadAll();
  } catch (e) {
    log('❌ ' + e.message, 'var(--red)');
    toast(e.message, 'error');
    document.getElementById('btn-bilder-import-start').disabled = false;
  }
}

// ── AKTIVITÄTS-LOG ──

function logActivity(action, detail = '') {
  try {
    const user = window._adminDisplayName || document.getElementById('nav-user')?.textContent || 'Admin';
    const log  = JSON.parse(localStorage.getItem('lagerapp-activity-log') || '[]');
    log.unshift({ ts: new Date().toISOString(), user, action, detail });
    localStorage.setItem('lagerapp-activity-log', JSON.stringify(log.slice(0, 100)));
    renderActivityLog();
  } catch (_) {}
}

function renderActivityLog() {
  const el = document.getElementById('admin-activity-log');
  if (!el) return;
  const log = JSON.parse(localStorage.getItem('lagerapp-activity-log') || '[]');
  if (log.length === 0) {
    el.innerHTML = '<div style="padding:12px 16px;font-size:0.82rem;color:var(--ink-3);">Noch keine Aktivitäten</div>';
    return;
  }
  const icons = { delete: '🗑️', create: '➕', update: '✏️', reset: '🔄', login: '🔑', error: '❌', export: '📤', import: '📥' };
  el.innerHTML = log.slice(0, 20).map(e => {
    const dt = new Date(e.ts).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const type = Object.keys(icons).find(k => e.action.toLowerCase().includes(k)) || 'update';
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:1px solid var(--hairline);">
      <span style="font-size:1rem;flex-shrink:0;margin-top:1px;">${icons[type]}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;font-weight:600;">${esc(e.action)}</div>
        ${e.detail ? `<div style="font-size:0.72rem;color:var(--ink-3);margin-top:1px;">${esc(e.detail)}</div>` : ''}
      </div>
      <div style="font-size:0.65rem;color:var(--ink-3);font-family:var(--font-mono);white-space:nowrap;flex-shrink:0;">${dt}</div>
    </div>`;
  }).join('');
}

// ── DIAGNOSE ──

function logError(context, err) {
  try {
    const log = JSON.parse(localStorage.getItem('lagerapp-error-log') || '[]');
    log.unshift({ ts: new Date().toISOString(), context, message: err?.message || String(err) });
    localStorage.setItem('lagerapp-error-log', JSON.stringify(log.slice(0, 50)));
    renderErrorLog();
    logActivity('Fehler: ' + context, err?.message || String(err));
  } catch (_) {}
}

function renderErrorLog() {
  const el = document.getElementById('diagnose-error-log');
  if (!el) return;
  const log = JSON.parse(localStorage.getItem('lagerapp-error-log') || '[]');
  const badge = document.getElementById('diagnose-error-badge');
  if (badge) badge.textContent = log.length > 0 ? log.length : '';
  if (log.length === 0) {
    el.innerHTML = '<div style="color:var(--ok);font-size:0.82rem;">✅ Keine Fehler</div>';
    return;
  }
  el.innerHTML = log.map(e => `
    <div style="padding:8px 0;border-bottom:1px solid var(--hairline);font-size:0.75rem;">
      <span style="font-family:'IBM Plex Mono',monospace;color:var(--muted);font-size:0.68rem;">${new Date(e.ts).toLocaleString('de-DE')}</span>
      <span style="margin-left:8px;background:var(--surface-2);padding:1px 6px;border-radius:4px;font-size:0.68rem;">${esc(e.context)}</span>
      <div style="color:var(--red);margin-top:2px;">${esc(e.message)}</div>
    </div>`).join('');
}

async function runHealthCheck() {
  const el = document.getElementById('health-result');
  el.innerHTML = '<div class="spinner" style="margin:12px auto;width:20px;height:20px;"></div>';

  const safeCount = async path => {
    try { return (await getDocs(collection(db, path))).size; }
    catch { return '–'; }
  };

  const ids  = Object.keys(WACHEN);
  const cols = ['artikel', 'bereiche', 'bestellungen'];

  const [mCount, ...wachenResults] = await Promise.all([
    safeCount('mitarbeiter'),
    ...ids.map(id => Promise.all(cols.map(col => safeCount(`wachen/${id}/${col}`))))
  ]);

  const headerCols = [...cols, 'mitarbeiter'];
  let html = `<table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
    <thead><tr>
      <th style="text-align:left;padding:6px 10px;background:var(--surface-2);font-family:'IBM Plex Mono',monospace;font-size:0.65rem;text-transform:uppercase;color:var(--ink-3);">Wache</th>
      ${headerCols.map(c => `<th style="text-align:center;padding:6px 10px;background:var(--surface-2);font-family:'IBM Plex Mono',monospace;font-size:0.65rem;text-transform:uppercase;color:var(--ink-3);">${esc(c)}</th>`).join('')}
    </tr></thead><tbody>`;

  ids.forEach((id, i) => {
    const counts = [...wachenResults[i], i === 0 ? mCount : '–'];
    html += `<tr>${[`<td style="padding:6px 10px;font-weight:600;border-bottom:1px solid var(--hairline);">${esc(WACHEN[id].label)}</td>`,
      ...counts.map(c => `<td style="text-align:center;padding:6px 10px;border-bottom:1px solid var(--hairline);${c === 0 ? 'color:var(--brand);font-weight:700;' : ''}">${c}</td>`)
    ].join('')}</tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

async function runKonsistenzCheck() {
  const el = document.getElementById('konsistenz-result');
  el.innerHTML = '<div class="spinner" style="margin:12px auto;width:20px;height:20px;"></div>';
  try {
    const [aSnap, bSnap] = await Promise.all([
      getDocs(collection(db, `${getAdminRoot()}/artikel`)),
      getDocs(collection(db, `${getAdminRoot()}/bereiche`)),
    ]);
    const artikel    = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bereichIds = new Set(bSnap.docs.map(d => d.id));
    const heute      = new Date();
    const problems   = [];

    const ohneBereich   = artikel.filter(a => !a.bereich);
    const falscherBereich = artikel.filter(a => a.bereich && !bereichIds.has(a.bereich));
    const ohneLp        = artikel.filter(a => !a.lp);
    const lpMap = {};
    artikel.forEach(a => { if (a.lp) { lpMap[a.lp] = lpMap[a.lp] || []; lpMap[a.lp].push(a.name); } });
    const doppelteLp    = Object.entries(lpMap).filter(([, v]) => v.length > 1);
    const abgelaufenChargen = artikel.flatMap(a =>
      (a.chargen || []).filter(c => c.verfall && new Date(c.verfall) < heute)
        .map(c => ({ name: a.name, lot: c.lot, verfall: c.verfall }))
    );

    if (ohneBereich.length)      problems.push({ label: `Artikel ohne Bereich`, count: ohneBereich.length, items: ohneBereich.map(a => a.name) });
    if (falscherBereich.length)  problems.push({ label: `Ungültige Bereich-Referenz`, count: falscherBereich.length, items: falscherBereich.map(a => a.name) });
    if (ohneLp.length)           problems.push({ label: `Artikel ohne LP`, count: ohneLp.length, items: ohneLp.map(a => a.name) });
    if (doppelteLp.length)       problems.push({ label: `Doppelte LP-Nummern`, count: doppelteLp.length, items: doppelteLp.map(([lp, names]) => `${lp}: ${names.join(', ')}`) });
    if (abgelaufenChargen.length) problems.push({ label: `Abgelaufene Chargen`, count: abgelaufenChargen.length, items: abgelaufenChargen.map(c => `${c.name} (${c.verfall})`) });

    if (problems.length === 0) {
      el.innerHTML = '<div style="color:var(--ok);font-size:0.82rem;">✅ Alles in Ordnung</div>';
      return;
    }
    el.innerHTML = problems.map(p => `
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;font-size:0.82rem;color:var(--red);margin-bottom:4px;">⚠️ ${esc(p.label)} <span style="background:var(--red);color:#fff;padding:1px 7px;border-radius:10px;font-size:0.68rem;">${p.count}</span></div>
        <div style="font-size:0.72rem;color:var(--ink-2);padding-left:8px;">${p.items.slice(0, 5).map(i => `• ${esc(i)}`).join('<br>')}${p.items.length > 5 ? `<br><span style="color:var(--muted);">…und ${p.items.length - 5} weitere</span>` : ''}</div>
      </div>`).join('');
  } catch (e) { logError('konsistenzCheck', e); el.innerHTML = `<div style="color:var(--red);font-size:0.82rem;">❌ ${esc(e.message)}</div>`; }
}

let _sessionUnsub = null;

function startSessionMonitor() {
  if (_sessionUnsub) return;
  const ref = doc(db, `${getAdminRoot()}/bestellungen_session`, 'current');
  _sessionUnsub = onSnapshot(ref, snap => {
    const el = document.getElementById('session-result');
    if (!el) return;
    if (!snap.exists()) {
      el.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;">Keine aktive Session</div>';
      return;
    }
    const d = snap.data();
    const startedAt = d.startedAt?.toDate ? d.startedAt.toDate().toLocaleString('de-DE') : '–';
    const teilnehmer = d.teilnehmer || [];
    const statusColor = { aktiv: 'var(--ok)', gesperrt: 'var(--red)', erledigt: 'var(--muted)', abgebrochen: 'var(--muted)' }[d.status] || 'var(--muted)';
    el.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-size:0.78rem;font-weight:700;color:${statusColor};">● ${esc(d.status || '–')}</span>
        <span style="font-size:0.75rem;color:var(--ink-3);">Start: ${esc(startedAt)}</span>
        <span style="font-size:0.75rem;color:var(--ink-3);">${teilnehmer.length} Teilnehmer</span>
      </div>
      ${teilnehmer.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${teilnehmer.map(t => `<span style="background:var(--surface-2);padding:3px 10px;border-radius:20px;font-size:0.72rem;">${esc(t.name || t)}</span>`).join('')}</div>` : ''}`;
  }, e => { logError('sessionMonitor', e); });
}

function stopSessionMonitor() {
  if (_sessionUnsub) { _sessionUnsub(); _sessionUnsub = null; }
}

async function resetSession() {
  if (!confirm('Session wirklich zurücksetzen? Laufende Lagerchecks werden abgebrochen.')) return;
  try {
    await deleteDoc(doc(db, `${getAdminRoot()}/bestellungen_session`, 'current'));
    toast('Session zurückgesetzt');
    logActivity('Session zurückgesetzt', adminEditWache);
  } catch (e) { logError('resetSession', e); toast(e.message, 'error'); }
}

async function exportWachenSelect() {
  const sel = document.getElementById('wachen-backup-select');
  const val = sel?.value;
  if (!val) { toast('Bitte eine Wache wählen', 'error'); return; }
  if (val === 'alle') {
    await exportAlleWachen();
  } else {
    await exportDB('wache', val);
  }
}

async function exportAlleWachen() {
  toast('Alle Wachen werden exportiert...');
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const result = { exportiert: new Date().toISOString(), typ: 'alle_wachen', version: '1.0', wachen: {} };
    for (const id of Object.keys(WACHEN)) {
      result.wachen[id] = await exportWacheData(`wachen/${id}`);
    }
    const mSnap = await getDocs(collection(db, 'mitarbeiter'));
    result.mitarbeiter = mSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
    const filename = `lagerapp_alle_wachen_${timestamp}.json`;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    const hist = JSON.parse(localStorage.getItem('lagerapp-backups') || '[]');
    hist.unshift({ datum: new Date().toISOString(), filename });
    localStorage.setItem('lagerapp-backups', JSON.stringify(hist.slice(0, 5)));
    renderBackupHistory();
    toast('✅ ' + filename);
  } catch (e) { logError('exportAlleWachen', e); toast(e.message, 'error'); }
}

// (Lieferanten-Code entfernt)


// ── EVENT DELEGATION & LISTENERS ──

// Theme toggle
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// Logout buttons
document.querySelectorAll('.btn-logout-trigger').forEach(btn => {
  btn.addEventListener('click', doLogout);
});

// Sidebar + navbar logout (use event delegation on document for any logout button)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'logout':
      doLogout();
      break;
    case 'go-to-mitarbeiter':
      goToMitarbeiter();
      break;
    case 'open-bottom-sheet':
      openBottomSheet();
      break;
    case 'close-bottom-sheet':
      closeBottomSheet();
      break;
    case 'show-section': {
      const section = btn.dataset.section;
      showSection(section);
      if (btn.closest('#bottom-sheet')) closeBottomSheet();
      break;
    }
    case 'open-artikel-modal':
      openArtikelModal(null);
      break;
    case 'close-artikel-modal':
      closeArtikelModal();
      break;
    case 'save-artikel':
      saveArtikel();
      break;
    case 'edit-artikel':
      openArtikelModal(btn.dataset.id);
      break;
    case 'delete-artikel':
      deleteArtikel(btn.dataset.id, btn.dataset.name);
      break;
    case 'open-bereich-modal':
      openBereichModal(null);
      break;
    case 'close-bereich-modal':
      closeBereichModal();
      break;
    case 'save-bereich':
      saveBereich();
      break;
    case 'edit-bereich':
      openBereichModal(btn.dataset.id);
      break;
    case 'upload-foto':
      triggerFotoUpload(btn.dataset.id, btn.dataset.type);
      break;
    case 'delete-foto':
      deleteFotoFromGrid(btn.dataset.id, btn.dataset.type);
      break;
    case 'upload-ss-foto':
      triggerSsFotoUpload(btn.dataset.id);
      break;
    case 'create-new-user':
      createNewUser();
      break;
    case 'reset-user-pw':
      resetUserPassword(btn.dataset.uid, btn.dataset.email);
      break;
    case 'delete-user':
      deleteUser(btn.dataset.uid, btn.dataset.name);
      break;
    case 'upload-user-avatar':
      triggerUserAvatarUpload(btn.dataset.uid);
      break;
    case 'export-db':
      exportDB(btn.dataset.typ, btn.dataset.wache);
      break;
    case 'export-bilder':
      exportBilder();
      break;
    case 'start-import':
      startImport();
      break;
    case 'start-bilder-import':
      startBilderImport();
      break;
    case 'open-import-file':
      document.getElementById('import-file').click();
      break;
    case 'open-bilder-import-file':
      document.getElementById('bilder-import-file').click();
      break;
    case 'health-check':
      runHealthCheck();
      break;
    case 'konsistenz-check':
      runKonsistenzCheck();
      break;
    case 'session-reset':
      resetSession();
      break;
    case 'clear-error-log':
      localStorage.removeItem('lagerapp-error-log');
      renderErrorLog();
      break;
    case 'export-wachen-select':
      exportWachenSelect();
      break;
    case 'goto-scanner':
      window.location.href = 'scanner.html';
      break;
    case 'goto-portal':
      window.location.href = 'portal.html';
      break;
    case 'goto-lager':
      window.location.href = '../index.html';
      break;
  }
});

// Change events (selects and inputs with data-action)
document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'filter-artikel') {
    filterArtikel();
  } else if (action === 'filter-bereich') {
    filterArtikel();
  } else if (action === 'filter-foto') {
    renderFotoSection();
  } else if (action === 'filter-ss-foto') {
    renderSsFotos();
  } else if (action === 'update-lp') {
    updateArtikelLP(el.dataset.id, el.value);
  } else if (action === 'change-role') {
    changeRole(el.dataset.uid, el.value);
  } else if (action === 'change-user-wache') {
    changeUserWache(el.dataset.uid, el.value);
  } else if (action === 'admin-wache-switch') {
    adminEditWache = el.value;
    syncAdminWacheSelectors();
    loadAll();
  } else if (action === 'filter-foto-wache') {
    const fotoWache = el.value;
    Promise.all([
      getDocs(collection(db, `wachen/${fotoWache}/artikel`)),
      getDocs(query(collection(db, `wachen/${fotoWache}/bereiche`), orderBy('reihenfolge'))),
    ]).then(([aSnap, bSnap]) => {
      alleArtikel  = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      alleBereiche = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      populateFotoArtikelSelect();
      renderFotoSection();
    }).catch(e => toast('Laden fehlgeschlagen: ' + e.message, 'error'));
  } else if (action === 'filter-ss-foto-wache') {
    const ssWache = el.value;
    Promise.all([
      getDocs(collection(db, `wachen/${ssWache}/artikel`)),
      getDocs(query(collection(db, `wachen/${ssWache}/bereiche`), orderBy('reihenfolge'))),
    ]).then(([aSnap, bSnap]) => {
      alleArtikel  = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      alleBereiche = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      populateSsBereichFilter();
      renderSsFotos();
    }).catch(e => toast('Laden fehlgeschlagen: ' + e.message, 'error'));
  } else if (action === 'import-mode') {
    const warn = document.getElementById('import-warn');
    if (warn) warn.classList.toggle('hidden', el.value !== 'replace');
  }
});

// Input events
document.addEventListener('input', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'filter-artikel-search') {
    filterArtikel(el.value);
  } else if (action === 'filter-foto') {
    renderFotoSection();
  } else if (action === 'filter-ss-foto') {
    renderSsFotos();
  }
});

// Modal backdrop clicks
document.getElementById('artikel-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeArtikelModal();
});
document.getElementById('bereich-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeBereichModal();
});

// File input changes (hidden inputs)
document.getElementById('foto-file-input').addEventListener('change', uploadFotoFromGrid);
document.getElementById('ss-foto-file-input').addEventListener('change', uploadSsFoto);
document.getElementById('import-file').addEventListener('change', function() { loadImportFile(this); });
document.getElementById('bilder-import-file').addEventListener('change', function() { loadBilderImportFile(this); });
document.getElementById('user-avatar-file-input')?.addEventListener('change', uploadUserAvatar);

// Init
renderBackupHistory();
renderErrorLog();
