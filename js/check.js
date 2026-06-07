// ─────────────────────────────────────────────
// LAGER//APP – check.js  (ES-Modul)
// ─────────────────────────────────────────────
import { app, getDBRoot } from '../js/firebase-config.js';
import { initTheme, toggleTheme } from '../js/theme.js';

import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  doc, collection,
  getDoc, getDocs, getDocsFromServer, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, writeBatch,
  onSnapshot, serverTimestamp, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getDatabase,
  ref    as rtRef,
  set    as rtSet,
  remove as rtRemove,
  onDisconnect,
  onValue,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

/* ── Theme ──────────────────────────────────── */
window._appModuleLoaded = 'check';
initTheme();
document.getElementById('theme-btn')?.addEventListener('click', toggleTheme);

/* ── Firebase ───────────────────────────────── */
const db = getFirestore(app);
const auth = getAuth(app);
let rtdb   = null;
try { rtdb = getDatabase(app); } catch(e) {}

/* ── Constants ──────────────────────────────── */
const SID          = 'current';
const QUICK_VALUES = [1, 2, 3, 5, 10];
const ACTIVE_STATS = new Set(['aktiv', 'gesperrt']);

/* ── State ──────────────────────────────────── */
const S = {
  user:       { id: null, name: '' },
  bereiche:   [],
  alleArtikel:[],
  session:    null,
  myBereichId:null,
  myArtikel:  [],
  warenkorb:  {},
  presRef:    null,
  disconnRef: null,
  unsubSess:  null,
  heartbeat:  null,
};

/* ── Utilities ──────────────────────────────── */
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms)),
]);

function toast(msg, type = 'info') {
  const color = type === 'error' ? 'var(--crit)' : type === 'ok' ? 'var(--ok)' : 'var(--ink-2)';
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:var(--surface);color:${color};border-radius:12px;padding:10px 18px;
    font-size:13px;font-family:var(--font-ui);z-index:3000;
    box-shadow:var(--sh-3),inset 0 0 0 1px ${color};
    white-space:nowrap;max-width:88vw;overflow:hidden;text-overflow:ellipsis;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function showScreen(name) {
  document.getElementById('screen-loading')?.remove();
  ['join','check','wait','sig','block'].forEach(s =>
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name)
  );
}

function prettyName(name) {
  return (name || '').replace(/^Lager\s*[-–]\s*/i, '').trim();
}

function naturalSort(a, b) {
  const seg = s => (s || '').split(/[\.\-]/).map(x => isNaN(x) ? x : +x);
  const A = seg(a), B = seg(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const sa = A[i] ?? '', sb = B[i] ?? '';
    if (sa < sb) return -1; if (sa > sb) return 1;
  }
  return 0;
}

function stockState(stock, min) {
  if (stock == null) return 'ok';
  if (stock === 0 || stock < min) return 'crit';
  if (stock < min * 1.5) return 'low';
  return 'ok';
}

/* ── Auth & Bootstrap ───────────────────────── */
function authGet(key) { return sessionStorage.getItem(key) || localStorage.getItem(key); }
(async function init() {
  try {
  const pinOk = authGet('lager-pin-auth');
  const name  = authGet('lager-pin-name');
  const empId = authGet('lager-employee-id');

  if (!pinOk || !name) {
    const ret = encodeURIComponent(window.location.pathname);
    window.location.replace(`../pages/login.html?tab=mitarbeiter&return=${ret}`);
    return;
  }

  if (!localStorage.getItem('activeWache')) {
    window.location.replace('../index.html');
    return;
  }

  S.user.name = name;
  S.user.id   = empId
    || btoa(unescape(encodeURIComponent(name))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)
    || name.replace(/\s+/g, '_');

  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.textContent = name;

  void (async () => {
    try {
      const _authUser = await withTimeout(
        new Promise(r => { const u = onAuthStateChanged(auth, v => { u(); r(v); }); }),
        5000
      );
      if (!_authUser || _authUser.isAnonymous) await withTimeout(signInAnonymously(auth), 8000);
    } catch(_) {}
  })();

  await loadData();
  loadLaufband();

  let sessSnap = null;
  try {
    sessSnap = await withTimeout(getDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID)), 6000);
  } catch(_) {}
  if (sessSnap?.exists() && sessSnap.data().status === 'aktiv' && sessSnap.data().modus === 'solo') {
    const d = sessSnap.data();
    const heartbeats = d.heartbeats ?? {};
    const alive = Object.values(heartbeats).some(ts => {
      const t = ts?.toMillis?.() ?? 0;
      return t > 0 && (Date.now() - t) < 90_000;
    });
    if (alive) {
      document.getElementById('block-solo-info').textContent =
        `${d.mitarbeiter || 'Ein Kollege'} macht gerade die Lagerbestellung (StockSwipe). Bitte warten bis abgeschlossen.`;
      showScreen('block');
      startSessionListener();
      return;
    }
  }

  startSessionListener();
  setupRtdbListener();
  showScreen('join');
  renderJoin();
  } catch(e) {
    document.getElementById('screen-loading')?.remove();
    console.error('Initialisierung fehlgeschlagen:', e);
    document.body.insertAdjacentHTML('beforeend',
      `<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--bg,#1a1a1a);color:var(--ink-2,#ccc);font-family:sans-serif;padding:24px;text-align:center;">
        <div style="font-size:2rem;">⚠️</div>
        <div style="font-weight:600;">Laden fehlgeschlagen</div>
        <div style="font-size:0.85rem;color:var(--ink-3,#888);">${e.message || 'Verbindungsfehler'}</div>
        <button onclick="location.reload()" style="margin-top:8px;padding:10px 24px;border-radius:10px;background:#F26B2E;border:none;color:#fff;font-size:0.9rem;font-weight:600;cursor:pointer;">Neu laden</button>
        <a href="mitarbeiter.html" style="font-size:0.82rem;color:var(--ink-3,#888);">← Zurück</a>
      </div>`
    );
  }
})();

