// ─────────────────────────────────────────────
// LAGER//APP – stockswipe.js  (ES-Modul)
// ─────────────────────────────────────────────
import { app, getDBRoot } from '../js/firebase-config.js';
import { initTheme, toggleTheme } from '../js/theme.js';

import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, limit, serverTimestamp, runTransaction, onSnapshot, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Theme ──────────────────────────────────── */
window._appModuleLoaded = 'stockswipe';
initTheme();
document.getElementById('theme-btn')?.addEventListener('click', toggleTheme);
document.querySelector('.m-back')?.addEventListener('click', () => { window.location.href = './mitarbeiter.html'; });
document.getElementById('wl-nav-btn')?.addEventListener('click', () => { window.location.href = 'portal.html'; });

/* ── Firebase ───────────────────────────────── */
const db = getFirestore(app);

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms)),
]);

/* ── Utilities ──────────────────────────────── */
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function prettyBereich(name) {
  return String(name ?? '').replace(/^Lager\s*[-–]\s*/i, '').trim();
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid ${type==='error'?'var(--crit)':'var(--ok)'};color:${type==='error'?'var(--crit)':'var(--ok)'};border-radius:10px;padding:10px 18px;font-size:0.82rem;box-shadow:var(--sh-3);z-index:3000;white-space:nowrap;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

/* ── State ──────────────────────────────────── */
let alleArtikel  = [];
let alleBereiche = [];
let bestellungen = {};
let userName     = '';
let employeeId   = null;
let pinValue     = '';
let pinAttempts  = 0;
let pinLockedUntil = 0;
let autoSaveId   = null;
let autoSaveTimer = null;
let sessionId    = null;
let meineBereiche = [];
let sessionUnsubscribe = null;
let soloModeActive = false;
let soloHeartbeatTimer = null;

// Swipe state
let swipeArtikel = [];
let swipeIdx     = 0;
let swipeHistory = [];
let gemerktSet   = new Set();
let currentMengeArtikel = null;
let currentMenge = 1;

const QUICK_VALUES = [1, 2, 3, 5, 10];

/* ── Natural sort ── */
function naturalSort(a, b) {
  const segA = a.split(/[\.\-]/).map(s => isNaN(s) ? s : parseInt(s, 10));
  const segB = b.split(/[\.\-]/).map(s => isNaN(s) ? s : parseInt(s, 10));
  const len  = Math.max(segA.length, segB.length);
  for (let i = 0; i < len; i++) {
    const sa = segA[i] ?? '', sb = segB[i] ?? '';
    if (sa < sb) return -1;
    if (sa > sb) return  1;
  }
  return 0;
}

/* ── Auth-Check ── */
function authGet(key) { return sessionStorage.getItem(key) || localStorage.getItem(key); }
(async function checkAuth() {
  const pinOk = authGet('lager-pin-auth');
  const name  = authGet('lager-pin-name');
  const empId = authGet('lager-employee-id');
  if (pinOk && name) {
    document.getElementById('screen-pin').classList.add('hidden');
    if (!localStorage.getItem('activeWache')) {
      window.location.replace('../index.html');
      return;
    }
    userName   = name;
    employeeId = empId || btoa(unescape(encodeURIComponent(name))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    const navUserEl = document.getElementById('nav-user');
    if (navUserEl) navUserEl.textContent = userName;
    void (async () => {
      try {
        const _auth = getAuth(app);
        const _u = await withTimeout(
          new Promise(r => { const u = onAuthStateChanged(_auth, v => { u(); r(v); }); }),
          5000
        );
        if (!_u || _u.isAnonymous) await withTimeout(signInAnonymously(_auth), 8000);
      } catch(_) {}
    })();
    try {
      await loadCheckData();
      await startDirectly();
    } catch(e) {
      console.error('Initialisierung fehlgeschlagen:', e);
      document.getElementById('screen-loading')?.remove();
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
  } else {
    const ret = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`../pages/login.html?tab=mitarbeiter&return=${ret}`);
  }
})();

/* ── PIN ── */
function handlePinKey(key) {
  document.getElementById('pin-error').textContent = '';
  if (key === 'del') {
    pinValue = pinValue.slice(0, -1);
    updateDots();
  } else if (key === 'confirm') {
    pinConfirm();
  } else {
    if (pinValue.length >= 4) return;
    pinValue += key;
    updateDots();
  }
}

function updateDots() {
  for (let i = 0; i < 4; i++)
    document.getElementById(`dot-${i}`).classList.toggle('filled', i < pinValue.length);
}

document.querySelectorAll('.pin-key').forEach(btn => {
  const key = btn.dataset.key;
  btn.addEventListener('touchstart', e => { e.preventDefault(); btn.classList.add('pressed'); handlePinKey(key); }, { passive: false });
  btn.addEventListener('touchend', () => setTimeout(() => btn.classList.remove('pressed'), 100));
  btn.addEventListener('click', () => handlePinKey(key));
});

async function pinConfirm() {
  userName = document.getElementById('name-input').value.trim();
  const err = document.getElementById('pin-error');
  if (!userName) { err.textContent = 'Bitte deinen Namen eingeben.'; return; }
  if (pinValue.length < 4) { err.textContent = 'Bitte 4-stelligen PIN eingeben.'; return; }

  if (Date.now() < pinLockedUntil) {
    const secs = Math.ceil((pinLockedUntil - Date.now()) / 1000);
    err.textContent = `Zu viele Versuche – bitte ${secs}s warten`;
    pinValue = ''; updateDots(); return;
  }

  try {
    const snap = await getDoc(doc(db, `${getDBRoot()}/config`, 'app'));
    if (snap.exists()) correctPin = snap.data().pin || '1234';
  } catch {}

  if (pinValue !== correctPin) {
    pinAttempts++;
    if (pinAttempts >= 5) {
      pinLockedUntil = Date.now() + 60000;
      pinAttempts = 0;
      err.textContent = 'Zu viele Versuche – bitte 60s warten';
    } else {
      err.textContent = `Falscher PIN – noch ${5 - pinAttempts} Versuch(e)`;
    }
    pinValue = ''; updateDots(); return;
  }
  pinAttempts = 0;

  const auth = getAuth(app);
  if (!auth.currentUser) try { await withTimeout(signInAnonymously(auth), 5000); } catch(_) {}

  document.getElementById('nav-user').textContent = userName;
  sessionStorage.setItem('lager-pin-auth', 'true');
  sessionStorage.setItem('lager-pin-name', userName);
  await loadCheckData();
  await startDirectly();
}

/* ── Auto-Save ── */
async function autoSave() {
  if (!userName) return;
  try {
    if (sessionId) {
      const sessionRef = doc(db, `${getDBRoot()}/bestellungen_session`, sessionId);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(sessionRef);
        const current = snap.exists() ? (snap.data().bestellungen || {}) : {};
        transaction.update(sessionRef, {
          bestellungen: { ...current, ...bestellungen },
          [`fortschritt_${userName}`]: Math.round((swipeIdx / Math.max(swipeArtikel.length, 1)) * 100),
          zuletzt: new Date().toISOString(),
        });
      });
    } else if (Object.keys(bestellungen).length > 0) {
      const data = {
        mitarbeiter: userName,
        datum:       new Date().toISOString(),
        status:      'pausiert',
        currentIdx:  swipeIdx,
        bestellungen,
        fortschritt: Math.round((swipeIdx / Math.max(swipeArtikel.length, 1)) * 100),
      };
      if (autoSaveId) {
        await updateDoc(doc(db, `${getDBRoot()}/bestellungen_draft`, autoSaveId), data);
      } else {
        const ref = await addDoc(collection(db, `${getDBRoot()}/bestellungen_draft`), data);
        autoSaveId = ref.id;
      }
    }
  } catch(e) { showToast('Speichern fehlgeschlagen', 'error'); }
}

function startAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(autoSave, 30000);
}

function stopAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = null;
}

/* ── Session Listener (Live-Sync) ── */
function startSessionListener() {
  if (!sessionId || sessionUnsubscribe) return;
  sessionUnsubscribe = onSnapshot(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId), (snap) => {
    if (snap.exists()) updateKollegenBar(snap.data());
  });
}

function stopSessionListener() {
  if (sessionUnsubscribe) { sessionUnsubscribe(); sessionUnsubscribe = null; }
}

function updateKollegenBar(data) {
  const bar = document.getElementById('kollegen-bar');
  const teilnehmer = data.teilnehmer || [];
  const anderen = teilnehmer.filter(t => t.name !== userName);

  if (anderen.length === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    bar.innerHTML = '<span style="color:var(--ink-3);flex-shrink:0;font-size:1rem;margin-right:2px;">👥</span>' +
      anderen.map(t => {
        const pct = data[`fortschritt_${t.name}`] ?? 0;
        const done = pct >= 100;
        return `<span style="display:inline-flex;align-items:center;gap:5px;background:${done ? 'rgba(34,197,94,0.12)' : 'var(--surface)'};border:1px solid ${done ? 'var(--ok)' : 'var(--hairline-2)'};border-radius:20px;padding:3px 10px;white-space:nowrap;">
          <span style="font-weight:600;">${esc(t.name)}</span>
          <span style="color:${done ? 'var(--ok)' : 'var(--ink-3)'};">${done ? '✓' : pct + '%'}</span>
        </span>`;
      }).join('');
  }

  const waitProgressList = document.getElementById('wait-progress-list');
  const waitAllDoneEl    = document.getElementById('wait-all-done');
  const waitSubtitle     = document.getElementById('wait-subtitle');
  if (waitProgressList && anderen.length > 0) {
    waitProgressList.innerHTML = anderen.map(t => {
      const pct  = data[`fortschritt_${t.name}`] ?? 0;
      const done = pct >= 100;
      return `<div style="display:flex;align-items:center;gap:10px;">
        <span style="font-weight:600;font-size:0.85rem;min-width:80px;text-align:left;">${esc(t.name)}</span>
        <div style="flex:1;background:var(--surface-2);border-radius:4px;height:6px;overflow:hidden;">
          <div style="width:${pct}%;background:${done ? 'var(--ok)' : 'var(--brand)'};height:100%;border-radius:4px;transition:width 0.5s;"></div>
        </div>
        <span style="font-size:0.75rem;font-family:'IBM Plex Mono',monospace;color:${done ? 'var(--ok)' : 'var(--ink-3)'};">${done ? '✓' : pct + '%'}</span>
      </div>`;
    }).join('');
  }
  const allDone = teilnehmer.length > 0 && teilnehmer.every(t => (data[`fortschritt_${t.name}`] ?? 0) >= 100);
  if (waitAllDoneEl) waitAllDoneEl.classList.toggle('hidden', !allDone);
  if (waitSubtitle) {
    const restliche = anderen.filter(t => (data[`fortschritt_${t.name}`] ?? 0) < 100);
    waitSubtitle.textContent = allDone
      ? 'Alle sind fertig! Jetzt unterschreiben.'
      : `Warte auf: ${restliche.map(t => t.name).join(', ')}...`;
  }
}

/* ── Quick Save ── */
async function quickSave(artikelId, decision) {
  if (!sessionId) return;
  try {
    const update = {
      [`fortschritt_${userName}`]: Math.round((swipeIdx / Math.max(swipeArtikel.length, 1)) * 100),
      zuletzt: new Date().toISOString(),
    };
    if (artikelId && decision !== undefined) update[`bestellungen.${artikelId}`] = decision;
    await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId), update);
  } catch(e) {}
}

/* ── Alle fertig? ── */
async function checkIfAllDone() {
  if (!sessionId) { showSignature(); return; }
  try {
    await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId), {
      erledigteBereiche: arrayUnion(...meineBereiche),
      [`fortschritt_${userName}`]: 100,
      zuletzt: new Date().toISOString(),
    });
  } catch(e) {}
  showScreen('wait');
}

