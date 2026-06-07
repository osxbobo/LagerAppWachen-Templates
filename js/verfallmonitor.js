// ─────────────────────────────────────────────
// LAGER//APP – Verfallmonitor
// ─────────────────────────────────────────────
import { app, getDBRoot } from '../js/firebase-config.js';
import { initTheme, toggleTheme } from '../js/theme.js';
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInAnonymously }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Firebase ──
const db   = getFirestore(app);
const auth = getAuth(app);

// ── Theme ──
initTheme();
// Sync icon for the local theme button (theme.js looks for #theme-toggle,
// but this page uses #theme-btn – so we update it ourselves)
(function syncThemeIcon() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  btn.textContent = t === 'dark' ? '🌙' : '☀️';
})();

// ── XSS helper ──
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Nav event listeners ──
document.querySelector('.m-back').addEventListener('click', () => history.back());
document.getElementById('wl-nav-btn')?.addEventListener('click', () => { window.location.href = 'portal.html'; });
document.getElementById('theme-btn').addEventListener('click', () => {
  toggleTheme();
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  document.getElementById('theme-btn').textContent = t === 'dark' ? '🌙' : '☀️';
});

// ── Heatmap ──
let heatmapData = [];

function initHeatmap() {
  const now = new Date();
  const mNames = ['JAN','FEB','MRZ','APR','MAI','JUN','JUL','AUG','SEP','OKT','NOV','DEZ'];
  heatmapData = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    heatmapData.push({
      lbl:   mNames[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2),
      year:  d.getFullYear(),
      month: d.getMonth(),
      cells: [0, 0, 0, 0, 0]
    });
  }
  renderHeatmap();
}

function updateHeatmap(entries) {
  entries.forEach(e => {
    const d = new Date(e.verfall);
    const bucket = heatmapData.find(h => h.year === d.getFullYear() && h.month === d.getMonth());
    if (bucket) {
      const weekIdx = Math.min(Math.floor((d.getDate() - 1) / 7), 4);
      bucket.cells[weekIdx]++;
    }
  });
  renderHeatmap();
}

function renderHeatmap() {
  const cellColor = v =>
    v >= 3 ? 'var(--crit)' :
    v >= 2 ? 'var(--low)'  :
    v >= 1 ? 'var(--brand)' : 'var(--surface-3)';

  let html = '';
  heatmapData.forEach((r, i) => {
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:${i === heatmapData.length - 1 ? '0' : '6px'}">`;
    html += `<div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);width:52px;flex-shrink:0">${r.lbl}</div>`;
    html += `<div style="display:flex;gap:4px;flex:1">`;
    r.cells.forEach(v => {
      html += `<div style="flex:1;height:22px;border-radius:5px;background:${cellColor(v)};display:flex;align-items:center;justify-content:center;color:${v >= 1 ? 'white' : 'var(--ink-4)'};font-family:var(--font-mono);font-size:10px;font-weight:600">${v > 0 ? v : ''}</div>`;
    });
    html += `</div></div>`;
  });
  html += `<div style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:10px;color:var(--ink-3);font-family:var(--font-mono)">`;
  html += `<span>weniger</span>`;
  ['var(--surface-3)', 'var(--brand)', 'var(--low)', 'var(--crit)'].forEach(c => {
    html += `<span style="width:14px;height:10px;border-radius:2px;background:${c};display:inline-block;flex-shrink:0"></span>`;
  });
  html += `<span>mehr</span></div>`;
  document.getElementById('heatmap-card').innerHTML = html;
}

initHeatmap();

// ── Auth ──
onAuthStateChanged(auth, async user => {
  const pinOk = sessionStorage.getItem('lager-pin-auth') || localStorage.getItem('lager-pin-auth');
  if (!user && !pinOk) { window.location.href = '../index.html'; return; }
  if (!user) { try { await signInAnonymously(auth); } catch (_) {} }
  loadData();
});

