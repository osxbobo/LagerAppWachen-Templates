// ─────────────────────────────────────────────
// LAGER//APP – Lagersuche (index.html)
// Zusammengeführtes Modul: Suche, Bereiche, Scan, Auth-Pill,
// Login-Wall, Theme. Kein inline-JS in index.html nötig.
// ─────────────────────────────────────────────
import { getFirestore, collection, getDocs, query, orderBy, doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { app, getDBRoot, getActiveWache, switchWache, WACHEN } from './firebase-config.js';
import { initTheme, toggleTheme } from './theme.js';

const db   = getFirestore(app);
const auth = getAuth(app);

let alleArtikel  = [];
let alleBereiche = [];
let searchTimer  = null;

const TINTS = ['tint-rose', 'tint-blue', 'tint-violet', 'tint-green', 'tint-slate', 'tint-amber'];

// ── Hilfsfunktionen ──────────────────────────

function prettyBereich(name) {
  return String(name ?? '').replace(/^Lager\s*[-–]\s*/i, '').trim();
}

// HTML-Escaping für dynamisch eingesetzten Text (XSS-Schutz)
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function naturalSort(a, b) {
  const seg = s => (s || '').split(/[.\-]/).map(x => (isNaN(x) ? x : parseInt(x, 10)));
  const A = seg(a), B = seg(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const va = A[i] ?? '', vb = B[i] ?? '';
    if (va < vb) return -1;
    if (va > vb) return  1;
  }
  return 0;
}

// ── Offline-Cache (via Service Worker + IndexedDB) ───

function cacheArtikelInSW(articles, bereiche) {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_ARTIKEL',
      data: { articles, bereiche, timestamp: Date.now() },
    });
  }
}

function getCachedArtikel() {
  return new Promise(resolve => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = e => resolve(e.data || null);
    navigator.serviceWorker.controller.postMessage(
      { type: 'GET_CACHED_ARTIKEL' },
      [channel.port2]
    );
    setTimeout(() => resolve(null), 600);
  });
}

function showOfflineBanner(timestamp) {
  const date = new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  document.getElementById('status-text').textContent = `Offline – Daten vom ${date}`;
  const banner = document.getElementById('offline-banner');
  if (banner) {
    banner.textContent = `Offline – Daten vom ${date}`;
    banner.classList.remove('hidden');
  }
}

// ── Datenladen ───────────────────────────────

async function loadData() {
  // Stale-while-revalidate: Cache sofort anzeigen, dann Firebase-Daten nachladen
  const cached = await getCachedArtikel();
  if (cached) {
    alleBereiche = cached.bereiche;
    alleArtikel  = cached.articles;
    renderBereiche();
    renderFilterChips();
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('bereiche-section').classList.remove('hidden');
    document.getElementById('bereiche-total').textContent = alleBereiche.length;
    showOfflineBanner(cached.timestamp);
  }

  try {
    const root = getDBRoot();
    const [bereicheSnap, artikelSnap] = await Promise.all([
      getDocs(query(collection(db, `${root}/bereiche`), orderBy('reihenfolge'))),
      getDocs(collection(db, `${root}/artikel`)),
    ]);

    alleBereiche = bereicheSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    alleArtikel  = artikelSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('bereiche-section').classList.remove('hidden');
    document.getElementById('status-text').textContent =
      `${WACHEN[getActiveWache()]?.label ?? 'Rettungswache'} · ${alleArtikel.length} Artikel`;
    document.getElementById('bereiche-total').textContent = alleBereiche.length;
    document.getElementById('sync-pill').classList.remove('hidden');
    document.getElementById('sync-dot').classList.remove('hidden');
    document.getElementById('offline-banner').classList.add('hidden');

    renderBereiche();
    renderFilterChips();
    cacheArtikelInSW(alleArtikel, alleBereiche);
  } catch (e) {
    if (!cached) {
      document.getElementById('loading-state').innerHTML =
        `<div class="load-error">Fehler: ${esc(e.message)}</div>`;
    }
    // Bei Fehler mit Cache: Offline-Banner bleibt, gecachte Daten sind bereits angezeigt
  }
}