/* ── Draft ── */
async function checkForDraft() {
  try {
    const snap = await getDocs(query(collection(db, `${getDBRoot()}/bestellungen_draft`), orderBy('datum', 'desc'), limit(5)));
    if (!snap.empty) showDraftBanner(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch(e) {}
}

function showDraftBanner(drafts) {
  const existing = document.getElementById('draft-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'draft-banner';
  banner.style.cssText = `position:fixed;top:56px;left:0;right:0;z-index:500;background:var(--surface);border-bottom:2px solid var(--brand);padding:12px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);`;
  banner.innerHTML = `
    <div style="font-size:0.82rem;font-weight:700;color:var(--brand);">📋 Offene Bestellung${drafts.length > 1 ? 'en' : ''}</div>
    ${drafts.map(d => `
      <div style="background:var(--surface-2);border:1px solid var(--hairline-2);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
        <div style="flex:1;">
          <div style="font-size:0.82rem;font-weight:600;">${esc(d.mitarbeiter)}</div>
          <div style="font-size:0.65rem;color:var(--ink-3);font-family:'IBM Plex Mono',monospace;margin-top:2px;">${new Date(d.datum).toLocaleDateString('de-DE')} · ${d.fortschritt||0}% fertig</div>
        </div>
        <button data-draft-resume="${esc(d.id)}" style="padding:7px 14px;border-radius:8px;background:var(--brand);border:none;color:white;font-size:0.78rem;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;touch-action:manipulation;">▶️ Fortführen</button>
        <button data-draft-discard="${esc(d.id)}" style="padding:7px 10px;border-radius:8px;background:var(--surface-2);border:1px solid var(--hairline-2);color:var(--ink-3);font-size:0.78rem;cursor:pointer;font-family:'DM Sans',sans-serif;touch-action:manipulation;">✕</button>
      </div>`).join('')}`;

  banner.addEventListener('click', e => {
    const resumeId  = e.target.closest('[data-draft-resume]')?.dataset?.draftResume;
    const discardId = e.target.closest('[data-draft-discard]')?.dataset?.draftDiscard;
    if (resumeId)  resumeDraft(resumeId);
    if (discardId) discardDraft(discardId);
  });

  document.body.appendChild(banner);
}

async function resumeDraft(id) {
  try {
    const snap = await getDoc(doc(db, `${getDBRoot()}/bestellungen_draft`, id));
    if (!snap.exists()) return;
    const data = snap.data();
    bestellungen = data.bestellungen || {};
    autoSaveId   = id;
    const banner = document.getElementById('draft-banner');
    if (banner) banner.remove();
    initSwipeMode();
    showToast(`Fortschritt von ${esc(data.mitarbeiter)} wiederhergestellt ✅`);
  } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
}

async function discardDraft(id) {
  if (!confirm('Offene Bestellung verwerfen?')) return;
  try {
    await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_draft`, id));
    const banner = document.getElementById('draft-banner');
    if (banner) banner.remove();
  } catch(e) {}
}

/* ── Stornieren ── */
async function storniereBestellung() {
  try {
    stopAutoSave();
    stopSessionListener();
    if (sessionId) {
      const sessionSnap = await getDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId));
      if (sessionSnap.exists()) {
        const sessionData  = sessionSnap.data();
        const andereAktive = (sessionData.teilnehmer || []).filter(t => t.name !== userName);
        if (andereAktive.length > 0) {
          const namen = andereAktive.map(t => t.name).join(', ');
          if (!confirm(`${namen} ${andereAktive.length === 1 ? 'arbeitet' : 'arbeiten'} noch.\n\nNur deinen Teil stornieren?`)) return;
          const vergeben   = { ...(sessionData.vergebeneBereiche || {}) };
          const teilnehmer = (sessionData.teilnehmer || []).filter(t => t.name !== userName);
          Object.keys(vergeben).forEach(bid => { if (vergeben[bid] === userName) delete vergeben[bid]; });
          await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId), { vergeben, teilnehmer });
        } else {
          if (!confirm('Lagerbestellung wirklich stornieren?')) return;
          await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId));
        }
      }
      sessionId = null; autoSaveId = null;
    } else {
      if (!confirm('Lagerbestellung wirklich stornieren?\n\nAlle bisherigen Eingaben gehen verloren.')) return;
      if (autoSaveId) { await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_draft`, autoSaveId)); autoSaveId = null; }
      await cleanupSoloSession();
    }
  } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
  window.location.href = './mitarbeiter.html';
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

async function loadCheckData() {
  try {
    const [bSnap, aSnap] = await Promise.all([
      getDocs(query(collection(db, `${getDBRoot()}/bereiche`), orderBy('reihenfolge'))),
      getDocs(collection(db, `${getDBRoot()}/artikel`)),
    ]);
    alleBereiche = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    alleArtikel  = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error('Daten laden fehlgeschlagen:', e);
  }
}

/* ══════════════════════════════════════════════
   SWIPE INIT
══════════════════════════════════════════════ */
function initSwipeMode() {
  const bereiche = meineBereiche.length > 0 ? meineBereiche : alleBereiche.map(b => b.id);
  swipeArtikel = alleArtikel
    .filter(a => bereiche.includes(a.bereich))
    .sort((a, b) => {
      const brA = alleBereiche.find(br => br.id === a.bereich);
      const brB = alleBereiche.find(br => br.id === b.bereich);
      const rA  = brA?.reihenfolge ?? 999;
      const rB  = brB?.reihenfolge ?? 999;
      if (rA !== rB) return rA - rB;
      return naturalSort(a.lp || '', b.lp || '');
    });

  swipeHistory = [];
  swipeIdx = 0;
  for (const a of swipeArtikel) {
    if (bestellungen[a.id] !== undefined) {
      swipeHistory.push({ artikel: a, direction: bestellungen[a.id].bestellen ? 'right' : 'left' });
      swipeIdx++;
    } else {
      break;
    }
  }

  document.getElementById('detail-panel').classList.add('hidden');
  document.getElementById('menge-backdrop').classList.add('hidden');
  showScreen('check');
  renderCardStack();
}

