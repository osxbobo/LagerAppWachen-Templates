// ─────────────────────────────────────────────
// LAGER//APP – Login Page Logic
// ─────────────────────────────────────────────
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signInAnonymously, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, getDocs }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { app, getDBRoot, WACHEN, getActiveWache } from './firebase-config.js';
import { initTheme } from './theme.js';

// ── XSS helper ──
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeName(n) {
  return n.trim().toLowerCase().replace(/\s+/g, ' ');
}

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Zeitüberschreitung – bitte erneut versuchen')), ms))
  ]);
}

// ── Theme ──
initTheme();

// ── Wachen-Selector (Login-Seite) ──────────────────────────────────────────
(function initWachenSelector() {
  const activeId = getActiveWache() || Object.keys(WACHEN)[0];
  const selectors = [
    document.getElementById('ma-wache-select'),
    document.getElementById('dsk-ma-wache-select'),
  ].filter(Boolean);

  selectors.forEach(sel => {
    Object.values(WACHEN).forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = w.label;
      if (w.id === activeId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      localStorage.setItem('activeWache', e.target.value);
      selectors.forEach(s => { s.value = e.target.value; });
      const sub = document.getElementById('ln-desktop-wache-sub');
      if (sub) sub.textContent = WACHEN[e.target.value]?.label ?? 'Rettungswache';
    });
  });

  const sub = document.getElementById('ln-desktop-wache-sub');
  if (sub) sub.textContent = WACHEN[activeId]?.label ?? 'Rettungswache';
})();

// ── Firebase ──
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Responsive layout ──
function applyLayout() {
  const isDesktop = window.innerWidth >= 768;
  document.getElementById('ln-desktop').classList.toggle('hidden', !isDesktop);
  document.querySelector('.ln-nav').style.display         = isDesktop ? 'none' : '';
  document.querySelector('.ln-tabs').style.display        = isDesktop ? 'none' : '';
  document.querySelector('.ln-footer-note').style.display = isDesktop ? 'none' : '';
  if (!isDesktop) {
    const activeTab = document.querySelector('.ln-tab.active')?.id === 'tab-wl' ? 'wachenleiter' : 'mitarbeiter';
    document.getElementById('pane-mitarbeiter').classList.toggle('hidden', activeTab !== 'mitarbeiter');
    document.getElementById('pane-wachenleiter').classList.toggle('hidden', activeTab !== 'wachenleiter');
    document.getElementById('pane-mitarbeiter').style.display = '';
    document.getElementById('pane-wachenleiter').style.display = '';
  } else {
    document.getElementById('pane-mitarbeiter').classList.add('hidden');
    document.getElementById('pane-wachenleiter').classList.add('hidden');
  }
}
applyLayout();
window.addEventListener('resize', applyLayout);

// ── URL params ──
const params = new URLSearchParams(location.search);
const initTab = params.get('tab') || 'mitarbeiter';

function safeReturnUrl(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '';
    return url.pathname + url.search;
  } catch { return ''; }
}
const returnUrl = safeReturnUrl(params.get('return'));

// ── Pre-fill saved name ──
const savedName = localStorage.getItem('lager-saved-name') || '';
if (savedName) {
  const ma = document.getElementById('ma-name');
  if (ma) ma.value = savedName;
  const dsk = document.getElementById('dsk-ma-name');
  if (dsk) dsk.value = savedName;
}

// Auto-save name as user types
document.getElementById('ma-name')?.addEventListener('input', e => {
  localStorage.setItem('lager-saved-name', e.target.value);
});
document.getElementById('dsk-ma-name')?.addEventListener('input', e => {
  localStorage.setItem('lager-saved-name', e.target.value);
});

// ── "Eingeloggt bleiben" — restore checkbox state ──
const keepChecked = localStorage.getItem('lager-keep-login') === '1';
if (keepChecked) {
  const cbM = document.getElementById('ma-keep-login');
  const cbD = document.getElementById('dsk-keep-login');
  if (cbM) cbM.checked = true;
  if (cbD) cbD.checked = true;
}

// If already persistently logged in, skip login page
if (localStorage.getItem('lager-pin-auth') === 'true') {
  window.location.replace(returnUrl || 'mitarbeiter.html');
}

function authStore() {
  const cbM  = document.getElementById('ma-keep-login');
  const cbD  = document.getElementById('dsk-keep-login');
  const keep = (cbM?.checked || cbD?.checked);
  localStorage.setItem('lager-keep-login', keep ? '1' : '0');
  return keep ? localStorage : sessionStorage;
}