// ── Bereiche rendern ─────────────────────────

function renderBereiche() {
  document.getElementById('bereiche-grid').innerHTML = alleBereiche.map((b, i) => {
    const count  = alleArtikel.filter(a => a.bereich === b.id).length;
    const letter = (b.name || '?').charAt(0).toUpperCase();
    const tint   = TINTS[i % TINTS.length];
    const num    = String(i + 1).padStart(2, '0');
    return `
      <div class="la-bereich-card"
           data-bereich-id="${esc(b.id)}"
           data-bereich-name="${encodeURIComponent(b.name)}">
        <div class="la-bereich-top">
          <div class="la-photo ${tint} la-bereich-tile">
            ${b.bildUrl
              ? `<img src="${esc(b.bildUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
              : letter}
          </div>
          <div class="la-bereich-num">${num}</div>
        </div>
        <div>
          <div class="la-bereich-name">${esc(prettyBereich(b.name))}</div>
          ${b.sub ? `<div class="la-bereich-sub">${esc(b.sub)}</div>` : ''}
        </div>
        <div class="la-bereich-bottom">
          <div class="la-bereich-count">${count} Artikel</div>
        </div>
      </div>`;
  }).join('');
}

// ── Filter-Chips ─────────────────────────────

function renderFilterChips() {
  const container = document.getElementById('filter-chips');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className      = 'la-filter-chip active';
  allBtn.dataset.filter = 'all';
  allBtn.textContent    = 'Alle';
  container.appendChild(allBtn);

  alleBereiche.forEach(b => {
    const btn = document.createElement('button');
    btn.className      = 'la-filter-chip';
    btn.dataset.filter = b.name;
    btn.textContent    = prettyBereich(b.name);
    container.appendChild(btn);
  });
}

function filterChip(el, filter) {
  document.querySelectorAll('.la-filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');

  if (filter === 'all') {
    showBereiche();
    return;
  }
  const bereich = alleBereiche.find(b => b.name === filter);
  if (bereich) filterByBereich(bereich.id, bereich.name);
}

// ── Bereich-Filterung ────────────────────────

function filterByBereich(id, name) {
  const liste = alleArtikel
    .filter(a => a.bereich === id)
    .sort((a, b) => naturalSort(a.lp || '', b.lp || ''));

  document.querySelectorAll('.la-filter-chip').forEach(c => {
    const match = c.dataset.filter === name;
    c.classList.toggle('active', match);
    if (match) c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });

  document.getElementById('bereiche-section').classList.add('hidden');
  document.getElementById('search-results').classList.remove('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('status-text').textContent =
    `${liste.length} Artikel · ${prettyBereich(name)}`;

  document.getElementById('search-results').innerHTML = liste.map(a => `
    <div class="result-card fade-in">
      <div class="result-photo"
           data-foto-url="${encodeURIComponent(a.fotoUrl || '')}"
           data-art-name="${encodeURIComponent(a.name || '')}">
        ${a.fotoUrl
          ? `<img src="${esc(a.fotoUrl)}" alt="" loading="lazy">`
          : '<div class="result-photo-placeholder">📦</div>'}
      </div>
      <div class="result-body">
        <div class="result-name">${esc(a.name)}</div>
        <div class="result-location-big">
          <span class="result-bereich-big">${esc(prettyBereich(name))}</span>
          <span class="result-lp-big">📍 ${esc(a.lp || (a.location || '').replace(/\./g, ' · '))}</span>
        </div>
      </div>
    </div>`).join('');
}

function showBereiche() {
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('bereiche-section').classList.remove('hidden');
  document.getElementById('status-text').textContent =
    `${WACHEN[getActiveWache()]?.label ?? 'Rettungswache'} · ${alleArtikel.length} Artikel`;
}

// ── Suche ────────────────────────────────────

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('bereiche-section').classList.remove('hidden');
  document.getElementById('status-text').textContent =
    `${WACHEN[getActiveWache()]?.label ?? 'Rettungswache'} · ${alleArtikel.length} Artikel`;
  document.getElementById('search-clear').classList.add('hidden');
  document.getElementById('scan-btn').classList.remove('hidden');
}

function doSearch(q) {
  const lower = q.toLowerCase().trim();
  if (!lower) { clearSearch(); return; }
  const results = alleArtikel.filter(a =>
    a.name?.toLowerCase().includes(lower) ||
    a.aliases?.some(al => al.toLowerCase().includes(lower)) ||
    a.lp?.toLowerCase().includes(lower)
  );
  renderResults(results, lower);
}

function renderResults(results, q) {
  document.getElementById('bereiche-section').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('status-text').textContent =
    `${results.length} Treffer für „${q}"`;

  if (!results.length) {
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }

  function hl(text, term) {
    if (!term || !text) return esc(text || '');
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(text).replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>');
  }

  const sorted = [...results].sort((a, b) => naturalSort(a.lp || '', b.lp || ''));
  document.getElementById('search-results').innerHTML = sorted.map(a => {
    const b = alleBereiche.find(x => x.id === a.bereich);
    return `
      <div class="result-card fade-in">
        <div class="result-photo"
             data-foto-url="${encodeURIComponent(a.fotoUrl || '')}"
             data-art-name="${encodeURIComponent(a.name || '')}">
          ${a.fotoUrl
            ? `<img src="${esc(a.fotoUrl)}" alt="" loading="lazy">`
            : '<div class="result-photo-placeholder">📦</div>'}
        </div>
        <div class="result-body">
          <div class="result-name">${hl(a.name, q)}</div>
          <div class="result-location-big">
            ${b ? `<span class="result-bereich-big">${esc(prettyBereich(b.name))}</span>` : ''}
            <span class="result-lp-big">📍 ${esc(a.lp || (a.location || '').replace(/\./g, ' · '))}</span>
          </div>
          ${a.aliases?.length
            ? `<div class="result-aliases">${a.aliases.slice(0, 3).map(esc).join(' · ')}</div>`
            : ''}
        </div>
      </div>`;
  }).join('');
  document.getElementById('search-results').classList.remove('hidden');
}

// ── Foto-Modal ───────────────────────────────

function openPhoto(url, name) {
  if (!url) return;
  document.getElementById('modal-img').src             = url;
  document.getElementById('modal-title').textContent   = name;
  document.getElementById('photo-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('photo-modal').classList.add('hidden');
}

// ── Lager-Scan (Kamera-Suche) ────────────────

let lagerScanReader = null;

function extractGTIN(raw) {
  const s = raw.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (s.includes('(')) {
    const g = s.match(/\(01\)(\d{14})/);
    return g ? g[1] : null;
  }
  if (/^\d{13}$/.test(s)) return '0' + s;
  if (/^\d{14}$/.test(s)) return s;
  if (s.startsWith('01') && s.length >= 16) return s.substring(2, 16);
  return null;
}

function openLagerScan() {
  document.getElementById('lager-scan-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('lager-scan-hint').classList.remove('hidden');
  document.getElementById('lager-scan-result').classList.add('hidden');
  document.getElementById('lager-scan-not-found').classList.add('hidden');
  document.getElementById('lager-scan-status').textContent = 'Artikel-Code scannen';
  startLagerScan();
}

async function startLagerScan() {
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.DATA_MATRIX,
    ]);
    lagerScanReader = new ZXing.BrowserMultiFormatReader(hints);
    await lagerScanReader.decodeFromConstraints(
      { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
      'lager-scan-video',
      result => { if (result) onLagerScan(result.getText()); }
    );
  } catch (e) {
    document.getElementById('lager-scan-status').textContent =
      e.name === 'NotAllowedError' ? 'Kamera verweigert' : 'Kamera nicht verfügbar';
  }
}

function closeLagerScan() {
  document.getElementById('lager-scan-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  if (lagerScanReader) {
    try { lagerScanReader.reset(); } catch (_) {}
    lagerScanReader = null;
  }
  const v = document.getElementById('lager-scan-video');
  if (v?.srcObject) {
    v.srcObject.getTracks().forEach(t => t.stop());
    v.srcObject = null;
  }
  window._lastLagerScan = null;
}

function onLagerScan(raw) {
  if (!raw || raw.trim().length < 3) return;
  const trimmed = raw.trim();
  if (window._lastLagerScan === trimmed) return;
  window._lastLagerScan = trimmed;
  setTimeout(() => { if (window._lastLagerScan === trimmed) window._lastLagerScan = null; }, 2000);
  if (navigator.vibrate) navigator.vibrate(80);

  const gtin  = extractGTIN(trimmed);
  let   found = gtin
    ? alleArtikel.find(a => a.gtin === gtin || (Array.isArray(a.gtins) && a.gtins.includes(gtin)))
    : null;
  if (!found) {
    found = alleArtikel.find(a => a.lp?.toLowerCase() === trimmed.toLowerCase());
  }

  document.getElementById('lager-scan-hint').classList.add('hidden');

  if (found) {
    const b = alleBereiche.find(x => x.id === found.bereich);
    document.getElementById('lager-scan-art-name').textContent = found.name;
    document.getElementById('lager-scan-lp').textContent       = '📍 ' + (found.lp || '–');
    document.getElementById('lager-scan-bereich').textContent  = b ? prettyBereich(b.name) : '';
    const photoEl = document.getElementById('lager-scan-photo');
    photoEl.innerHTML = found.fotoUrl
      ? `<img src="${esc(found.fotoUrl)}" alt="" class="ls-photo-img">`
      : '📦';
    document.getElementById('lager-scan-result').classList.remove('hidden');
    document.getElementById('lager-scan-not-found').classList.add('hidden');
  } else {
    document.getElementById('lager-scan-raw').textContent = trimmed.substring(0, 50);
    document.getElementById('lager-scan-result').classList.add('hidden');
    document.getElementById('lager-scan-not-found').classList.remove('hidden');
  }
}

// ── Auth-Pill ────────────────────────────────

function updateAuthPill() {
  const pinAuth  = sessionStorage.getItem('lager-pin-auth') || localStorage.getItem('lager-pin-auth');
  const pinName  = sessionStorage.getItem('lager-pin-name') || localStorage.getItem('lager-pin-name') || '';
  const fbUser   = auth.currentUser;
  const isWl     = fbUser && !fbUser.isAnonymous;
  const isMa     = pinAuth === 'true';

  const guestEl  = document.getElementById('auth-pill-guest');
  const userEl   = document.getElementById('auth-pill-user');
  const avatarEl = document.getElementById('auth-pill-avatar');
  const labelEl  = document.getElementById('auth-pill-label');
  const linkEl   = document.getElementById('auth-pill-link');

  if (isMa) {
    guestEl.classList.add('hidden');
    userEl.classList.remove('hidden');
    const initials = pinName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'MA';
    const avatarUrl = localStorage.getItem('lager-avatar-url') || sessionStorage.getItem('lager-avatar-url');
    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${esc(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;
    } else {
      avatarEl.textContent = initials;
    }
    labelEl.textContent  = 'Mitarbeiter-Hub';
    linkEl.href          = 'pages/mitarbeiter.html';
    const vorname  = pinName.split(' ')[0];
    const nameWrap = document.getElementById('greeting-name-wrap');
    const greetEl  = document.getElementById('greeting-name');
    if (nameWrap && greetEl && vorname) {
      greetEl.textContent = vorname;
      nameWrap.classList.remove('hidden');
    }
  } else if (isWl) {
    guestEl.classList.add('hidden');
    userEl.classList.remove('hidden');
    avatarEl.textContent = (fbUser.email || 'W').charAt(0).toUpperCase();
    labelEl.textContent  = 'Portal öffnen';
    linkEl.href          = 'pages/portal.html';
    document.getElementById('greeting-name-wrap')?.classList.add('hidden');
  } else {
    guestEl.classList.remove('hidden');
    userEl.classList.add('hidden');
    document.getElementById('greeting-name-wrap')?.classList.add('hidden');
  }
}

// ── Login-Wall ───────────────────────────────

function openLoginWall(context, returnUrl) {
  const ctxEl = document.getElementById('login-wall-context');
  const btn   = document.getElementById('login-wall-btn');
  if (ctxEl) ctxEl.textContent = context || 'für diese Aktion';
  if (btn) {
    const ret = returnUrl ? '&return=' + encodeURIComponent(returnUrl) : '';
    btn.href  = 'pages/login.html?tab=mitarbeiter' + ret;
  }
  document.getElementById('login-wall').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLoginWall() {
  document.getElementById('login-wall').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Event-Listener ───────────────────────────

// Theme
initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// Suche
document.getElementById('search-input').addEventListener('input', e => {
  const val = e.target.value;
  document.getElementById('search-clear').classList.toggle('hidden', !val);
  document.getElementById('scan-btn').classList.toggle('hidden', !!val);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(val), 200);
});
document.getElementById('search-clear').addEventListener('click', clearSearch);

// Scan
document.getElementById('scan-btn').addEventListener('click', openLagerScan);
document.getElementById('lager-scan-close').addEventListener('click', closeLagerScan);

// Filter-Chips (Delegation)
document.getElementById('filter-chips').addEventListener('click', e => {
  const chip = e.target.closest('.la-filter-chip');
  if (chip) filterChip(chip, chip.dataset.filter);
});
document.getElementById('filter-chips').addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
  }
}, { passive: false });

