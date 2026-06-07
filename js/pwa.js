// ═══════════════════════════════════════════════
// LAGER//APP – PWA & Push Manager
// ═══════════════════════════════════════════════

const PWA = {

  async init() {
    if (!('serviceWorker' in navigator)) return;

    try {
      // Dynamisch: '/LagerAppWachen' auf GitHub Pages, '' auf Custom Domain
      const base = window.location.pathname.startsWith('/LagerAppWachen') ? '/LagerAppWachen' : '';

      const reg = await navigator.serviceWorker.register(`${base}/sw.js`, {
        scope: base ? `${base}/` : '/'
      });

      console.log('✅ Service Worker registriert');

      // ── Update Detection ──
      // Neuen SW sofort aktivieren (sw.js ruft selbst skipWaiting auf,
      // aber falls er im Wartezustand landet doch noch einmal anstoßen)
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // ── Nach SW-Update: kein automatischer Reload ──
      // Der neue SW wird beim nächsten Seitenaufruf aktiv.
      // Kein auto-reload, da das für Nutzer wie ein Crash aussieht.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('🔄 Neuer Service Worker aktiv – wirksam beim nächsten Seitenaufruf.');
      });

      // ── SW Update Message ──
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'SW_UPDATED') {
          console.log(`✅ LAGER//APP ${event.data.version} geladen`);
        }
      });

      // Regelmäßig auf Updates prüfen (alle 60 Minuten)
      setInterval(() => reg.update(), 60 * 60 * 1000);

    } catch (e) {
      console.error('Service Worker Fehler:', e);
    }
  },

  // ── Push Permission ──
  async requestPermission() {
    if (!('Notification' in window)) return { success: false };
    if (Notification.permission === 'granted') return { success: true };
    if (Notification.permission === 'denied') return { success: false, reason: 'denied' };
    const permission = await Notification.requestPermission();
    return { success: permission === 'granted' };
  },

  // ── Notification senden ──
  async notify(title, body, url = null, urgent = false) {
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({
      type: 'SHOW_NOTIFICATION',
      title, body,
      url: url || window.location.href,
      urgent,
    });
  },

  // ── Verfallsdaten prüfen ──
  async checkVerfallAndNotify(alleArtikel) {
    if (Notification.permission !== 'granted') return;
    const heute = new Date();
    const kritisch = [], bald = [];

    for (const a of alleArtikel) {
      if (!a.chargen || a.chargen.length === 0) continue;
      for (const c of a.chargen) {
        if (!c.verfall) continue;
        const days = Math.round((new Date(c.verfall) - heute) / (1000*60*60*24));
        if (days <= 7)       kritisch.push({ name: a.name, lot: c.lot, days });
        else if (days <= 30) bald.push({ name: a.name, lot: c.lot, days });
      }
    }

    if (kritisch.length > 0) {
      const namen = kritisch.slice(0,3).map(x => `${x.name} (${x.days <= 0 ? 'ABGELAUFEN' : x.days + ' Tage'})`).join(', ');
      await PWA.notify(`🔴 ${kritisch.length} Artikel kritisch!`, namen,
        '/pages/portal.html', true);
    } else if (bald.length > 0) {
      const namen = bald.slice(0,3).map(x => `${x.name} (${x.days} Tage)`).join(', ');
      await PWA.notify(`🟡 ${bald.length} Artikel laufen bald ab`, namen,
        '/pages/portal.html');
    }
  },

  // ── Lagerbestellung Benachrichtigung ──
  async notifyLagercheck(mitarbeiter, anzahl) {
    if (Notification.permission !== 'granted') return;
    await PWA.notify(
      '📋 Lagerbestellung abgeschlossen',
      anzahl > 0
        ? `${mitarbeiter} hat ${anzahl} Artikel zum Bestellen gemeldet`
        : `${mitarbeiter} – alles in Ordnung ✅`,
      '/pages/portal.html',
    );
  },

  // ── Install Prompt (Android) ──
  initInstallPrompt() {
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      const btn = document.getElementById('pwa-install-btn');
      if (btn) {
        btn.classList.remove('hidden');
        btn.addEventListener('click', async () => {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') btn.remove();
          deferredPrompt = null;
        });
      }
    });
  },

  // ── Notification Permission Button ──
  getPermissionButtonHTML() {
    if (!('Notification' in window)) return '';
    if (Notification.permission === 'granted') return '';
    return `
      <button onclick="PWA.requestPermission().then(r => { if(r.success) this.remove(); })"
        style="display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;
               border:1px solid var(--border);background:var(--surface2);color:var(--text2);
               font-size:0.78rem;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500;">
        🔔 Benachrichtigungen erlauben
      </button>`;
  },
};

// Auto-Init
document.addEventListener('DOMContentLoaded', () => {
  PWA.init();
  PWA.initInstallPrompt();
});