/* ── Load bereiche + artikel ────────────────── */
async function loadData() {
  try {
    const [bSnap, aSnap] = await Promise.all([
      getDocs(query(collection(db, `${getDBRoot()}/bereiche`), orderBy('reihenfolge'))),
      getDocs(collection(db, `${getDBRoot()}/artikel`)),
    ]);
    S.bereiche    = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.alleArtikel = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error('Daten laden fehlgeschlagen:', e);
  }
}

/* ── Session listener (Firestore) ───────────── */
function startSessionListener() {
  if (S.unsubSess) { S.unsubSess(); S.unsubSess = null; }
  S.unsubSess = onSnapshot(doc(db, `${getDBRoot()}/bestellungen_session`, SID), snap => {
    S.session = snap.exists() ? snap.data() : null;
    onSessionChange();
  });
}

function onSessionChange() {
  const blockVisible = !document.getElementById('screen-block').classList.contains('hidden');
  const joinHidden   = document.getElementById('screen-join').classList.contains('hidden');
  const waitVisible  = !document.getElementById('screen-wait').classList.contains('hidden');

  if (blockVisible && (!S.session || S.session.status !== 'aktiv' || S.session.modus !== 'solo')) {
    setupRtdbListener();
    showScreen('join');
    renderJoin();
    return;
  }

  if (!joinHidden)   renderJoin();
  if (waitVisible)   renderWait();
}

/* ── RTDB presence ──────────────────────────── */
function setupRtdbListener() {
  if (!rtdb) return;
  try {
    onValue(rtRef(rtdb, 'presence'), snap => {
      handlePresence(snap.val() || {});
    });
  } catch(e) {}
}

async function handlePresence(presence) {
  if (!S.session) return;
  const bs = S.session.bereichStatus || {};
  const updates = {};

  Object.entries(presence).forEach(([uid, data]) => {
    if (uid === S.user.id || data?.status !== 'abgebrochen') return;
    Object.entries(bs).forEach(([bid, bsData]) => {
      if (bsData.mitarbeiterId === uid && ACTIVE_STATS.has(bsData.status)) {
        updates[`bereichStatus.${bid}.status`] = 'abgebrochen';
      }
    });
  });

  if (Object.keys(updates).length === 0) return;
  try {
    await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID), updates);
    Object.entries(presence).forEach(([uid, data]) => {
      if (data?.status === 'abgebrochen' && uid !== S.user.id) {
        try { rtRemove(rtRef(rtdb, `presence/${uid}`)); } catch(e) {}
      }
    });
  } catch(e) {}
}

async function setupPresence(bereichId) {
  if (!rtdb) { startHeartbeatFallback(); return; }
  try {
    S.presRef    = rtRef(rtdb, `presence/${S.user.id}`);
    const data   = { status: 'aktiv', bereichId, name: S.user.name, ts: Date.now() };
    await withTimeout(rtSet(S.presRef, data), 3000);
    S.disconnRef = onDisconnect(S.presRef);
    await withTimeout(S.disconnRef.set({ status: 'abgebrochen', bereichId, name: S.user.name, ts: Date.now() }), 3000);
  } catch(e) {
    console.warn('RTDB Presence fehlgeschlagen – Heartbeat-Fallback aktiv', e);
    startHeartbeatFallback();
  }
}

function clearPresence() {
  stopHeartbeatFallback();
  if (!S.presRef) return;
  if (S.disconnRef) S.disconnRef.cancel().catch(() => {});
  rtRemove(S.presRef).catch(() => {});
  S.presRef = null; S.disconnRef = null;
}

/* ── Heartbeat fallback ── */
function startHeartbeatFallback() {
  stopHeartbeatFallback();
  S.heartbeat = setInterval(async () => {
    if (!S.session || !S.myBereichId) return;
    try {
      await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID), {
        [`heartbeats.${S.user.id}`]: serverTimestamp(),
      });
    } catch(e) {}
  }, 15_000);
}

function stopHeartbeatFallback() {
  if (S.heartbeat) { clearInterval(S.heartbeat); S.heartbeat = null; }
}

/* ── beforeunload ── */
window.addEventListener('beforeunload', () => {
  const myStatus = S.session?.bereichStatus?.[S.myBereichId]?.status;
  if (S.myBereichId && ACTIVE_STATS.has(myStatus)) {
    try {
      updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID), {
        [`bereichStatus.${S.myBereichId}.status`]: 'abgebrochen',
        zuletzt: serverTimestamp(),
      });
    } catch(e) {}
  }
});