// Bereiche-Grid (Delegation)
document.getElementById('bereiche-grid').addEventListener('click', e => {
  const card = e.target.closest('.la-bereich-card');
  if (!card) return;
  filterByBereich(card.dataset.bereichId, decodeURIComponent(card.dataset.bereichName));
});

// Suchergebnisse: Foto-Klick (Delegation, XSS-safe via data-Attribut)
document.getElementById('search-results').addEventListener('click', e => {
  const photo = e.target.closest('[data-foto-url]');
  if (!photo) return;
  openPhoto(
    decodeURIComponent(photo.dataset.fotoUrl),
    decodeURIComponent(photo.dataset.artName)
  );
});

// Foto-Modal
document.getElementById('photo-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});
document.querySelector('.la-modal-close').addEventListener('click', closeModal);

// Login-Wall
document.getElementById('login-wall').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLoginWall();
});
document.getElementById('login-wall-cancel').addEventListener('click', closeLoginWall);

// Auth-State — Heimat-Wache beim Login automatisch setzen
onAuthStateChanged(auth, async user => {
  updateAuthPill();
  if (user && !user.isAnonymous) {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const heimatWache = snap.exists() ? snap.data()?.wache : null;
      if (heimatWache && WACHEN[heimatWache] && !getActiveWache()) {
        switchWache(heimatWache);
        updateWachePill();
      }
    } catch (_) {}
  }
});
updateAuthPill();

// ── Start ────────────────────────────────────

function wacheCity(id) {
  const label = WACHEN[id]?.label ?? id;
  return label.split(' ').slice(1).join(' ') || label;
}

function wacheImgSrc(id) {
  return `icons/wache_${id.replace(/^w\d+_/, '')}.png.png`;
}

// Update the wache-pill in the navbar (if present)
function updateWachePill() {
  const pill = document.getElementById('wache-pill');
  const wache = getActiveWache();
  if (pill && wache) {
    pill.textContent = wacheCity(wache);
    pill.classList.remove('hidden');
  }
}

// Update the wache image in the hero status row
function updateWacheImg() {
  const img = document.getElementById('wache-status-img');
  const wache = getActiveWache();
  if (img && wache) {
    img.src = wacheImgSrc(wache);
    img.alt = wacheCity(wache);
    img.classList.remove('hidden');
  }
}

updateWachePill();
updateWacheImg();

if (getActiveWache()) {
  loadData();
}