/* ── RENDER CARD STACK ── */
function renderCardStack() {
  const stack = document.getElementById('swipe-stack');
  stack.innerHTML = '';

  const total = swipeArtikel.length;
  const done  = swipeIdx;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('swipe-progress-fill').style.width = pct + '%';
  document.getElementById('swipe-progress-text').textContent = `${done} / ${total}`;

  if (done >= total) {
    const doneDiv = document.createElement('div');
    doneDiv.className = 'swipe-done';
    doneDiv.innerHTML = `
      <div class="swipe-done-icon">✅</div>
      <div class="swipe-done-title">Alle Artikel geprüft!</div>
      <div class="swipe-done-sub">Jetzt unterschreiben und absenden.</div>`;
    const doneBtn = document.createElement('button');
    doneBtn.className = 'swipe-done-btn';
    doneBtn.textContent = '✍️ Weiter zur Unterschrift';
    doneBtn.addEventListener('click', checkIfAllDone);
    doneDiv.appendChild(doneBtn);
    stack.appendChild(doneDiv);
    return;
  }

  // Back card (next article)
  if (swipeIdx + 1 < swipeArtikel.length) {
    const backCard = buildCard(swipeArtikel[swipeIdx + 1]);
    backCard.classList.add('back-card');
    stack.appendChild(backCard);
  }

  // Top card (current article)
  const topCard = buildCard(swipeArtikel[swipeIdx]);
  topCard.classList.add('top-card');
  attachSwipeHandlers(topCard, swipeArtikel[swipeIdx]);
  stack.appendChild(topCard);

  // Sync bookmark button to current article state
  const isGemerkt = gemerktSet.has(swipeArtikel[swipeIdx].id);
  const btnMerken  = document.getElementById('btn-merken');
  const iconMerken = document.getElementById('icon-merken');
  if (btnMerken && iconMerken) {
    iconMerken.setAttribute('fill', isGemerkt ? 'currentColor' : 'none');
    btnMerken.style.color = isGemerkt ? 'var(--brand)' : 'var(--ink-2)';
  }
}

/* ── BUILD CARD DOM ── */
function buildCard(artikel) {
  const card = document.createElement('div');
  card.className = 'swipe-card';

  const bereichObj  = alleBereiche.find(b => b.id === artikel.bereich);
  const bereichName = bereichObj ? prettyBereich(bereichObj.name) : '';

  const cardFoto  = artikel.stockswipeFotoUrl || artikel.fotoUrl;
  const tints = ['tint-rose','tint-blue','tint-amber','tint-violet','tint-slate','tint-green'];
  const tint  = tints[(artikel.lp || artikel.name || '').charCodeAt(0) % tints.length];
  const photoLabel = (artikel.lp || artikel.name || '?').charAt(0).toUpperCase();
  const photoHtml = cardFoto
    ? `<img class="card-photo" src="${esc(cardFoto)}" alt="${esc(artikel.name)}">`
    : `<div class="card-photo-placeholder la-photo ${tint}" style="font-size:3rem">${photoLabel}</div>`;

  const ist   = typeof artikel.ist === 'number' ? artikel.ist : null;
  const min   = artikel.min  ?? null;
  const max   = artikel.max  ?? null;
  const minUnit = artikel.minEinheit || 'Stk';
  const maxUnit = artikel.maxEinheit || artikel.minEinheit || 'Stk';
  let stockState = 'ok';
  if (ist != null && min != null) {
    if (ist < min) stockState = 'crit';
    else if (ist < min * 1.5) stockState = 'low';
  }
  const stockPct = (ist != null && max != null && max > 0) ? Math.round((ist / max) * 100) : 0;

  const bgOk   = 'var(--surface-2)';
  const bgCrit = 'var(--crit-soft,rgba(239,68,68,.08))';
  const bgLow  = 'var(--low-soft,rgba(234,179,8,.08))';
  const dataArea = `
    <div class="card-data-area">
      <div>
        <div class="card-name">${esc(artikel.name)}</div>
        <div class="card-bereich">${bereichName ? esc(bereichName) : ''}${bereichName && artikel.lp ? ' · ' : ''}${artikel.lp ? esc(artikel.lp) : ''}</div>
      </div>
      <div class="card-minmax-grid">
        <div class="card-minmax-cell" style="background:${bgOk}">
          <div class="card-minmax-lbl">MIN</div>
          <div class="card-minmax-val">${min ?? '–'}<span class="card-minmax-unit">${min != null ? minUnit : ''}</span></div>
        </div>
        <div class="card-minmax-cell" style="background:${bgOk}">
          <div class="card-minmax-lbl">MAX</div>
          <div class="card-minmax-val">${max ?? '–'}<span class="card-minmax-unit">${max != null ? maxUnit : ''}</span></div>
        </div>
        <div class="card-minmax-cell" style="background:${stockState === 'crit' ? bgCrit : stockState === 'low' ? bgLow : bgOk}">
          <div class="card-minmax-lbl" style="color:${stockState === 'crit' ? 'var(--crit)' : stockState === 'low' ? 'var(--low)' : 'var(--ink-3)'}">IST</div>
          <div class="card-minmax-val" style="color:${stockState === 'crit' ? 'var(--crit)' : stockState === 'low' ? 'var(--low)' : 'var(--ok)'}">
            ${ist ?? '–'}<span class="card-minmax-unit">${ist != null ? minUnit : ''}</span>
          </div>
        </div>
      </div>
      <div class="card-stock-bar">
        <div class="card-stock-fill ${stockState}" style="width:${stockPct}%"></div>
      </div>
      <div class="card-gesture-hints"><span>← GENUG</span><span>BESTELLEN →</span></div>
    </div>`;

  card.innerHTML = `
    <div class="card-photo-area">
      ${photoHtml}
      <div class="card-photo-badges">
        ${artikel.lp ? `<span class="card-lp-badge">${esc(artikel.lp)}</span>` : ''}
        <span class="card-state-badge ${stockState}"><span class="card-state-dot"></span>${stockState === 'crit' ? 'Kritisch' : stockState === 'low' ? 'Knapp' : 'OK'}</span>
      </div>
      <div class="card-swipe-glow right" id="glow-right-${artikel.id}"></div>
      <div class="card-swipe-glow left"  id="glow-left-${artikel.id}"></div>
      <div class="swipe-overlay swipe-overlay-right">BESTELLEN</div>
      <div class="swipe-overlay swipe-overlay-left">GENUG</div>
      <button class="card-info-btn">ⓘ</button>
    </div>
    ${dataArea}`;

  card.querySelector('.card-info-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showCardDetail(artikel);
  });

  return card;
}