// Already logged in as non-anonymous → redirect
onAuthStateChanged(auth, async user => {
  if (user && !user.isAnonymous) {
    if (sessionStorage.getItem('lager-pin-auth') === 'true') return;
    if (localStorage.getItem('lager-pin-auth') === 'true') return;
    const role = await getRole(user.uid);
    redirectByRole(role);
  }
});

async function getRole(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data().role : 'mitarbeiter';
  } catch { return 'mitarbeiter'; }
}

function redirectByRole(role) {
  if (role === 'admin')             window.location.href = 'admin.html';
  else if (role === 'wachenleiter') window.location.href = 'portal.html';
  else signOut(auth).catch(() => {});
}

// ── Tab switching ──
function switchTab(tab) {
  document.getElementById('tab-ma').classList.toggle('active', tab === 'mitarbeiter');
  document.getElementById('tab-wl').classList.toggle('active', tab === 'wachenleiter');
  document.getElementById('pane-mitarbeiter').classList.toggle('hidden', tab !== 'mitarbeiter');
  document.getElementById('pane-wachenleiter').classList.toggle('hidden', tab !== 'wachenleiter');
}

document.getElementById('tab-ma').addEventListener('click', () => switchTab('mitarbeiter'));
document.getElementById('tab-wl').addEventListener('click', () => switchTab('wachenleiter'));

// Apply initial tab from URL param
if (initTab === 'wachenleiter') switchTab('wachenleiter');

// ── Back button ──
document.getElementById('back-btn').addEventListener('click', () => {
  window.location.href = '../index.html';
});

// ── Help Sheet ──
function showHelp() {
  document.getElementById('help-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeHelp() {
  document.getElementById('help-sheet').style.display = 'none';
  document.body.style.overflow = '';
}
document.getElementById('help-btn').addEventListener('click', showHelp);
document.getElementById('help-sheet').addEventListener('click', e => {
  if (e.target === document.getElementById('help-sheet')) closeHelp();
});
document.getElementById('help-close-btn').addEventListener('click', closeHelp);

// ══════════════════════════════════════
// MITARBEITER — PIN auth (mobile)
// ══════════════════════════════════════
let _pin = '', _attempts = 0, _lockedUntil = 0, _pinProcessing = false;

function updateDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`pd-${i}`)?.classList.toggle('filled', i < _pin.length);
  }
}

function maKey(d) {
  if (_pin.length >= 4 || _pinProcessing) return;
  _pin += d;
  updateDots();
  if (_pin.length === 4) setTimeout(maPinConfirm, 150);
}

function maDel() {
  if (_pinProcessing) return;
  _pin = _pin.slice(0, -1);
  updateDots();
}

// Event delegation on mobile numpad
document.querySelector('#pane-mitarbeiter .ln-numpad').addEventListener('click', e => {
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  const key = btn.dataset.key;
  if (key === 'del')    maDel();
  else if (key === 'cancel') window.location.href = '../index.html';
  else maKey(key);
});

async function maPinConfirm() {
  if (_pinProcessing) return;
  _pinProcessing = true;
  const errEl = document.getElementById('ma-error');
  errEl.textContent = '';

  const fail = (msg) => { errEl.textContent = msg; _pin = ''; updateDots(); };

  try {
    const name = document.getElementById('ma-name').value.trim();
    if (!name) { fail('Bitte deinen Namen eingeben'); return; }

    if (Date.now() < _lockedUntil) {
      fail(`Zu viele Versuche – bitte ${Math.ceil((_lockedUntil - Date.now()) / 1000)}s warten`); return;
    }

    if (auth.currentUser && !auth.currentUser.isAnonymous) await signOut(auth);
    if (!auth.currentUser) await signInAnonymously(auth);

    const nameKey = normalizeName(name);
    const pinHash = await sha256(_pin);
    const snap = await withTimeout(
      getDocs(query(collection(db, `${getDBRoot()}/mitarbeiter`), where('nameKey', '==', nameKey)))
    );

    let loginName = name, employeeId = null;

    if (!snap.empty) {
      const empDoc = snap.docs[0];
      if (empDoc.data().pinHash !== pinHash) {
        _attempts++;
        if (_attempts >= 5) {
          _lockedUntil = Date.now() + 60000; _attempts = 0;
          fail('Zu viele Versuche – bitte 60s warten');
        } else {
          fail(`Falscher PIN – noch ${5 - _attempts} Versuch(e)`);
        }
        return;
      }
      loginName  = empDoc.data().vorname + ' ' + empDoc.data().nachname;
      employeeId = empDoc.id;
    } else {
      fail('Name nicht gefunden – bitte beim Wachenleiter melden');
      return;
    }

    _attempts = 0;
    if (employeeId && !snap.empty) {
      const { fbEmail, fbPassword } = snap.docs[0].data();
      if (fbEmail && fbPassword) {
        if (auth.currentUser?.isAnonymous) await signOut(auth);
        await signInWithEmailAndPassword(auth, fbEmail, fbPassword);
      }
    }
    const store = authStore();
    store.setItem('lager-pin-auth', 'true');
    store.setItem('lager-pin-name', loginName);
    if (employeeId) store.setItem('lager-employee-id', employeeId);
    else store.removeItem('lager-employee-id');
    localStorage.setItem('lager-saved-name', name);
    window.location.href = returnUrl || 'mitarbeiter.html';
  } catch (e) {
    fail(e.message || 'Fehler beim Anmelden');
  } finally {
    _pinProcessing = false;
  }
}