// ── Load & Render ──
async function loadData() {
  const now         = new Date();
  const thisYear    = now.getFullYear();
  const thisMonth   = now.getMonth();
  const monthPrefix = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`;
  const monthStart  = new Date(thisYear, thisMonth, 1);
  const sixMonthsEnd = new Date(thisYear, thisMonth + 6, 0);

  const mNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  document.getElementById('page-month-label').textContent =
    ` · ${mNames[thisMonth]} ${String(thisYear).slice(2)}`;

  try {
    const [snapArtikel, snapBereiche] = await Promise.all([
      getDocs(collection(db, `${getDBRoot()}/artikel`)),
      getDocs(collection(db, `${getDBRoot()}/bereiche`))
    ]);

    const bereiche = {};
    snapBereiche.forEach(d => { bereiche[d.id] = d.data().name || d.id; });

    const entries = [];
    snapArtikel.forEach(docSnap => {
      const a = docSnap.data();
      (a.chargen || []).forEach(c => {
        if (!c.verfall) return;
        if (c.disposed) return;
        const verfallDate    = new Date(c.verfall);
        const isUeberfaellig = verfallDate < monthStart;
        const isDiesenMonat  = c.verfall.startsWith(monthPrefix);
        const isFolge        = verfallDate > new Date(thisYear, thisMonth + 1, 0) && verfallDate <= sixMonthsEnd;

        if (!isUeberfaellig && !isDiesenMonat && !isFolge) return;

        entries.push({
          artikelId: docSnap.id,
          name:    a.name || '–',
          bereich: prettyBereich(bereiche[a.bereich] || a.bereich || '–'),
          lot:     c.lot || '–',
          verfall: c.verfall,
          status:  isUeberfaellig ? 'ueberfaellig' : isDiesenMonat ? 'diesen-monat' : 'folge'
        });
      });
    });

    entries.sort((a, b) => {
      const ord = { ueberfaellig: 0, 'diesen-monat': 1, folge: 2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return a.verfall.localeCompare(b.verfall);
    });

    document.getElementById('kpi-ueberfaellig').textContent = entries.filter(e => e.status === 'ueberfaellig').length;
    document.getElementById('kpi-diesen-monat').textContent = entries.filter(e => e.status === 'diesen-monat').length;
    document.getElementById('kpi-folge').textContent        = entries.filter(e => e.status === 'folge').length;

    updateHeatmap(entries);
    renderEntries(entries);
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div style="color:var(--crit);padding:20px;text-align:center;font-size:14px;">⚠️ Fehler: ${esc(e.message)}</div>`;
  }
}

// ── Event delegation for "Entsorgt melden" buttons ──
document.getElementById('content').addEventListener('click', e => {
  const btn = e.target.closest('.btn-entsorgt');
  if (!btn) return;
  meldungEntsorgt(btn.dataset.artikelId, btn.dataset.lot, btn.dataset.verfall);
});

// ── Helpers ──
function formatVerfall(iso) {
  const parts = iso.split('-');
  if (parts.length < 2) return iso;
  return `${parts[1]}/${parts[0]}`;
}

function daysLabel(verfallIso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end   = new Date(verfallIso); end.setHours(0, 0, 0, 0);
  const diff  = Math.round((end - today) / 86400000);
  if (diff < 0)  return `−${Math.abs(diff)} Tag${Math.abs(diff) === 1 ? '' : 'e'}`;
  if (diff === 0) return 'Heute';
  return `${diff} Tag${diff === 1 ? '' : 'e'}`;
}

function prettyBereich(name) {
  return String(name ?? '').replace(/^Lager\s*[-–]\s*/i, '').trim();
}

function groupHeader(lbl, sub, tone, count) {
  return `<div class="vm-group-header">
    <span class="vm-group-accent vm-group-accent--${tone}"></span>
    <span class="vm-group-label">${lbl}</span>
    <span class="vm-group-sub">· ${sub}</span>
    <span class="vm-group-spacer"></span>
    <span class="vm-group-count">${count}</span>
  </div>`;
}