/* ── SWIPE HANDLERS ── */
function attachSwipeHandlers(cardEl, artikel) {
  let startX = 0, currentX = 0, isDragging = false, startTime = 0;
  const THRESHOLD = 80;

  function snapBack() {
    cardEl.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    cardEl.style.transform  = 'translateX(0) rotate(0deg)';
    cardEl.querySelector('.swipe-overlay-right').style.opacity = 0;
    cardEl.querySelector('.swipe-overlay-left').style.opacity  = 0;
    const glowR = cardEl.querySelector('.card-swipe-glow.right');
    const glowL = cardEl.querySelector('.card-swipe-glow.left');
    if (glowR) glowR.style.opacity = 0;
    if (glowL) glowL.style.opacity = 0;
    const back = cardEl.parentElement?.querySelector('.back-card');
    if (back) { back.style.transition = 'transform 0.4s ease'; back.style.transform = 'scale(0.94) translateY(24px)'; }
  }

  cardEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card-info-btn')) return;
    isDragging = true;
    startTime  = Date.now();
    startX     = e.clientX;
    currentX   = 0;
    cardEl.setPointerCapture(e.pointerId);
    cardEl.style.transition = 'none';
  });

  cardEl.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    currentX = e.clientX - startX;
    const rotate = Math.max(-15, Math.min(15, currentX * 0.06));
    cardEl.style.transform = `translateX(${currentX}px) rotate(${rotate}deg)`;

    const ratio = Math.min(Math.abs(currentX) / 150, 1);
    cardEl.querySelector('.swipe-overlay-right').style.opacity = currentX > 0 ? ratio : 0;
    cardEl.querySelector('.swipe-overlay-left').style.opacity  = currentX < 0 ? ratio : 0;
    const glowR = cardEl.querySelector('.card-swipe-glow.right');
    const glowL = cardEl.querySelector('.card-swipe-glow.left');
    if (glowR) glowR.style.opacity = currentX > 0 ? ratio : 0;
    if (glowL) glowL.style.opacity = currentX < 0 ? ratio : 0;

    const back = cardEl.parentElement?.querySelector('.back-card');
    if (back) {
      back.style.transition = 'none';
      back.style.transform  = `scale(${0.94 + ratio * 0.06}) translateY(${24 - ratio * 24}px)`;
    }
  });

  cardEl.addEventListener('pointerup', () => {
    if (!isDragging) return;
    isDragging = false;
    const elapsed  = Math.max(Date.now() - startTime, 1);
    const velocity = Math.abs(currentX) / elapsed;
    if (Math.abs(currentX) > THRESHOLD || velocity > 0.5) {
      executeSwipe(currentX > 0 ? 'right' : 'left', artikel, cardEl);
    } else {
      snapBack();
    }
  });

  cardEl.addEventListener('pointercancel', () => { if (isDragging) { isDragging = false; snapBack(); } });
}

/* ── EXECUTE SWIPE ── */
async function executeSwipe(direction, artikel, cardEl) {
  const flyX = direction === 'right' ? window.innerWidth * 1.5 : -window.innerWidth * 1.5;
  cardEl.style.transition = 'transform 0.35s ease-out, opacity 0.3s';
  cardEl.style.transform  = `translateX(${flyX}px) rotate(${direction === 'right' ? 25 : -25}deg)`;
  cardEl.style.opacity    = '0';

  const back = document.querySelector('.back-card');
  if (back) { back.style.transition = 'transform 0.3s ease'; back.style.transform = 'scale(1) translateY(0)'; }

  swipeHistory.push({ artikel, direction });
  swipeIdx++;

  await new Promise(r => setTimeout(r, 300));

  if (direction === 'right') {
    showMengeModal(artikel);
    quickSave(null, undefined);
  } else {
    bestellungen[artikel.id] = { bestellen: false, menge: 0 };
    renderCardStack();
    quickSave(artikel.id, { bestellen: false, menge: 0 });
  }
}

function triggerSwipeLeft() {
  if (swipeIdx >= swipeArtikel.length) return;
  const top = document.querySelector('.top-card');
  if (top) executeSwipe('left', swipeArtikel[swipeIdx], top);
}

function triggerSwipeRight() {
  if (swipeIdx >= swipeArtikel.length) return;
  const top = document.querySelector('.top-card');
  if (top) executeSwipe('right', swipeArtikel[swipeIdx], top);
}

function undoLastSwipe() {
  if (swipeHistory.length === 0) { showToast('Nichts zum Rückgängigmachen', 'error'); return; }
  document.getElementById('menge-backdrop').classList.add('hidden');
  const last = swipeHistory.pop();
  swipeIdx--;
  delete bestellungen[last.artikel.id];
  renderCardStack();
  showToast('Rückgängig gemacht');
}