/* ══════════════════════════════════════════════
   SCREEN: BEREICH-AUSWAHL
══════════════════════════════════════════════ */
function renderJoin() {
  document.getElementById('live-badge').classList.add('on');

  const sessionData   = S.session;
  const bereichStatus = sessionData?.bereichStatus || {};

  const andereAktiv = Object.values(bereichStatus).filter(bs =>
    ACTIVE_STATS.has(bs.status) && bs.mitarbeiterId !== S.user.id
  ).length;
  document.getElementById('join-sub').textContent =
    andereAktiv > 0
      ? `${andereAktiv} Kollege${andereAktiv > 1 ? 'n' : ''} gerade aktiv · Wähle deinen Bereich`
      : 'Wähle deinen Bereich für die Lagerbestellung';

  const myActiveBereichId = Object.entries(bereichStatus).find(
    ([, bs]) => ACTIVE_STATS.has(bs.status) && bs.mitarbeiterId === S.user.id
  )?.[0] ?? null;

  document.getElementById('bereich-list').innerHTML = S.bereiche.map(b => {
    const bs     = bereichStatus[b.id];
    const status = bs?.status || 'frei';
    const count  = S.alleArtikel.filter(a => a.bereich === b.id).length;
    const isMe   = bs?.mitarbeiterId === S.user.id;

    let iconHtml, badgeHtml, cardClass, subText;
    let clickable = false;

    if (status === 'erledigt') {
      iconHtml  = `<div class="s-dot erledigt"></div>`;
      badgeHtml = `<div class="bc-badge done">✓ Fertig</div>`;
      cardClass = 'is-done';
      subText   = bs.mitarbeiter ? `Erledigt von ${esc(bs.mitarbeiter)}` : 'Erledigt';

    } else if (ACTIVE_STATS.has(status) && !isMe) {
      const initials = (bs?.mitarbeiter || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      iconHtml  = `<span style="font-size:1.1rem;line-height:1;">🔒</span>`;
      badgeHtml = `<div class="bc-badge aktiv">${esc(initials)} läuft</div>`;
      cardClass = 'blocked';
      subText   = bs.mitarbeiter ? `${esc(bs.mitarbeiter)} arbeitet hier` : 'Belegt';

    } else if (ACTIVE_STATS.has(status) && isMe) {
      iconHtml  = `<div class="s-dot frei"></div>`;
      badgeHtml = `<div class="bc-badge mine">Fortführen →</div>`;
      cardClass = 'is-mine clickable';
      subText   = 'Dein Bereich – weitermachen';
      clickable = true;

    } else if (status === 'abgebrochen') {
      iconHtml  = `<div class="s-dot abgebrochen"></div>`;
      badgeHtml = `<div class="bc-badge broken">Abgebrochen</div>`;
      cardClass = myActiveBereichId ? 'is-broken' : 'is-broken clickable';
      subText   = 'Fortführen?';
      clickable = !myActiveBereichId;

    } else {
      iconHtml  = `<div class="s-dot frei"></div>`;
      badgeHtml = `<div class="bc-badge frei">Frei</div>`;
      cardClass = myActiveBereichId ? '' : 'clickable';
      subText   = '';
      clickable = !myActiveBereichId;
    }

    return `
      <div class="bereich-card ${cardClass}" data-id="${esc(b.id)}" data-clickable="${clickable}">
        <div class="bc-icon">${iconHtml}</div>
        <div class="bc-info">
          <div class="bc-name">${esc(prettyName(b.name))}</div>
          <div class="bc-sub">${count} Artikel${subText ? ' · ' + subText : ''}</div>
        </div>
        ${badgeHtml}
      </div>`;
  }).join('');

  // Event delegation for bereich-card clicks
  const list = document.getElementById('bereich-list');
  list.onclick = e => {
    const card = e.target.closest('.bereich-card');
    if (!card || card.dataset.clickable !== 'true') return;
    pickBereich(card.dataset.id);
  };
}

function goJoin() { showScreen('join'); renderJoin(); }

function navBack() {
  if (!document.getElementById('screen-check').classList.contains('hidden')) {
    cancelBereich();
  } else {
    window.location.href = 'mitarbeiter.html';
  }
}

/* ── Pick & lock bereich ── */
async function pickBereich(bereichId) {
  const card = document.querySelector(`.bereich-card[data-id="${bereichId}"]`);
  if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }

  try {
    if (!auth.currentUser) try { await withTimeout(signInAnonymously(auth), 5000); } catch(_) {}

    const sessRef  = doc(db, `${getDBRoot()}/bestellungen_session`, SID);
    const snap     = await getDoc(sessRef);
    const isActive = snap.exists() && snap.data().status === 'aktiv';

    if (isActive) {
      const data = snap.data();
      const bs   = data.bereichStatus?.[bereichId];

      if (ACTIVE_STATS.has(bs?.status) && bs.mitarbeiterId !== S.user.id)
        throw new Error(`Bereich wird gerade von ${esc(bs.mitarbeiter)} bearbeitet`);
      if (bs?.status === 'erledigt')
        throw new Error('Dieser Bereich ist bereits abgeschlossen');

      const alreadyIn = (data.teilnehmer || []).some(t => t.id === S.user.id);
      await updateDoc(sessRef, {
        [`bereichStatus.${bereichId}`]: {
          status:        'aktiv',
          mitarbeiter:   S.user.name,
          mitarbeiterId: S.user.id,
          startedAt:     serverTimestamp(),
          erledigtAt:    null,
        },
        ...(!alreadyIn ? { teilnehmer: arrayUnion({ id: S.user.id, name: S.user.name, joinedAt: new Date().toISOString() }) } : {}),
        [`heartbeats.${S.user.id}`]: serverTimestamp(),
        zuletzt: serverTimestamp(),
      });
    } else {
      await setDoc(sessRef, {
        status:  'aktiv', modus: 'team',
        startzeit: serverTimestamp(), zuletzt: serverTimestamp(),
        teilnehmer: [{ id: S.user.id, name: S.user.name, joinedAt: new Date().toISOString() }],
        bereichStatus: {
          [bereichId]: {
            status: 'aktiv', mitarbeiter: S.user.name, mitarbeiterId: S.user.id,
            startedAt: serverTimestamp(), erledigtAt: null,
          }
        },
        heartbeats: { [S.user.id]: serverTimestamp() },
      });
    }

    S.myBereichId = bereichId;
    startHeartbeatFallback();
    setupPresence(bereichId);
    await loadWarenkorb();
    renderCheck();
    showScreen('check');
    document.getElementById('screen-check').scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });

  } catch(e) {
    toast(e.message, 'error');
    if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
  }
}

