// ─────────────────────────────────────────────
// LAGER//APP – Mitarbeiter Page Logic
// ─────────────────────────────────────────────
import {
  collection, query, orderBy, limit, where, onSnapshot, getDocs, getDoc, doc, updateDoc, writeBatch, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { app, getDBRoot } from './firebase-config.js';
import { initTheme, toggleTheme as _toggleTheme } from './theme.js';

// ── XSS helper ──
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Crypto helper ──
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Firebase setup ──
const db = getFirestore(app);
const auth = getAuth(app);

// Wait for Firebase to restore session before signing in anonymously
const _unsubAuthInit = onAuthStateChanged(auth, user => {
  _unsubAuthInit();
  if (!user) signInAnonymously(auth).catch(() => {});
});

// ── Theme ──
initTheme();

// theme.js looks for id="theme-toggle"; mitarbeiter uses id="theme-btn"
// so we expose toggleTheme on click and update the icon manually here too.
const themeBtn = document.getElementById('theme-btn');
if (themeBtn) {
  // Set initial icon based on current theme
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  themeBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  themeBtn.addEventListener('click', () => {
    _toggleTheme();
    const t = document.documentElement.getAttribute('data-theme') || 'dark';
    themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  });
}

// ── KW ──
(function () {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const kw = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  document.getElementById('kw-label').textContent = 'KW ' + kw;
})();

// ── Auth helpers ──
function authGet(key) { return sessionStorage.getItem(key) || localStorage.getItem(key); }

// ── Auth state UI ──
const pinAuth = authGet('lager-pin-auth');
const pinName = authGet('lager-pin-name') || '';

if (pinAuth === 'true' && pinName) {
  document.getElementById('user-name').textContent = esc(pinName) + '.';
  const initials = pinName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarEl = document.getElementById('auth-avatar');
  const storedAvatar = localStorage.getItem('lager-avatar-url') || sessionStorage.getItem('lager-avatar-url');
  if (storedAvatar) {
    avatarEl.innerHTML = `<img src="${esc(storedAvatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;
  } else {
    avatarEl.textContent = initials;
  }
  document.getElementById('auth-name-label').textContent = 'Angemeldet als ' + esc(pinName);
  document.getElementById('auth-status-text').textContent = 'PIN aktiv · Foto tippen zum Ändern';
  document.getElementById('auth-signed-in').classList.remove('hidden');
  document.getElementById('auth-guest').classList.add('hidden');
  document.getElementById('activity-section').classList.remove('hidden');
  if (authGet('lager-employee-id')) {
    document.getElementById('change-pin-btn').classList.remove('hidden');
  }
} else {
  document.getElementById('user-name').textContent = 'Gast.';
  document.getElementById('auth-signed-in').classList.add('hidden');
  document.getElementById('auth-guest').classList.remove('hidden');
}

// ── WL-Button (show when PIN-auth but no WL login) ──
(function () {
  const role  = sessionStorage.getItem('lager-portal-role');
  const pinOk = authGet('lager-pin-auth');
  const btn   = document.getElementById('wl-nav-btn');
  if (btn && !role && pinOk === 'true') btn.style.display = 'inline-flex';
})();

// ── Panel-Back-Button ──
(function () {
  const role = sessionStorage.getItem('lager-portal-role');
  if (!role) return;
  const btn = document.getElementById('panel-back-btn');
  btn.href = role === 'admin' ? 'admin.html' : 'portal.html';
  btn.textContent = '';
  btn.insertAdjacentHTML('afterbegin',
    '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="13" rx="2"/><path d="M6 7h8M6 10h5"/></svg> ' +
    (role === 'admin' ? 'Admin' : 'Wachenleiter')
  );
  btn.style.display = 'inline-flex';
})();

// ── Back button ──
document.querySelector('.m-back').addEventListener('click', () => {
  window.location.href = '../index.html';
});

// ── Logout ──
function doLogout() {
  ['lager-pin-auth', 'lager-pin-name', 'lager-employee-id'].forEach(k => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  });
  localStorage.removeItem('lager-keep-login');
  localStorage.removeItem('lager-saved-name');
  window.location.href = '../index.html';
}

document.querySelectorAll('[data-action="logout"]').forEach(el => {
  el.addEventListener('click', doLogout);
});

// ── Protected nav ──
function guardedNav(href, context) {
  if (authGet('lager-pin-auth') === 'true') {
    window.location.href = href;
  } else {
    openLoginWall(context, href);
  }
}

document.querySelectorAll('[data-guarded]').forEach(el => {
  el.addEventListener('click', () => guardedNav(el.dataset.href, el.dataset.guardContext));
});

// ── Login Wall ──
function openLoginWall(context, returnUrl) {
  document.getElementById('lw-context').textContent = context || 'für diese Aktion';
  const ret = returnUrl ? encodeURIComponent(returnUrl) : '';
  document.getElementById('lw-btn').href =
    'login.html?tab=mitarbeiter' + (ret ? '&return=' + ret : '');
  document.getElementById('login-wall').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeLoginWall() {
  document.getElementById('login-wall').style.display = 'none';
  document.body.style.overflow = '';
}

document.getElementById('login-wall').addEventListener('click', e => {
  if (e.target === document.getElementById('login-wall')) closeLoginWall();
});
document.getElementById('lw-cancel-btn').addEventListener('click', closeLoginWall);

// ── Resume Draft ──
document.getElementById('draft-banner').addEventListener('click', () => {
  const id = document.getElementById('draft-banner').dataset.draftId;
  if (id) window.location.href = 'check.html?resumeDraft=' + id;
});

// ── Help Overlay ──
const HELP_DATA = {
  lagersuche: {
    title: 'Lagersuche', icon: '🔍',
    steps: [
      'Öffne die LAGER//APP — du landest automatisch auf der Lagersuche.',
      'Tippe einen Artikelnamen, einen Alias oder die Lagerplatznummer (z. B. „S.2.1") in die Suchleiste ein.',
      'Die Treffer erscheinen sofort darunter. Tippe auf einen Artikel, um Details wie Standort, Menge, MIN und MAX zu sehen.',
      'Mit dem Kamera-Symbol kannst du ein Foto des Artikels oder des Lagerortes aufrufen.',
      'Tipp: Die Suche kennt auch Alternativnamen (z. B. „Verbandsmull" statt des offiziellen Namens).',
    ]
  },
  verfallsmonitor: {
    title: 'Verfallsmonitor', icon: '⏳',
    steps: [
      'Melde dich mit Name und PIN an, dann tippe auf „Verfallsmonitor" im Hauptmenü.',
      'Du siehst alle erfassten Chargen sortiert nach Ablaufdatum — zuerst die kritischsten.',
      'Rote Einträge laufen in ≤ 30 Tagen ab, grüne sind noch lange haltbar.',
      'Tippe auf den Filter oben, um nur kritische oder nur sichere Chargen anzuzeigen.',
      'Eine Charge abgelaufen? Tippe auf das ✕ um sie zu entfernen, nachdem du sie aus dem Lager genommen hast.',
    ]
  },
  lagerbestellung: {
    title: 'Lagerbestellung (Multi)', icon: '📋',
    steps: [
      'Melde dich mit Name und PIN an, dann tippe auf „Lagerbestellung" im Hauptmenü.',
      'Wähle deinen Bereich (z. B. „Schrank 3"). Mehrere Kollegen können gleichzeitig verschiedene Bereiche bearbeiten.',
      'Für jeden Artikel siehst du IST-, MIN- und MAX-Menge. Tippe „Bestellen" wenn nachbestellt werden muss, oder „Ausreichend" wenn alles OK ist.',
      'Bei „Bestellen": Gib die gewünschte Menge ein (Chips oder + / − ) und tippe „Bereich fertig markieren".',
      'Sobald alle Bereiche erledigt sind, erscheint „Abschließen & Unterschrift". Unterschreibe und tippe „Absenden & Fertig".',
      'Die Bestellung wird gespeichert und ist im Wachenleiter-Portal sichtbar.',
    ]
  },
  stockswipe: {
    title: 'StockSwipe', icon: '👆',
    steps: [
      'Melde dich mit Name und PIN an, dann tippe auf „StockSwipe" im Hauptmenü.',
      'Dir werden Artikelkarten einzeln angezeigt. Jede Karte zeigt Foto, Name, Lagerplatz und aktuellen Bestand.',
      'Wische die Karte nach RECHTS (oder tippe ✓) wenn der Artikel ausreichend vorhanden ist.',
      'Wische die Karte nach LINKS (oder tippe 🛒) wenn der Artikel bestellt werden muss. Du kannst dann die Menge angeben.',
      'Am Ende: Unterschreibe und tippe „Absenden". Die Bestellliste wird automatisch gespeichert.',
      'Tipp: Bei einem Tipp auf die Karte öffnen sich Details mit MIN/MAX-Angaben.',
    ]
  },
  verfallscan: {
    title: 'Verfallsscan', icon: '📷',
    steps: [
      'Melde dich mit Name und PIN an, dann tippe auf „Verfallsscan" im Hauptmenü.',
      'Erlaube den Kamerazugriff, wenn der Browser danach fragt.',
      'Halte den Barcode oder QR-Code eines Artikels vor die Kamera — er wird automatisch erkannt.',
      'Gib das Verfallsdatum und die LOT-Nummer ein und tippe „Speichern".',
      'Die Charge ist jetzt im Verfallsmonitor sichtbar und wird rechtzeitig als Warnung angezeigt.',
    ]
  },
  pin: {
    title: 'PIN ändern', icon: '🔑',
    steps: [
      'Du musst mit Name und PIN angemeldet sein. Scrolle auf dieser Seite nach unten zum Bereich „Angemeldet als …".',
      'Tippe auf „PIN ändern".',
      'Gib zuerst deinen aktuellen (alten) PIN ein.',
      'Gib danach deinen neuen 4-stelligen PIN ein.',
      'Bestätige den neuen PIN durch erneute Eingabe.',
      'Du bekommst eine Bestätigung — ab sofort gilt der neue PIN.',
      'Wichtig: Den neuen PIN gut merken! Bei Vergessen musst du den Wachenleiter um einen Reset bitten.',
    ]
  },
};

let helpImages  = {};
let helpContent = {};

function openHelp(id) {
  const d = HELP_DATA[id];
  if (!d) return;
  document.getElementById('help-icon').textContent  = d.icon;
  document.getElementById('help-title').textContent = d.title;
  const steps = (helpContent[id] && helpContent[id].length) ? helpContent[id] : d.steps;
  const ol = document.getElementById('help-steps');
  ol.innerHTML = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'help-step';
    li.innerHTML = `<span class="help-step-num">${i + 1}</span><span class="help-step-text">${esc(s)}</span>`;
    ol.appendChild(li);
  });
  const imgUrl = helpImages[id];
  const wrap = document.getElementById('help-image-wrap');
  if (imgUrl) {
    document.getElementById('help-image').src = imgUrl;
    wrap.style.display = '';
  } else {
    wrap.style.display = 'none';
  }
  document.getElementById('help-overlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeHelp() {
  document.getElementById('help-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

document.getElementById('help-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('help-overlay')) closeHelp();
});
document.getElementById('help-close-btn').addEventListener('click', closeHelp);

// Tutorial items delegation
document.querySelector('.m-tutorial-card').addEventListener('click', e => {
  const item = e.target.closest('[data-help]');
  if (item) openHelp(item.dataset.help);
});

// ── Firebase realtime data ──

// Help-Daten laden (fire-and-forget)
getDoc(doc(db, `${getDBRoot()}/config`, 'help_images')).then(snap => {
  if (snap.exists()) helpImages = snap.data();
}).catch(() => {});
getDoc(doc(db, `${getDBRoot()}/config`, 'help_content')).then(snap => {
  if (snap.exists()) helpContent = snap.data();
}).catch(() => {});

// Laufband
onSnapshot(doc(db, `${getDBRoot()}/config`, 'app'), snap => {
  const text = snap.exists() ? (snap.data().laufband || '') : '';
  const bar  = document.getElementById('laufband-bar');
  const el   = document.getElementById('laufband-text');
  if (!text.trim()) { bar.classList.add('hidden'); return; }
  el.textContent = text;
  el.className = 'laufband-text' + (text.length > 80 ? ' long' : text.length < 30 ? ' short' : '');
  bar.classList.remove('hidden');
}, () => {});

// Live session
onSnapshot(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'), snap => {
  const pill   = document.getElementById('session-pill');
  const textEl = document.getElementById('session-text');
  const subEl  = document.getElementById('session-sub');
  if (snap.exists() && snap.data().status === 'aktiv') {
    const s = snap.data();
    const namen = (s.teilnehmer || []).map(t => t.name).join(', ');
    textEl.textContent = namen
      ? namen + ' mach' + (namen.includes(',') ? 'en' : 't') + ' gerade die Lagerbestellung'
      : 'Lagerbestellung läuft';
    const free = Object.values(s.bereichStatus || {}).filter(b => b.status === 'frei').length;
    subEl.textContent = free > 0 ? free + ' Bereiche frei' : 'Alle Bereiche vergeben';
    pill.classList.remove('hidden');
  } else {
    pill.classList.add('hidden');
  }
}, () => {});

// Letzte Aktivität (last 5 Bestellungen)
(async () => {
  if (!auth.currentUser) {
    await new Promise(resolve => {
      let unsub;
      const timer = setTimeout(() => { if (unsub) unsub(); resolve(); }, 6000);
      unsub = onAuthStateChanged(auth, u => {
        if (u) { clearTimeout(timer); unsub(); resolve(); }
      });
    });
  }

  const list = document.getElementById('activity-list');
  try {
    const q    = query(collection(db, `${getDBRoot()}/bestellungen`), orderBy('datum', 'desc'), limit(5));
    const snap = await getDocs(q);
    if (!snap.empty) {
      list.innerHTML = snap.docs.map(d => {
        const b  = d.data();
        const dt = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum || 0);
        const rel = relTime(dt);
        const orderCount = b.items?.length ?? b.nachbestellungen?.filter(n => n.menge > 0)?.length ?? 0;
        const source = b.quelle === 'stockswipe' ? 'StockSwipe' : 'Lagerbestellung';
        const tone   = orderCount > 0 ? 'crit' : 'ok';
        const icon   = orderCount > 0 ? orderCount : '✓';
        return `<div class="m-activity-row">
          <div class="m-activity-chip ${esc(tone)}">${esc(String(icon))}</div>
          <div style="flex:1;min-width:0;">
            <div class="m-activity-text">${esc(source)} · ${esc(b.mitarbeiter || '–')}</div>
            <div class="m-activity-meta">${orderCount > 0 ? orderCount + ' Artikel bestellt · ' : 'Nichts zu bestellen · '}${esc(rel)}</div>
          </div>
        </div>`;
      }).join('');
    } else {
      list.innerHTML = '<div class="m-activity-row"><div class="m-activity-text m-activity-empty">Noch keine Aktivität</div></div>';
    }
  } catch (e) {
    console.error('[mitarbeiter] bestellungen query:', e.code, e.message);
    list.innerHTML = '<div class="m-activity-row"><div class="m-activity-text m-activity-empty">Aktivität nicht verfügbar</div></div>';
  }
})();

function relTime(d) {
  const diff = Date.now() - d.getTime();
  if (diff < 60000)    return 'gerade eben';
  if (diff < 3600000)  return Math.round(diff / 60000) + ' min';
  if (diff < 86400000) return Math.round(diff / 3600000) + ' h';
  return d.toLocaleDateString('de-DE');
}

// ══════════════════════════════════════
// PIN-Change Modal
// ══════════════════════════════════════
function setStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById(`pc-step-${i}`).classList.toggle('hidden', i !== n);
  });
}

function updateDots(prefix, val) {
  for (let i = 0; i < 4; i++)
    document.getElementById(`${prefix}-${i}`)?.classList.toggle('filled', i < val.length);
}

let _pc1 = '', _pc2 = '', _pc3 = '';

function openPinChange() {
  _pc1 = ''; _pc2 = ''; _pc3 = '';
  updateDots('pc-dot', '');
  updateDots('pc-ndot', '');
  updateDots('pc-cdot', '');
  document.getElementById('pc-error-1').textContent = '';
  document.getElementById('pc-error-2').textContent = '';
  document.getElementById('pc-error-3').textContent = '';
  setStep(1);
  document.getElementById('pin-change-wall').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closePinChange() {
  document.getElementById('pin-change-wall').style.display = 'none';
  document.body.style.overflow = '';
}

document.getElementById('change-pin-btn').addEventListener('click', openPinChange);
document.getElementById('pin-change-wall').addEventListener('click', e => {
  if (e.target === document.getElementById('pin-change-wall')) closePinChange();
});

// PIN-change numpad delegation
function pcKey(step, d) {
  if (step === 1) {
    if (_pc1.length >= 4) return;
    _pc1 += d; updateDots('pc-dot', _pc1);
    if (_pc1.length === 4) setTimeout(verifyCurrentPin, 150);
  } else if (step === 2) {
    if (_pc2.length >= 4) return;
    _pc2 += d; updateDots('pc-ndot', _pc2);
    if (_pc2.length === 4) setTimeout(() => setStep(3), 150);
  } else {
    if (_pc3.length >= 4) return;
    _pc3 += d; updateDots('pc-cdot', _pc3);
    if (_pc3.length === 4) setTimeout(saveNewPin, 150);
  }
}

function pcDel(step) {
  if (step === 1) { _pc1 = _pc1.slice(0, -1); updateDots('pc-dot', _pc1); }
  if (step === 2) { _pc2 = _pc2.slice(0, -1); updateDots('pc-ndot', _pc2); }
  if (step === 3) { _pc3 = _pc3.slice(0, -1); updateDots('pc-cdot', _pc3); }
}

// Delegation for all three PIN-change numpads
[1, 2, 3].forEach(step => {
  const numpad = document.getElementById(`pc-step-${step}`)?.querySelector('.ln-numpad');
  if (!numpad) return;
  numpad.addEventListener('click', e => {
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === 'del')    pcDel(step);
    else if (key === 'cancel') closePinChange();
    else pcKey(step, key);
  });
});

async function verifyCurrentPin() {
  const empId = authGet('lager-employee-id');
  if (!empId) {
    document.getElementById('pc-error-1').textContent = 'Kein persönlicher Account – PIN-Änderung nicht möglich';
    _pc1 = ''; updateDots('pc-dot', ''); return;
  }
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    const snap = await getDoc(doc(db, `${getDBRoot()}/mitarbeiter`, empId));
    if (!snap.exists()) {
      document.getElementById('pc-error-1').textContent = 'Mitarbeiter nicht gefunden';
      _pc1 = ''; updateDots('pc-dot', ''); return;
    }
    if (snap.data().pinHash !== await sha256(_pc1)) {
      document.getElementById('pc-error-1').textContent = 'Falscher PIN';
      _pc1 = ''; updateDots('pc-dot', ''); return;
    }
    _pc2 = ''; updateDots('pc-ndot', '');
    document.getElementById('pc-error-2').textContent = '';
    setStep(2);
  } catch (e) {
    document.getElementById('pc-error-1').textContent = 'Fehler: ' + e.message;
    _pc1 = ''; updateDots('pc-dot', '');
  }
}

async function saveNewPin() {
  if (_pc3 !== _pc2) {
    document.getElementById('pc-error-3').textContent = 'PINs stimmen nicht überein – von vorne beginnen';
    _pc2 = ''; _pc3 = '';
    updateDots('pc-ndot', ''); updateDots('pc-cdot', '');
    document.getElementById('pc-error-2').textContent = '';
    setStep(2);
    return;
  }
  const empId = authGet('lager-employee-id');
  try {
    await updateDoc(doc(db, `${getDBRoot()}/mitarbeiter`, empId), { pinHash: await sha256(_pc3) });
    closePinChange();
    const t = document.createElement('div');
    t.textContent = 'PIN erfolgreich geändert';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--ok);color:var(--ok);border-radius:12px;padding:10px 18px;font-size:13px;font-weight:600;z-index:3000;box-shadow:0 4px 16px rgba(0,0,0,.15);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  } catch (e) {
    document.getElementById('pc-error-3').textContent = 'Fehler: ' + e.message;
    _pc3 = ''; updateDots('pc-cdot', '');
  }
}

// ══════════════════════════════════════
// Wachenleiter Login Modal
// ══════════════════════════════════════
function openWlLogin() {
  document.getElementById('wl-modal-email').value = '';
  document.getElementById('wl-modal-password').value = '';
  document.getElementById('wl-modal-error').textContent = '';
  const btn = document.getElementById('wl-modal-login-btn');
  btn.disabled = false; btn.textContent = 'Anmelden';
  document.getElementById('wl-login-wall').style.display = 'block';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('wl-modal-email').focus(), 150);
}

function closeWlLogin() {
  document.getElementById('wl-login-wall').style.display = 'none';
  document.body.style.overflow = '';
}

document.getElementById('wl-nav-btn').addEventListener('click', openWlLogin);
document.getElementById('wl-login-wall').addEventListener('click', e => {
  if (e.target === document.getElementById('wl-login-wall')) closeWlLogin();
});
document.getElementById('wl-modal-cancel-btn').addEventListener('click', closeWlLogin);

async function doWlLogin() {
  const email    = document.getElementById('wl-modal-email').value.trim();
  const password = document.getElementById('wl-modal-password').value;
  const btn      = document.getElementById('wl-modal-login-btn');
  const errEl    = document.getElementById('wl-modal-error');
  if (!email || !password) { errEl.textContent = 'E-Mail und Passwort erforderlich'; return; }
  btn.disabled = true; btn.textContent = 'Anmelden…';
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
    sessionStorage.setItem('lager-portal-role', 'wachenleiter');
    closeWlLogin();
    window.location.href = 'portal.html';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Anmelden';
    const map = {
      'auth/invalid-credential': 'E-Mail oder Passwort falsch',
      'auth/user-not-found':     'Kein Konto mit dieser E-Mail',
      'auth/wrong-password':     'Falsches Passwort',
      'auth/invalid-email':      'Ungültige E-Mail-Adresse',
      'auth/too-many-requests':  'Zu viele Versuche – kurz warten',
    };
    errEl.textContent = map[e.code] || 'Fehler: ' + e.message;
  }
}

document.getElementById('wl-modal-login-btn').addEventListener('click', doWlLogin);
document.getElementById('wl-modal-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doWlLogin();
});

// ── Profilbild-Upload ──
const CLOUDINARY_CLOUD  = 'YOUR_CLOUDINARY_CLOUD_NAME';
const CLOUDINARY_PRESET = 'YOUR_CLOUDINARY_UPLOAD_PRESET';

document.getElementById('avatar-file-input').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  const empId = authGet('lager-employee-id');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_PRESET);
  formData.append('folder', 'avatars');

  const avatarEl = document.getElementById('auth-avatar');
  const prevContent = avatarEl.innerHTML || avatarEl.textContent;
  avatarEl.textContent = '…';

  try {
    const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.secure_url) throw new Error(data.error?.message || 'Upload fehlgeschlagen');

    localStorage.setItem('lager-avatar-url', data.secure_url);
    avatarEl.innerHTML = `<img src="${esc(data.secure_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;

    if (empId) {
      if (!auth.currentUser) await signInAnonymously(auth);
      await updateDoc(doc(db, `${getDBRoot()}/mitarbeiter`, empId), { avatarUrl: data.secure_url });
    }
    const t = document.createElement('div');
    t.textContent = 'Profilbild gespeichert';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--ok);color:var(--ok);border-radius:12px;padding:10px 18px;font-size:13px;font-weight:600;z-index:3000;box-shadow:0 4px 16px rgba(0,0,0,.15);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  } catch (e) {
    avatarEl.innerHTML = prevContent;
    alert('Fehler beim Hochladen: ' + e.message);
  }
  this.value = '';
});