function buildCard(e) {
  const isCrit   = e.status === 'ueberfaellig';
  const isLow    = e.status === 'diesen-monat';
  const tone     = isCrit ? 'crit' : isLow ? 'low' : 'neutral';
  const chipCls  = isCrit ? 'crit' : isLow ? 'low' : 'neutral';

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const end      = new Date(e.verfall); end.setHours(0, 0, 0, 0);
  const daysDiff = Math.round((end - today) / 86400000);
  const isExpired = daysDiff < 0;
  const diffLabel = isExpired ? 'ABGELAUFEN' : daysLabel(e.verfall);
  const expiredClass = isExpired ? ' is-expired' : '';

  const entsorgtBtn = isExpired
    ? `<button class="btn-entsorgt" data-artikel-id="${esc(e.artikelId)}" data-lot="${esc(e.lot)}" data-verfall="${esc(e.verfall)}">Entsorgt melden</button>`
    : '';

  return `<div class="verfall-item${expiredClass}">
    <div class="verfall-accent ${tone}"></div>
    <div class="verfall-item-info">
      <div class="verfall-item-name">${esc(e.name)}</div>
      <div class="verfall-item-lot">LOT ${esc(e.lot)} · ${formatVerfall(e.verfall)}</div>
      ${entsorgtBtn}
    </div>
    <div class="verfall-item-meta">
      <span class="la-chip ${chipCls} verfall-item-chip"><span class="dot"></span>${diffLabel}</span>
      <span class="verfall-item-bereich">${esc(e.bereich)}</span>
    </div>
  </div>`;
}

async function meldungEntsorgt(artikelId, lot, verfall) {
  if (!confirm(`Charge LOT ${lot} (${formatVerfall(verfall)}) als entsorgt melden?`)) return;
  try {
    const snap = await getDoc(doc(db, `${getDBRoot()}/artikel`, artikelId));
    if (!snap.exists()) { alert('Artikel nicht gefunden.'); return; }
    const chargen = (snap.data().chargen || []).map(c => {
      if (c.lot === lot && c.verfall === verfall) {
        return {
          ...c,
          disposed:   true,
          disposedAt: new Date().toISOString(),
          disposedBy: sessionStorage.getItem('lager-pin-name') || localStorage.getItem('lager-pin-name') || '–'
        };
      }
      return c;
    });
    await updateDoc(doc(db, `${getDBRoot()}/artikel`, artikelId), { chargen });
    loadData();
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}

function renderEntries(entries) {
  const container = document.getElementById('content');
  if (entries.length === 0) {
    container.innerHTML = `<div class="vm-empty">
      <div class="vm-empty-icon">✅</div>
      <div class="vm-empty-title">Alles in Ordnung</div>
      <div class="vm-empty-sub">Keine Chargen laufen diesen Monat ab</div>
    </div>`;
    return;
  }

  let html = '';

  const ueberfaellig = entries.filter(e => e.status === 'ueberfaellig');
  if (ueberfaellig.length > 0) {
    html += groupHeader('Diese Woche', 'Abgelaufen oder ≤ 7 Tage', 'crit', ueberfaellig.length);
    html += `<div class="la-list vm-list-wrap">`;
    ueberfaellig.forEach(e => { html += buildCard(e); });
    html += `</div>`;
  }

  const diesenMonat = entries.filter(e => e.status === 'diesen-monat');
  if (diesenMonat.length > 0) {
    html += groupHeader('Diesen Monat', '≤ 30 Tage', 'low', diesenMonat.length);
    html += `<div class="la-list vm-list-wrap">`;
    diesenMonat.forEach(e => { html += buildCard(e); });
    html += `</div>`;
  }

  const folge = entries.filter(e => e.status === 'folge');
  if (folge.length > 0) {
    html += groupHeader('Folgemonate', '> 30 Tage', 'neutral', folge.length);
    html += `<div class="la-list vm-list-wrap">`;
    folge.forEach(e => { html += buildCard(e); });
    html += `</div>`;
  }

  container.innerHTML = html;
}