// ══════════════════════════════════════
// MITARBEITER — PIN auth (desktop)
// ══════════════════════════════════════
let _dskPin = '', _dskAttempts = 0, _dskLockedUntil = 0, _dskPinProcessing = false;

function updateDskDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`dpd-${i}`)?.classList.toggle('filled', i < _dskPin.length);
  }
}

function dskKey(d) {
  if (_dskPin.length >= 4 || _dskPinProcessing) return;
  _dskPin += d;
  updateDskDots();
  if (_dskPin.length === 4) setTimeout(dskMaConfirm, 150);
}

function dskDel() {
  if (_dskPinProcessing) return;
  _dskPin = _dskPin.slice(0, -1); updateDskDots();
}

function dskClearPin() {
  if (_dskPinProcessing) return;
  _dskPin = ''; updateDskDots();
}

// Event delegation on desktop numpad
document.querySelector('.dsk-numpad').addEventListener('click', e => {
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  const key = btn.dataset.key;
  if (key === 'del')   dskDel();
  else if (key === 'c') dskClearPin();
  else dskKey(key);
});

// Desktop login button
document.getElementById('dsk-ma-btn').addEventListener('click', () => {
  if (_dskPin.length < 4) {
    document.getElementById('dsk-ma-error').textContent = 'Bitte 4-stelligen PIN eingeben';
    return;
  }
  dskMaConfirm();
});