// Profilbild aus Firestore laden
(async () => {
  const empId = authGet('lager-employee-id');
  if (!empId) return;
  try {
    if (!auth.currentUser) await new Promise(r => { const u = onAuthStateChanged(auth, user => { if (user) { u(); r(); } }); });
    const snap = await getDoc(doc(db, `${getDBRoot()}/mitarbeiter`, empId));
    if (snap.exists() && snap.data().avatarUrl) {
      const url = snap.data().avatarUrl;
      localStorage.setItem('lager-avatar-url', url);
      const avatarEl = document.getElementById('auth-avatar');
      if (avatarEl) avatarEl.innerHTML = `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;
    }
  } catch (_) {}
})();

// ── Session-Reset ──
const sessionResetBar = document.getElementById('session-reset-bar');
const sessionResetBtn = document.getElementById('session-reset-btn');

// Session-Reset-Bar anzeigen wenn angemeldet
if (pinAuth === 'true') {
  sessionResetBar?.classList.remove('hidden');
}

sessionResetBtn?.addEventListener('click', async () => {
  const ok = confirm(
    '⚠️ Session wirklich beenden?\n\n' +
    'Alle laufenden Bestellungen werden abgebrochen und die Session wird zurückgesetzt. ' +
    'Dies sollte nur verwendet werden, wenn eine Bestellung nicht mehr reagiert.'
  );
  if (!ok) return;

  sessionResetBtn.textContent = 'Wird beendet…';
  sessionResetBtn.disabled = true;

  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    await setDoc(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'), {
      status: 'beendet',
      bereichStatus: {},
      teilnehmer: [],
      beendetAm: new Date(),
    });
    // Delete warenkorb items fire-and-forget (don't block the success UI)
    getDocs(query(collection(db, `${getDBRoot()}/warenkorb`), where('sessionId', '==', 'current')))
      .then(wkSnap => {
        if (wkSnap.empty) return;
        const batch = writeBatch(db);
        wkSnap.forEach(d => batch.delete(d.ref));
        return batch.commit();
      })
      .catch(() => {});
    // Also remove local draft
    ['lager-draft-id', 'lager-active-draft'].forEach(k => {
      sessionStorage.removeItem(k); localStorage.removeItem(k);
    });
    const t = document.createElement('div');
    t.textContent = '✅ Session wurde beendet';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--ok);color:var(--ok);border-radius:12px;padding:10px 18px;font-size:13px;font-weight:600;z-index:3000;box-shadow:0 4px 16px rgba(0,0,0,.15);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  } catch (e) {
    alert('Fehler: ' + e.message);
  } finally {
    sessionResetBtn.textContent = 'Session beenden';
    sessionResetBtn.disabled = false;
  }
});

// Sign out of Firebase on logout so login.html auth guard doesn't redirect back
const _baseLogout = doLogout;
// Override doLogout to also sign out Firebase
document.querySelectorAll('[data-action="logout"]').forEach(el => {
  // Already registered above; re-register with Firebase sign-out
  el.removeEventListener('click', doLogout);
  el.addEventListener('click', async () => {
    try { await signOut(auth); } catch (_) {}
    _baseLogout();
  });
});