function merkenArtikel() {
  if (swipeIdx >= swipeArtikel.length) return;
  const artikel = swipeArtikel[swipeIdx];
  const btn  = document.getElementById('btn-merken');
  const icon = document.getElementById('icon-merken');
  if (gemerktSet.has(artikel.id)) {
    gemerktSet.delete(artikel.id);
    if (icon) icon.setAttribute('fill', 'none');
    if (btn)  btn.style.color = 'var(--ink-2)';
    showToast('Merker entfernt');
  } else {
    gemerktSet.add(artikel.id);
    if (icon) icon.setAttribute('fill', 'currentColor');
    if (btn)  btn.style.color = 'var(--brand)';
    showToast(`${artikel.name} gemerkt ✓`);
  }
}

/* ── DETAIL VIEW ── */
function showCardDetail(artikel) {
  const bereichObj  = alleBereiche.find(b => b.id === artikel.bereich);
  document.getElementById('detail-title-text').textContent = artikel.name;

  let html = '';

  if (artikel.lagerFotoUrl) {
    html += `<div class="detail-section-label">Lagerort</div>
             <img class="detail-lagerfoto" src="${esc(artikel.lagerFotoUrl)}" alt="Lagerort">`;
  }

  if (artikel.min != null || artikel.max != null) {
    html += `<div class="detail-section-label">Bestand</div><div class="minmax-row">`;
    if (artikel.min != null) html += `
      <div class="minmax-badge min">
        <span class="minmax-label">MIN</span>
        <span class="minmax-value">${artikel.min}</span>
        <span class="minmax-unit">${esc(artikel.minEinheit || 'Stk')}</span>
      </div>`;
    if (artikel.max != null) html += `
      <div class="minmax-badge max">
        <span class="minmax-label">MAX</span>
        <span class="minmax-value">${artikel.max}</span>
        <span class="minmax-unit">${esc(artikel.maxEinheit || 'Stk')}</span>
      </div>`;
    html += `</div>`;
  }

  if (artikel.hinweis) {
    html += `<div class="detail-section-label">Hinweis</div>
             <div style="background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.25);border-radius:12px;padding:13px 15px;font-size:0.85rem;color:var(--ink-2);line-height:1.5;">
               💡 ${esc(artikel.hinweis)}
             </div>`;
  }

  if (artikel.lp || bereichObj) {
    html += `<div class="detail-section-label">Position</div>
             <div style="font-family:'IBM Plex Mono',monospace;font-size:0.9rem;">
               ${artikel.lp ? esc(artikel.lp) : ''}${artikel.lp && bereichObj ? ' · ' : ''}${bereichObj ? esc(prettyBereich(bereichObj.name)) : ''}
             </div>`;
  }

  if (!html) {
    html = `<div style="text-align:center;padding:40px 20px;color:var(--ink-3);font-size:0.88rem;">Keine weiteren Infos vorhanden</div>`;
  }

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail-panel').classList.remove('hidden');
}

function hideCardDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
}

/* ── MENGE MODAL ── */
function showMengeModal(artikel) {
  currentMengeArtikel = artikel;
  currentMenge = 1;

  const maxOrder = artikel.max != null ? artikel.max : null;
  const unit     = artikel.maxEinheit || artikel.minEinheit || 'Stk';

  const title = artikel.name.length > 30 ? artikel.name.slice(0, 28) + '…' : artikel.name;
  document.getElementById('menge-sheet-title').textContent = `Wie viel „${title}" bestellen?`;

  let subtitle = document.getElementById('menge-sheet-subtitle');
  if (!subtitle) {
    subtitle = document.createElement('div');
    subtitle.id = 'menge-sheet-subtitle';
    subtitle.style.cssText = 'text-align:center;font-size:0.78rem;color:var(--ink-3);font-family:\'IBM Plex Mono\',monospace;margin-top:-8px;';
    document.getElementById('menge-sheet-title').after(subtitle);
  }
  subtitle.textContent = maxOrder != null
    ? `Einheit: ${unit} · max. ${maxOrder} ${unit}`
    : `Einheit: ${unit}`;

  const chipsHtml = QUICK_VALUES.filter(v => maxOrder == null || v <= maxOrder).map(v =>
    `<div class="chip ${v === 1 ? 'selected' : ''}" data-val="${v}">${v}</div>`
  ).join('');
  document.getElementById('swipe-chips-row').innerHTML = chipsHtml;
  const inp = document.getElementById('pm-swipe-input');
  inp.value = 1;
  if (maxOrder != null) inp.max = maxOrder; else inp.removeAttribute('max');

  document.querySelectorAll('#swipe-chips-row .chip').forEach(chip => {
    function handleChip() {
      currentMenge = parseInt(chip.dataset.val);
      document.getElementById('pm-swipe-input').value = currentMenge;
      document.querySelectorAll('#swipe-chips-row .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    }
    chip.addEventListener('touchstart', e => { e.preventDefault(); handleChip(); }, { passive: false });
    chip.addEventListener('click', handleChip);
  });

  document.getElementById('menge-backdrop').classList.remove('hidden');

  const confirmBtn = document.getElementById('menge-confirm-btn');
  confirmBtn.disabled = true;
  if (confirmBtn._touchHandler) confirmBtn.removeEventListener('touchstart', confirmBtn._touchHandler);
  confirmBtn._touchHandler = (e) => { e.preventDefault(); confirmMenge(); };
  confirmBtn.addEventListener('touchstart', confirmBtn._touchHandler, { passive: false });
  setTimeout(() => { confirmBtn.disabled = false; }, 350);
}

function pmAction(action) {
  const input  = document.getElementById('pm-swipe-input');
  const cur    = parseInt(input.value) || 1;
  const maxVal = input.max ? parseInt(input.max) : Infinity;
  currentMenge = action === 'plus' ? Math.min(maxVal, cur + 1) : Math.max(1, cur - 1);
  input.value  = currentMenge;
  document.querySelectorAll('#swipe-chips-row .chip').forEach(c => {
    c.classList.toggle('selected', parseInt(c.dataset.val) === currentMenge);
  });
}

function confirmMenge() {
  const input  = document.getElementById('pm-swipe-input');
  const maxVal = input.max ? parseInt(input.max) : Infinity;
  currentMenge = Math.min(maxVal, Math.max(1, parseInt(input.value) || 1));
  if (currentMengeArtikel) {
    bestellungen[currentMengeArtikel.id] = { bestellen: true, menge: currentMenge };
    quickSave(currentMengeArtikel.id, { bestellen: true, menge: currentMenge });
  }
  document.getElementById('menge-backdrop').classList.add('hidden');
  renderCardStack();
}

/* ── SIGNATURE ── */
function showSignature() {
  const zuBestellen = Object.entries(bestellungen).filter(([, v]) => v.bestellen === true);
  const bearbeitet  = Object.keys(bestellungen).length;
  document.getElementById('summary-grid').innerHTML = `
    <div class="summary-row"><span class="summary-key">Mitarbeiter</span><span class="summary-val">${esc(userName)}</span></div>
    <div class="summary-row"><span class="summary-key">Datum</span><span class="summary-val">${new Date().toLocaleDateString('de-DE')} · ${new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="summary-row"><span class="summary-key">Bearbeitet</span><span class="summary-val">${bearbeitet} / ${swipeArtikel.length} Artikel</span></div>
    <div class="summary-row"><span class="summary-key">Zu bestellen</span><span class="summary-val" style="color:${zuBestellen.length>0?'var(--crit)':'var(--ok)'}">${zuBestellen.length} Artikel</span></div>`;
  showScreen('sig');
  initCanvas();
}

function backToCheck() {
  showScreen('check');
  renderCardStack();
}

/* ── CANVAS ── */
let drawing = false, hasSig = false;
function initCanvas() {
  const canvas = document.getElementById('sig-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = canvas.parentElement.clientWidth;
  canvas.height = 160;
  hasSig = false;
  document.getElementById('sig-hint').style.opacity = '1';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX-r.left)*(canvas.width/r.width), y: (t.clientY-r.top)*(canvas.height/r.height) };
  }
  canvas.addEventListener('mousedown',  e => { drawing=true; ctx.beginPath(); const p=getPos(e); ctx.moveTo(p.x,p.y); });
  canvas.addEventListener('mousemove',  e => { if(!drawing)return; const p=getPos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); hasSig=true; document.getElementById('sig-hint').style.opacity='0'; });
  canvas.addEventListener('mouseup',    ()=>drawing=false);
  canvas.addEventListener('mouseleave', ()=>drawing=false);
  canvas.addEventListener('touchstart', e=>{ e.preventDefault(); drawing=true; ctx.beginPath(); const p=getPos(e); ctx.moveTo(p.x,p.y); },{passive:false});
  canvas.addEventListener('touchmove',  e=>{ e.preventDefault(); if(!drawing)return; const p=getPos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); hasSig=true; document.getElementById('sig-hint').style.opacity='0'; },{passive:false});
  canvas.addEventListener('touchend',   ()=>drawing=false);
}