/* ── Load existing warenkorb ── */
async function loadWarenkorb() {
  S.warenkorb = {};
  try {
    const snap = await getDocs(
      query(collection(db, `${getDBRoot()}/warenkorb`), where('sessionId', '==', SID))
    );
    snap.forEach(d => {
      const item = d.data();
      if (item.bereichId === S.myBereichId) {
        S.warenkorb[item.artikelId] = { bestellen: item.bestellen, menge: item.menge ?? 1 };
      }
    });
  } catch(e) {}
}

/* ══════════════════════════════════════════════
   SCREEN: ARTIKEL-CHECK
══════════════════════════════════════════════ */
function renderCheck() {
  const b = S.bereiche.find(x => x.id === S.myBereichId);
  document.getElementById('check-bereich-label').textContent = prettyName(b?.name || '');

  const finishBtn = document.getElementById('btn-finish');
  finishBtn.disabled = false;
  finishBtn.textContent = '✅ Bereich fertig markieren';

  S.myArtikel = S.alleArtikel
    .filter(a => a.bereich === S.myBereichId)
    .sort((a, b) => naturalSort(a.lp || '', b.lp || ''));

  document.getElementById('check-body').innerHTML =
    S.myArtikel.length === 0
      ? `<div style="padding:60px 20px;text-align:center;color:var(--ink-3);font-size:14px;">Keine Artikel in diesem Bereich</div>`
      : S.myArtikel.map(buildArtikelCard).join('');

  attachCheckListeners();
  updateProgress();
  document.getElementById('screen-check').scrollTop = 0;
}