async function dskMaConfirm() {
  if (_dskPinProcessing) return;
  _dskPinProcessing = true;
  const errEl = document.getElementById('dsk-ma-error');
  errEl.textContent = '';
  const btn = document.getElementById('dsk-ma-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Anmelden…';

  const fail = (msg) => { errEl.textContent = msg; _dskPin = ''; updateDskDots(); };

  try {
    const name = document.getElementById('dsk-ma-name').value.trim();
    if (!name) { fail('Bitte deinen Namen eingeben'); return; }

    if (Date.now() < _dskLockedUntil) {
      fail(`Zu viele Versuche – bitte ${Math.ceil((_dskLockedUntil - Date.now()) / 1000)}s warten`); return;
    }

    if (auth.currentUser && !auth.currentUser.isAnonymous) await signOut(auth);
    if (!auth.currentUser) await signInAnonymously(auth);

    const nameKey = normalizeName(name);
    const pinHash = await sha256(_dskPin);
    const snap = await withTimeout(
      getDocs(query(collection(db, `${getDBRoot()}/mitarbeiter`), where('nameKey', '==', nameKey)))
    );

    let loginName = name, employeeId = null;

    if (!snap.empty) {
      const empDoc = snap.docs[0];
      if (empDoc.data().pinHash !== pinHash) {
        _dskAttempts++;
        if (_dskAttempts >= 5) {
          _dskLockedUntil = Date.now() + 60000; _dskAttempts = 0;
          fail('Zu viele Versuche – bitte 60s warten');
        } else {
          fail(`Falscher PIN – noch ${5 - _dskAttempts} Versuch(e)`);
        }
        return;
      }
      loginName  = empDoc.data().vorname + ' ' + empDoc.data().nachname;
      employeeId = empDoc.id;
    } else {
      fail('Name nicht gefunden – bitte beim Wachenleiter melden');
      return;
    }

    _dskAttempts = 0;
    if (employeeId && !snap.empty) {
      const { fbEmail, fbPassword } = snap.docs[0].data();
      if (fbEmail && fbPassword) {
        if (auth.currentUser?.isAnonymous) await signOut(auth);
        await signInWithEmailAndPassword(auth, fbEmail, fbPassword);
      }
    }
    const store = authStore();
    store.setItem('lager-pin-auth', 'true');
    store.setItem('lager-pin-name', loginName);
    if (employeeId) store.setItem('lager-employee-id', employeeId);
    else store.removeItem('lager-employee-id');
    localStorage.setItem('lager-saved-name', name);
    window.location.href = returnUrl || 'mitarbeiter.html';
  } catch (e) {
    fail(e.message || 'Fehler beim Anmelden');
  } finally {
    _dskPinProcessing = false;
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="10" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2"/></svg> Anmelden';
  }
}

// ══════════════════════════════════════
// WACHENLEITER — Email/Password auth (mobile)
// ══════════════════════════════════════
document.getElementById('wl-pw-toggle').addEventListener('click', () => {
  const inp = document.getElementById('wl-password');
  const btn = document.getElementById('wl-pw-toggle');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? 'Zeigen' : 'Verbergen';
});

async function doWlLogin() {
  const email    = document.getElementById('wl-email').value.trim();
  const password = document.getElementById('wl-password').value;
  const errEl    = document.getElementById('wl-error');
  const btn      = document.getElementById('wl-login-btn');

  if (!email || !password) {
    errEl.textContent = 'Bitte E-Mail und Passwort eingeben.';
    errEl.classList.remove('hidden'); return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Anmelden…';
  errEl.classList.add('hidden');

  try {
    if (auth.currentUser?.isAnonymous) await signOut(auth);
    const cred = await withTimeout(signInWithEmailAndPassword(auth, email, password));
    sessionStorage.removeItem('lager-pin-auth');
    sessionStorage.removeItem('lager-pin-name');
    sessionStorage.removeItem('lager-employee-id');
    const role = await getRole(cred.user.uid);
    redirectByRole(role);
  } catch (e) {
    errEl.textContent = wlError(e.code);
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="10" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2"/></svg> Anmelden';
  }
}

document.getElementById('wl-login-btn').addEventListener('click', doWlLogin);
document.getElementById('wl-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doWlLogin();
});

// ══════════════════════════════════════
// WACHENLEITER — Email/Password auth (desktop)
// ══════════════════════════════════════
document.getElementById('dsk-pw-toggle').addEventListener('click', () => {
  const inp = document.getElementById('dsk-wl-password');
  const btn = document.getElementById('dsk-pw-toggle');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? 'Zeigen' : 'Verbergen';
});

async function dskWlLogin() {
  const email    = document.getElementById('dsk-wl-email').value.trim();
  const password = document.getElementById('dsk-wl-password').value;
  const errEl    = document.getElementById('dsk-wl-error');
  const btn      = document.getElementById('dsk-wl-btn');

  if (!email || !password) {
    errEl.textContent = 'Bitte E-Mail und Passwort eingeben.';
    errEl.classList.remove('hidden'); return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Anmelden…';
  errEl.classList.add('hidden');

  try {
    if (auth.currentUser?.isAnonymous) await signOut(auth);
    const cred = await withTimeout(signInWithEmailAndPassword(auth, email, password));
    sessionStorage.removeItem('lager-pin-auth');
    sessionStorage.removeItem('lager-pin-name');
    sessionStorage.removeItem('lager-employee-id');
    const role = await getRole(cred.user.uid);
    redirectByRole(role);
  } catch (e) {
    errEl.textContent = wlError(e.code);
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="10" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2"/></svg> Anmelden';
  }
}

document.getElementById('dsk-wl-btn').addEventListener('click', dskWlLogin);
document.getElementById('dsk-wl-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') dskWlLogin();
});

function wlError(code) {
  const msgs = {
    'auth/user-not-found':     'E-Mail nicht gefunden.',
    'auth/wrong-password':     'Falsches Passwort.',
    'auth/invalid-email':      'Ungültige E-Mail-Adresse.',
    'auth/too-many-requests':  'Zu viele Versuche. Bitte warte kurz.',
    'auth/invalid-credential': 'E-Mail oder Passwort falsch.',
  };
  return msgs[code] || 'Fehler beim Anmelden. Bitte erneut versuchen.';
}