function clearSig() {
  const c = document.getElementById('sig-canvas');
  c.getContext('2d').clearRect(0,0,c.width,c.height);
  hasSig=false;
  document.getElementById('sig-hint').style.opacity='1';
}

/* ── SUBMIT ── */
async function submitCheck() {
  if (!hasSig) { alert('Bitte zuerst unterschreiben!'); return; }

  const nachbestellungen = alleArtikel
    .filter(a => bestellungen[a.id]?.bestellen === true)
    .map(a => ({ id: a.id, name: a.name, location: a.location, lp: a.lp, menge: bestellungen[a.id].menge, einheit: a.maxEinheit || a.minEinheit || 'Stk' }));

  try {
    stopAutoSave();
    stopSessionListener();
    let alleNamen = [userName];

    if (sessionId) {
      const sessionSnap = await getDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId));
      const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};
      const alleBestellungen = { ...(sessionData.bestellungen || {}), ...bestellungen };
      const alleNachbest = alleArtikel
        .filter(a => alleBestellungen[a.id]?.bestellen === true)
        .map(a => ({ id: a.id, name: a.name, location: a.location, lp: a.lp, menge: alleBestellungen[a.id].menge, einheit: a.maxEinheit || a.minEinheit || 'Stk' }));
      alleNamen = (sessionData.teilnehmer || [{ name: userName }]).map(t => t.name);
      await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId), { status: 'abgeschlossen', abgeschlossen: new Date().toISOString() });
      await addDoc(collection(db, `${getDBRoot()}/bestellungen`), {
        mitarbeiter: alleNamen.join(' · '), mitarbeiterListe: alleNamen,
        datum: serverTimestamp(), bestellungen: alleBestellungen,
        nachbestellungen: alleNachbest, unterschrift: document.getElementById('sig-canvas').toDataURL('image/png'),
        status: 'abgeschlossen', sessionId, quelle: 'stockswipe',
      });
      try { await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_session`, sessionId)); } catch(e) {}
    } else {
      await addDoc(collection(db, `${getDBRoot()}/bestellungen`), {
        mitarbeiter: userName, mitarbeiterListe: [userName],
        datum: serverTimestamp(), bestellungen, nachbestellungen,
        unterschrift: document.getElementById('sig-canvas').toDataURL('image/png'),
        status: 'abgeschlossen', quelle: 'stockswipe',
      });
      await cleanupSoloSession();
    }

    if (autoSaveId && !sessionId) {
      try { await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_draft`, autoSaveId)); } catch(e) {}
    }

    autoSaveId = null; sessionId = null;
    alert(`✅ StockSwipe abgeschlossen!\n\n${nachbestellungen.length} Artikel wurden zur Bestellung gemeldet.`);
    window.location.href = './mitarbeiter.html';
  } catch(e) { alert('Fehler: ' + e.message); }
}

/* ── BLOCK-SCREEN ── */
let blockUnsubscribe = null;