function buildArtikelCard(a) {
  const item    = S.warenkorb[a.id] || { bestellen: null, menge: 1 };
  const bestell = item.bestellen;
  const menge   = item.menge ?? 1;
  const minUnit   = a.minEinheit || 'Stk';
  const maxUnit   = a.maxEinheit || a.minEinheit || 'Stk';
  const orderUnit = maxUnit;
  const state     = stockState(a.stock, a.min);

  const minC = a.min  != null ? `<div class="mmi-cell mmi-min"><span class="mmi-lbl">MIN</span><span class="mmi-val">${a.min}</span><span class="mmi-unit">${minUnit}</span></div>` : '';
  const istC = a.stock != null ? `<div class="mmi-cell mmi-ist-${state}"><span class="mmi-lbl">IST</span><span class="mmi-val">${a.stock}</span><span class="mmi-unit">${minUnit}</span></div>` : '';
  const maxC = a.max  != null ? `<div class="mmi-cell mmi-max"><span class="mmi-lbl">MAX</span><span class="mmi-val">${a.max}</span><span class="mmi-unit">${maxUnit}</span></div>` : '';
  const mmiHtml = (minC || istC || maxC) ? `<div class="mmi-row">${minC}${istC}${maxC}</div>` : '';

  let barHtml = '';
  if (a.max != null) {
    const fill   = a.max > 0 ? Math.min(100, Math.round(((a.stock ?? 0) / a.max) * 100)) : 0;
    const minPct = (a.min != null && a.max > 0) ? Math.min(100, Math.round((a.min / a.max) * 100)) : null;
    const marker = minPct != null ? `<div class="stock-min-marker" style="left:${minPct}%"></div>` : '';
    barHtml = `<div class="stock-bar"><div class="stock-fill ${state}" style="width:${fill}%"></div>${marker}</div>`;
  }

  const fotoItems = [];
  if (a.fotoUrl)      fotoItems.push(`<div><div class="a-foto-btn" data-foto="${esc(a.fotoUrl)}" data-name="${esc(a.name)}"><img src="${esc(a.fotoUrl)}" alt="${esc(a.name)}" loading="lazy"></div><div class="a-foto-label">PRODUKT</div></div>`);
  if (a.lagerFotoUrl) fotoItems.push(`<div><div class="a-foto-btn" data-foto="${esc(a.lagerFotoUrl)}" data-name="Lagerort: ${esc(a.name)}"><img src="${esc(a.lagerFotoUrl)}" alt="Lagerort: ${esc(a.name)}" loading="lazy"></div><div class="a-foto-label">LAGERORT</div></div>`);
  const fotosHtml = fotoItems.length
    ? `<div class="a-fotos">${fotoItems.join('')}</div>`
    : `<div class="a-fotos"><div class="a-foto-btn" style="cursor:default;opacity:0.35;pointer-events:none;">📦</div></div>`;

  const maxOrder = a.max != null ? a.max : null;

  const chipsHtml = QUICK_VALUES.filter(v => maxOrder == null || v <= maxOrder).map(v =>
    `<div class="chip ${(menge === v && bestell) ? 'sel' : ''}" data-id="${esc(a.id)}" data-val="${v}">${v}</div>`
  ).join('');

  const suggestQty = maxOrder;
  const jaLabel    = suggestQty ? `Bestellen (+${suggestQty} ${orderUnit})` : 'Bestellen';

  const cardCls = bestell === true ? 'is-bestell' : bestell === false ? 'is-ok' : '';
  return `
    <div class="artikel-card ${cardCls}" id="card-${esc(a.id)}">
      <div class="a-header">
        ${fotosHtml}
        <div class="a-info">
          <div class="a-name">${esc(a.name)}</div>
          <div class="a-lp">
            <span class="a-lp-chip">${esc(a.lp || '–')}</span>
            ${a.location ? `<span class="a-lp-sep">·</span><span>${esc(a.location)}</span>` : ''}
          </div>
          ${mmiHtml}
          ${barHtml}
        </div>
      </div>
      ${a.hinweis ? `<div class="a-hinweis">💡 <span>${esc(a.hinweis)}</span></div>` : ''}
      <div class="bestell-div"></div>
      <div class="bestell-body">
        <div class="bestell-q">Muss bestellt werden?</div>
        <div class="ja-nein-row">
          <button class="jn-btn nein ${bestell === false ? 'sel' : ''}" data-id="${esc(a.id)}" data-val="nein">✓ Ausreichend</button>
          <button class="jn-btn ja   ${bestell === true  ? 'sel' : ''}" data-id="${esc(a.id)}" data-val="ja">${jaLabel}</button>
        </div>
        <div class="menge-wrap ${bestell === true ? 'vis' : ''}" id="menge-${esc(a.id)}">
          <div class="menge-lbl">Wie viel soll bestellt werden? <span class="menge-unit-hint">(in ${orderUnit}${maxOrder != null ? ` · max. ${maxOrder}` : ''})</span></div>
          <div class="chips-row" data-id="${esc(a.id)}">${chipsHtml}</div>
          <div class="pm-row">
            <button class="pm-btn" data-id="${esc(a.id)}" data-action="minus">−</button>
            <input  class="pm-disp" id="pm-${esc(a.id)}" type="number" inputmode="numeric" value="${menge}" min="1"${maxOrder != null ? ` max="${maxOrder}"` : ''}>
            <button class="pm-btn" data-id="${esc(a.id)}" data-action="plus">+</button>
          </div>
        </div>
      </div>
    </div>`;
}

function attachCheckListeners() {
  // Ja / Nein
  document.querySelectorAll('.jn-btn').forEach(btn => {
    const handle = () => {
      const id      = btn.dataset.id;
      const bestell = btn.dataset.val === 'ja';
      if (!S.warenkorb[id]) S.warenkorb[id] = { bestellen: null, menge: 1 };
      S.warenkorb[id].bestellen = bestell;

      document.getElementById(`card-${id}`).className = `artikel-card ${bestell ? 'is-bestell' : 'is-ok'}`;
      document.querySelectorAll(`.jn-btn[data-id="${id}"]`).forEach(b =>
        b.classList.toggle('sel', b.dataset.val === btn.dataset.val)
      );
      document.getElementById(`menge-${id}`).classList.toggle('vis', bestell);
      updateProgress();
      saveWarenkorb(id);
    };

    if (btn.dataset.val === 'ja') {
      let holdTimer = null;
      const startHold = (e) => {
        if (e.cancelable) e.preventDefault();
        btn.style.transform = 'scale(0.95)';
        btn.classList.add('holding');
        holdTimer = setTimeout(() => {
          holdTimer = null;
          btn.classList.remove('holding');
          btn.style.transform = '';
          handle();
        }, 2000);
      };
      const cancelHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        btn.classList.remove('holding');
        btn.style.transform = '';
      };
      btn.addEventListener('touchstart',  startHold,  { passive: false });
      btn.addEventListener('touchend',    cancelHold);
      btn.addEventListener('touchcancel', cancelHold);
      btn.addEventListener('mousedown',   startHold);
      btn.addEventListener('mouseup',     cancelHold);
      btn.addEventListener('mouseleave',  cancelHold);
      btn.addEventListener('click', (e) => e.stopPropagation());
    } else {
      btn.addEventListener('touchstart', e => { e.preventDefault(); btn.style.transform = 'scale(0.95)'; handle(); }, { passive: false });
      btn.addEventListener('touchend',   () => { btn.style.transform = ''; });
      btn.addEventListener('click', handle);
    }
  });

  // Chips
  document.querySelectorAll('.chip').forEach(chip => {
    const handle = () => { setMenge(chip.dataset.id, +chip.dataset.val); saveWarenkorb(chip.dataset.id); };
    chip.addEventListener('touchstart', e => { e.preventDefault(); handle(); }, { passive: false });
    chip.addEventListener('click', handle);
  });

  // ± buttons
  document.querySelectorAll('.pm-btn').forEach(btn => {
    const handle = () => {
      const id  = btn.dataset.id;
      const inp = document.getElementById(`pm-${id}`);
      const cur = parseInt(inp.value) || 1;
      const max = inp.max ? parseInt(inp.max) : Infinity;
      const nxt = btn.dataset.action === 'plus' ? Math.min(max, cur + 1) : Math.max(1, cur - 1);
      setMenge(id, nxt); saveWarenkorb(id);
    };
    btn.addEventListener('touchstart', e => { e.preventDefault(); handle(); }, { passive: false });
    btn.addEventListener('click', handle);
  });

  // Manual input
  document.querySelectorAll('.pm-disp').forEach(inp => {
    const id = inp.id.replace('pm-', '');
    inp.addEventListener('change', () => {
      const max = inp.max ? parseInt(inp.max) : Infinity;
      setMenge(id, Math.min(max, Math.max(1, parseInt(inp.value) || 1)));
      saveWarenkorb(id);
    });
  });

  // Photo buttons
  document.querySelectorAll('.a-foto-btn[data-foto]').forEach(btn => {
    btn.addEventListener('click', () => openFoto(btn.dataset.foto, btn.dataset.name));
  });
}

function setMenge(id, val) {
  if (!S.warenkorb[id]) S.warenkorb[id] = { bestellen: true, menge: val };
  S.warenkorb[id].menge = val;
  const inp = document.getElementById(`pm-${id}`);
  if (inp) inp.value = val;
  document.querySelectorAll(`.chip[data-id="${id}"]`).forEach(c =>
    c.classList.toggle('sel', +c.dataset.val === val)
  );
}

function updateProgress() {
  const total  = S.myArtikel.length;
  const beant  = S.myArtikel.filter(a => S.warenkorb[a.id]?.bestellen != null).length;
  const pct    = total > 0 ? Math.round((beant / total) * 100) : 0;
  document.getElementById('prog-fill').style.width  = pct + '%';
  document.getElementById('prog-text').textContent  = `${beant} / ${total} beantwortet`;
  document.getElementById('prog-pct').textContent   = pct + '%';
  document.getElementById('btn-finish').classList.toggle('hidden', beant < total || total === 0);
}

/* ── Save warenkorb item ── */
async function saveWarenkorb(artikelId) {
  if (!S.myBereichId) return;
  const item = S.warenkorb[artikelId];
  if (!item || item.bestellen == null) return;

  const artikel  = S.alleArtikel.find(a => a.id === artikelId);
  const bereich  = S.bereiche.find(b => b.id === S.myBereichId);
  const docId    = `${SID}_${S.myBereichId}_${artikelId}`;

  try {
    await setDoc(doc(db, `${getDBRoot()}/warenkorb`, docId), {
      sessionId:      SID,
      artikelId,
      artikelName:    artikel?.name ?? artikelId,
      bereichId:      S.myBereichId,
      bereichName:    bereich?.name ?? '',
      mitarbeiter:    S.user.name,
      mitarbeiterId:  S.user.id,
      bestellen:      item.bestellen,
      menge:          item.menge ?? 1,
      einheit:        artikel?.maxEinheit || artikel?.minEinheit || 'Stk',
      timestamp:      serverTimestamp(),
    }, { merge: true });
  } catch(e) {}
}

/* ── Bereich fertig ── */
function bereichFertig() {
  const btn = document.getElementById('btn-finish');
  btn.disabled = true;

  const myBereichId = S.myBereichId;
  const userName    = S.user.name;
  const userId      = S.user.id;
  const startedAt   = S.session?.bereichStatus?.[myBereichId]?.startedAt ?? null;

  if (S.session) {
    if (!S.session.bereichStatus) S.session.bereichStatus = {};
    S.session.bereichStatus[myBereichId] = {
      status: 'erledigt', mitarbeiter: userName,
      mitarbeiterId: userId, startedAt, erledigtAt: null,
    };
  }

  clearPresence();
  S.myBereichId = null; S.myArtikel = []; S.warenkorb = {};
  showScreen('wait');
  renderWait();

  updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID), {
    [`bereichStatus.${myBereichId}`]: {
      status: 'erledigt', mitarbeiter: userName,
      mitarbeiterId: userId, startedAt, erledigtAt: serverTimestamp(),
    },
    zuletzt: serverTimestamp(),
  }).catch(e => toast('Fehler beim Speichern: ' + e.message, 'error'));
}