async function checkForActiveCheckSession() {
  try {
    const snap = await getDoc(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'));
    if (snap.exists() && snap.data().status === 'aktiv') {
      const data = snap.data();
      const modus = data.modus || 'team';

      const heartbeats = data.heartbeats ?? {};
      const hasAliveUser = Object.values(heartbeats).some(ts => {
        const lastBeat = ts?.toMillis?.() ?? 0;
        return lastBeat > 0 && (Date.now() - lastBeat) < 90_000;
      });

      if (!hasAliveUser) {
        try { await deleteDoc(snap.ref); } catch(e2) {}
        return false;
      }

      if (modus === 'solo') {
        if (data.mitarbeiterId === employeeId) return false;
        showBlockScreen('current', data, 'solo');
        return true;
      }

      showBlockScreen('current', data, 'team');
      return true;
    }
  } catch(e) {}
  return false;
}

function showBlockScreen(sid, data, modus) {
  let infoHtml;
  if (modus === 'solo') {
    const name = data.mitarbeiter || 'Ein Kollege';
    infoHtml = `<strong>${esc(name)}</strong> macht gerade die Lagerbestellung (StockSwipe).<br>Bitte warten bis abgeschlossen.`;
  } else {
    const namen = (data.teilnehmer || []).map(t => t.name).join(', ') || 'Ein Kollege';
    const offen = Object.values(data.bereichStatus || {}).filter(v => v.status !== 'erledigt' && v.status !== 'abgebrochen').length;
    infoHtml = `<strong>${esc(namen)}</strong> macht gerade die Lagerbestellung (Team).<br>
       ${offen} Bereich${offen !== 1 ? 'e' : ''} noch offen.`;
  }
  document.getElementById('block-session-info').innerHTML = infoHtml;

  ['pin','join','check','sig','wait'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.add('hidden');
  });
  document.getElementById('screen-loading')?.remove();
  document.getElementById('screen-blocked').classList.remove('hidden');

  if (blockUnsubscribe) blockUnsubscribe();
  blockUnsubscribe = onSnapshot(doc(db, `${getDBRoot()}/bestellungen_session`, sid), snap => {
    if (!snap.exists() || snap.data().status !== 'aktiv') {
      if (blockUnsubscribe) { blockUnsubscribe(); blockUnsubscribe = null; }
      document.getElementById('screen-blocked').classList.add('hidden');
      document.getElementById('screen-pin').classList.remove('hidden');
      showToast('Lagerbestellung abgeschlossen – StockSwipe ist wieder verfügbar ✅');
    }
  });
}

function startSoloHeartbeat() {
  stopSoloHeartbeat();
  soloHeartbeatTimer = setInterval(async () => {
    try {
      await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'), {
        [`heartbeats.${employeeId}`]: serverTimestamp(),
        zuletzt: serverTimestamp(),
      });
    } catch(e) {}
  }, 15_000);
}

function stopSoloHeartbeat() {
  if (soloHeartbeatTimer) { clearInterval(soloHeartbeatTimer); soloHeartbeatTimer = null; }
}

async function cleanupSoloSession() {
  if (!soloModeActive) return;
  soloModeActive = false;
  stopSoloHeartbeat();
  try {
    await updateDoc(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'), { status: 'abgeschlossen' });
  } catch(e) {}
}

/* ── DIREKT STARTEN ── */
async function startDirectly() {
  try {
    const auth = getAuth(app);
    if (!auth.currentUser) {
      try {
        const _authUser = await withTimeout(
          new Promise(r => { const u = onAuthStateChanged(auth, v => { u(); r(v); }); }),
          5000
        );
        if (!_authUser || _authUser.isAnonymous) await withTimeout(signInAnonymously(auth), 8000);
      } catch(_) {}
    }

    const blocked = await checkForActiveCheckSession();
    if (blocked) return;

    await setDoc(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'), {
      status: 'aktiv',
      modus: 'solo',
      mitarbeiter: userName,
      mitarbeiterId: employeeId,
      startzeit: serverTimestamp(),
      zuletzt: serverTimestamp(),
      heartbeats: { [employeeId]: serverTimestamp() },
    });
    soloModeActive = true;
    startSoloHeartbeat();

    meineBereiche = alleBereiche.map(b => b.id);
    loadLaufband();
    await checkForDraft();
    initSwipeMode();
    startAutoSave();
  } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
}

window.addEventListener('beforeunload', () => {
  if (soloModeActive) {
    navigator.sendBeacon && navigator.sendBeacon('', '');
    cleanupSoloSession().catch(() => {});
  }
});

function showScreen(name) {
  document.getElementById('screen-loading')?.remove();
  ['pin','join','check','sig','wait'].forEach(s =>
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name)
  );
}

/* ── Wire up static buttons ── */
document.getElementById('btn-swipe-left-small').addEventListener('click', triggerSwipeLeft);
document.getElementById('btn-undo').addEventListener('click', undoLastSwipe);
document.getElementById('btn-nein').addEventListener('click', triggerSwipeLeft);
document.getElementById('btn-ja').addEventListener('click', triggerSwipeRight);
document.getElementById('btn-merken').addEventListener('click', merkenArtikel);
document.getElementById('btn-scanner').addEventListener('click', () => { window.location.href = 'scanner.html'; });
document.getElementById('btn-stornieren').addEventListener('click', storniereBestellung);
document.getElementById('btn-detail-back').addEventListener('click', hideCardDetail);
document.getElementById('btn-pm-minus').addEventListener('click', () => pmAction('minus'));
document.getElementById('btn-pm-plus').addEventListener('click', () => pmAction('plus'));
document.getElementById('menge-confirm-btn').addEventListener('click', confirmMenge);
document.getElementById('btn-clear-sig').addEventListener('click', clearSig);
document.getElementById('btn-submit-check').addEventListener('click', submitCheck);
document.getElementById('btn-back-to-check').addEventListener('click', backToCheck);
document.getElementById('btn-block-back').addEventListener('click', () => { window.location.href = './mitarbeiter.html'; });
document.getElementById('btn-wait-sig').addEventListener('click', showSignature);