/* ── Cancel bereich ── */
async function cancelBereich() {
  const ok = confirm('Bereich abbrechen?\n\nDein Bereich wird freigegeben, ein Kollege kann ihn fortführen.');
  if (!ok) return;
  try {
    clearPresence();
    if (S.myBereichId) {
      await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID), {
        [`bereichStatus.${S.myBereichId}.status`]: 'abgebrochen',
        zuletzt: serverTimestamp(),
      });
    }
    S.myBereichId = null; S.myArtikel = []; S.warenkorb = {};
    showScreen('join');
  } catch(e) { toast('Fehler: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════════════
   SCREEN: WARTEN
══════════════════════════════════════════════ */
function renderWait() {
  const data  = S.session;
  const bs    = data?.bereichStatus || {};

  const aktivCount    = S.bereiche.filter(b => ACTIVE_STATS.has(bs[b.id]?.status)).length;
  const erledigtCount = S.bereiche.filter(b => bs[b.id]?.status === 'erledigt').length;
  const offenCount    = S.bereiche.filter(b => {
    const s = bs[b.id]?.status;
    return !s || s === 'frei' || s === 'abgebrochen';
  }).length;

  const canFinish = S.bereiche.length > 0 && erledigtCount === S.bereiche.length;

  document.getElementById('wait-sub').textContent = aktivCount > 0
    ? `${aktivCount} Bereich${aktivCount !== 1 ? 'e' : ''} noch in Bearbeitung…`
    : offenCount > 0
      ? `Noch ${offenCount} Bereich${offenCount !== 1 ? 'e' : ''} offen`
      : 'Alle Bereiche fertig!';

  document.getElementById('btn-abschliessen').classList.toggle('hidden', !canFinish);
  document.getElementById('btn-weiterer').style.display = 'none';

  document.getElementById('wait-list').innerHTML = S.bereiche.map(b => {
    const bsEntry = bs[b.id];
    const status  = bsEntry?.status || 'frei';
    let dot, info, pickable = false;

    if (status === 'erledigt') {
      dot  = `<div class="s-dot erledigt"></div>`;
      info = `Erledigt von ${esc(bsEntry.mitarbeiter)}`;
    } else if (ACTIVE_STATS.has(status)) {
      dot  = `<span style="font-size:0.9rem;">🔒</span>`;
      info = `${esc(bsEntry?.mitarbeiter || '?')} arbeitet hier`;
    } else if (status === 'abgebrochen') {
      dot      = `<div class="s-dot abgebrochen"></div>`;
      info     = 'Abgebrochen – fortführen?';
      pickable = true;
    } else {
      dot      = `<div class="s-dot frei"></div>`;
      info     = 'Noch nicht begonnen';
      pickable = true;
    }

    const pickBtn = pickable ? `<div class="wait-row-pick">Übernehmen →</div>` : '';

    return `
      <div class="wait-row${pickable ? ' clickable' : ''}" data-bereich-id="${esc(b.id)}" data-pickable="${pickable}">
        ${dot}
        <div class="wait-row-info">
          <div class="wait-row-name">${esc(prettyName(b.name))}</div>
          <div class="wait-row-sub">${info}</div>
        </div>
        ${pickBtn}
      </div>`;
  }).join('');

  // Event delegation for wait-row clicks
  document.getElementById('wait-list').onclick = e => {
    const row = e.target.closest('.wait-row');
    if (!row || row.dataset.pickable !== 'true') return;
    pickBereich(row.dataset.bereichId);
  };

  const tlist = data?.teilnehmer || [];
  const tCard = document.getElementById('wait-teilnehmer-card');
  if (tlist.length > 0) {
    tCard.style.display = '';
    document.getElementById('wait-pills').innerHTML = tlist.map(t =>
      `<div class="name-pill">${esc(t.name)}</div>`
    ).join('');
  } else {
    tCard.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════
   SCREEN: UNTERSCHRIFT
══════════════════════════════════════════════ */
async function showSig() {
  let items = [];
  try {
    const snap = await getDocsFromServer(query(collection(db, `${getDBRoot()}/warenkorb`), where('sessionId', '==', SID)));
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  } catch(e) {
    toast('Keine Verbindung – Bestelldaten können nicht geladen werden. Bitte Internetverbindung prüfen.', 'error');
    return;
  }

  const zuBestellen = items.filter(i => i.bestellen === true);
  const teilnehmer  = S.session?.teilnehmer || [{ name: S.user.name }];
  const alleNamen   = teilnehmer.map(t => t.name).join(' · ');

  document.getElementById('sum-rows').innerHTML = `
    <div class="sum-row"><span class="sum-key">Mitarbeiter</span><span class="sum-val">${esc(alleNamen)}</span></div>
    <div class="sum-row"><span class="sum-key">Datum</span><span class="sum-val">${new Date().toLocaleDateString('de-DE')} · ${new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="sum-row"><span class="sum-key">Bereiche geprüft</span><span class="sum-val">${S.bereiche.length}</span></div>
    <div class="sum-row"><span class="sum-key">Zu bestellen</span><span class="sum-val" style="color:${zuBestellen.length > 0 ? 'var(--crit)' : 'var(--ok)'};">${zuBestellen.length} Artikel</span></div>`;

  const orderCard = document.getElementById('order-card');
  if (zuBestellen.length > 0) {
    orderCard.style.display = '';
    document.getElementById('order-body').innerHTML = zuBestellen
      .sort((a, b) => (a.bereichId || '').localeCompare(b.bereichId || '') || (a.artikelName || '').localeCompare(b.artikelName || ''))
      .map(i => `
        <tr>
          <td>${esc(i.artikelName)}</td>
          <td class="order-tbl-menge">${i.menge} ${esc(i.einheit || 'Stk')}</td>
          <td class="order-tbl-von">${esc(i.mitarbeiter)}</td>
        </tr>`).join('');
  } else {
    orderCard.style.display = 'none';
  }

  showScreen('sig');
  initCanvas();
}

/* ── Signature canvas ── */
let drawing = false, hasSig = false;
function initCanvas() {
  const canvas = document.getElementById('sig-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = canvas.parentElement.clientWidth;
  canvas.height = 160;
  hasSig = false;
  document.getElementById('sig-hint').style.opacity = '1';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#F26B2E';
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
  }
  canvas.onmousedown  = e => { drawing = true; ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y); };
  canvas.onmousemove  = e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); markSig(); };
  canvas.onmouseup    = () => { drawing = false; };
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); markSig(); }, { passive: false });
  canvas.addEventListener('touchend',   () => { drawing = false; });
}
function markSig() { hasSig = true; document.getElementById('sig-hint').style.opacity = '0'; }

function clearSig() {
  const c = document.getElementById('sig-canvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  hasSig = false; document.getElementById('sig-hint').style.opacity = '1';
}

/* ── Submit order ── */
async function submitOrder() {
  if (!hasSig) { toast('Bitte zuerst unterschreiben!', 'error'); return; }
  const btn = document.getElementById('btn-submit');
  btn.disabled = true; btn.textContent = 'Wird gespeichert…';

  try {
    const snap = await getDocsFromServer(query(collection(db, `${getDBRoot()}/warenkorb`), where('sessionId', '==', SID)));
    const allItems = [];
    snap.forEach(d => allItems.push({ id: d.id, ...d.data() }));

    const bestellItems = allItems.filter(i => i.bestellen === true);
    const teilnehmer   = S.session?.teilnehmer || [{ id: S.user.id, name: S.user.name }];

    try {
      await addDoc(collection(db, `${getDBRoot()}/bestellungen`), {
        modus:            'team',
        datum:            serverTimestamp(),
        teilnehmer,
        mitarbeiter:      teilnehmer.map(t => t.name).join(' · '),
        mitarbeiterListe: teilnehmer.map(t => t.name),
        sessionId:        SID,
        unterschrift:     document.getElementById('sig-canvas').toDataURL('image/png'),
        status:           'abgeschlossen',
        quelle:           'check',
        items:            bestellItems.map(i => ({
          artikelId:     i.artikelId,
          artikelName:   i.artikelName,
          bereichId:     i.bereichId,
          menge:         i.menge,
          einheit:       i.einheit || 'Stk',
          mitarbeiter:   i.mitarbeiter,
          mitarbeiterId: i.mitarbeiterId,
        })),
      });
    } catch(e) {
      throw new Error('Bestellung schreiben fehlgeschlagen: ' + e.message);
    }

    try {
      await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID), {
        status: 'abgeschlossen', zuletzt: serverTimestamp(),
      });
    } catch(e) {
      throw new Error('Session abschließen fehlgeschlagen: ' + e.message);
    }

    stopHeartbeatFallback();
    clearPresence();
    if (S.unsubSess) { S.unsubSess(); S.unsubSess = null; }

    try {
      const batch = writeBatch(db);
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch(e) {}

    try { await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_session`, SID)); } catch(e) {}

    toast(`✅ Abgeschlossen! ${bestellItems.length} Artikel zur Bestellung gemeldet.`, 'ok');
    setTimeout(() => { window.location.href = './mitarbeiter.html'; }, 1800);

  } catch(e) {
    btn.disabled = false; btn.textContent = '📄 Absenden & Fertig';
    toast('Fehler: ' + e.message, 'error');
  }
}

/* ── Laufband ── */
function loadLaufband() {
  onSnapshot(doc(db, `${getDBRoot()}/config`, 'app'), snap => {
    const text = snap.exists() ? (snap.data().laufband || '') : '';
    const bar  = document.getElementById('laufband-bar');
    const el   = document.getElementById('laufband-text');
    if (!text.trim()) { bar.classList.add('hidden'); return; }
    el.textContent = text;
    el.className = 'laufband-text' + (text.length > 80 ? ' long' : text.length < 30 ? ' short' : '');
    bar.classList.remove('hidden');
  });
}

/* ── Photo lightbox ── */
function openFoto(url, name) {
  const mid   = `foto-${Date.now()}`;
  const modal = document.createElement('div');
  modal.id = mid;
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:24px;overflow:hidden;max-width:440px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,.5);">
      <div style="padding:14px 18px;border-bottom:0.5px solid var(--hairline);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:14px;font-weight:600;">${esc(name)}</span>
        <button data-close-modal="${mid}" style="background:var(--surface-3);border:none;color:var(--ink-2);width:28px;height:28px;border-radius:14px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <img src="${esc(url)}" style="width:100%;max-height:70dvh;object-fit:contain;background:var(--surface-2);display:block;">
      <div style="padding:10px 16px;font-size:11px;color:var(--ink-3);font-family:var(--font-mono);text-align:center;">Soll-Zustand</div>
    </div>`;
  modal.querySelector(`[data-close-modal="${mid}"]`).addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

/* ── Wire up static buttons ── */
[
  ['btn-nav-back',        navBack],
  ['wl-nav-btn',          () => { window.location.href = 'portal.html'; }],
  ['btn-finish',          bereichFertig],
  ['btn-cancel-bereich',  cancelBereich],
  ['btn-abschliessen',    showSig],
  ['btn-weiterer',        goJoin],
  ['btn-clear-sig',       clearSig],
  ['btn-submit',          submitOrder],
  ['btn-sig-back',        () => showScreen('wait')],
].forEach(([id, fn]) => document.getElementById(id)?.addEventListener('click', fn));
