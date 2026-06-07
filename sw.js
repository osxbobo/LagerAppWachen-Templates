// ═══════════════════════════════════════════════
// LAGER//APP – Service Worker
// PWA + Push Notifications + Offline Cache
// ═══════════════════════════════════════════════

// ── VERSION ──
// Diese Nummer bei jedem GitHub Upload um 1 erhöhen
// z.B. v2, v3, v4 ...
// → Browser erkennt automatisch die neue Version und lädt alles neu
const CACHE_VERSION = 'v222';
const CACHE_NAME    = `lagerapp-${CACHE_VERSION}`;
// Dynamisch: '/LagerAppWachen' auf GitHub Pages, '' auf Custom Domain
const BASE_PATH     = self.location.pathname.replace(/\/sw\.js$/, '');

// Dateien die offline verfügbar sein sollen
const CACHE_FILES = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/pages/check.html`,
  `${BASE_PATH}/pages/login.html`,
  `${BASE_PATH}/pages/mitarbeiter.html`,
  `${BASE_PATH}/pages/portal.html`,
  `${BASE_PATH}/pages/admin.html`,
  `${BASE_PATH}/pages/scanner.html`,
  `${BASE_PATH}/pages/stockswipe.html`,
  `${BASE_PATH}/pages/verfallmonitor.html`,
  `${BASE_PATH}/css/main.css`,
  `${BASE_PATH}/css/index.css`,
  `${BASE_PATH}/css/portal.css`,
  `${BASE_PATH}/css/admin.css`,
  `${BASE_PATH}/css/check.css`,
  `${BASE_PATH}/css/login.css`,
  `${BASE_PATH}/css/mitarbeiter.css`,
  `${BASE_PATH}/css/scanner.css`,
  `${BASE_PATH}/css/stockswipe.css`,
  `${BASE_PATH}/css/verfallmonitor.css`,
  `${BASE_PATH}/js/firebase-config.js`,
  `${BASE_PATH}/js/search.js`,
  `${BASE_PATH}/js/theme.js`,
  `${BASE_PATH}/js/pwa.js`,
  `${BASE_PATH}/js/portal.js`,
  `${BASE_PATH}/js/admin.js`,
  `${BASE_PATH}/js/check.js`,
  `${BASE_PATH}/js/login.js`,
  `${BASE_PATH}/js/mitarbeiter.js`,
  `${BASE_PATH}/js/scanner.js`,
  `${BASE_PATH}/js/stockswipe.js`,
  `${BASE_PATH}/js/verfallmonitor.js`,
  `${BASE_PATH}/manifest.json`,
];

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        Promise.all(
          CACHE_FILES.map(url =>
            cache.add(url).catch(err => console.warn(`[SW] Cache-Fehler: ${url}`, err))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => {
              console.log(`🗑️ Alter Cache gelöscht: ${key}`);
              return caches.delete(key);
            })
        )
      )
      .then(() => {
        console.log(`✅ LAGER//APP ${CACHE_VERSION} aktiv`);
        return self.clients.claim();
      })
      .then(() => {
        // Alle offenen Tabs über Update informieren
        return self.clients.matchAll({ type: 'window' });
      })
      .then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      })
  );
});

// ── FETCH (Offline Support) ──
self.addEventListener('fetch', event => {
  // Nur http/https cachen – chrome-extension:// und andere Schemes überspringen
  if (!event.request.url.startsWith('http')) return;

  // Firebase SDK (gstatic CDN): cache-first so Tablets nach dem 1. Laden offline arbeiten
  if (event.request.url.includes('gstatic.com/firebasejs')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const network = fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Andere externe Requests (Firebase API, Cloudinary, Maps etc.) immer online
  if (event.request.url.includes('firebase') ||
      event.request.url.includes('cloudinary') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('gstatic')) {
    return;
  }

  const isHtml = event.request.mode === 'navigate' ||
                 event.request.destination === 'document' ||
                 event.request.url.endsWith('.html');

  if (isHtml) {
    // Network-first für HTML-Seiten → immer aktuelle Version laden
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)
          .then(cached => cached || caches.match(`${BASE_PATH}/index.html`))
        )
    );
  } else {
    // Cache-first für Assets (CSS, JS, Bilder)
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request)
          .then(response => {
            if (response.status === 200 && event.request.method === 'GET') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
        )
    );
  }
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body:    data.body    || '',
    icon:    `${BASE_PATH}/icons/icon-192.png`,
    badge:   `${BASE_PATH}/icons/icon-192.png`,
    tag:     data.tag     || 'lagerapp',
    data:    data.url     || `${BASE_PATH}/`,
    vibrate: [200, 100, 200],
    actions: data.actions || [],
    requireInteraction: data.urgent || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'LAGER//APP', options)
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = event.notification.data || `${BASE_PATH}/`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Existierendes Fenster fokussieren
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus().then(() => client.navigate(url));
          }
        }
        // Neues Fenster öffnen
        return clients.openWindow(url);
      })
  );
});

// ── BACKGROUND SYNC (Verfallsprüfung) ──
self.addEventListener('sync', event => {
  if (event.tag === 'check-verfall') {
    event.waitUntil(checkVerfall());
  }
});

async function checkVerfall() {
  // Wird vom Client getriggert um Verfallsdaten zu prüfen
  // Die eigentliche Logik läuft im Client
  const allClients = await clients.matchAll();
  allClients.forEach(client => {
    client.postMessage({ type: 'CHECK_VERFALL' });
  });
}

// ── INDEXEDDB – Firestore-Artikeldaten-Cache ──
// Ermöglicht Stale-while-revalidate und vollständigen Offline-Betrieb.
// Seiten schreiben via postMessage('CACHE_ARTIKEL'), lesen via 'GET_CACHED_ARTIKEL'.

const IDB_NAME    = 'lagerapp-offline';
const IDB_VERSION = 1;
const IDB_STORE   = 'artikel-cache';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = ()  => reject(req.error);
  });
}

async function saveToIDB(data) {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, 'main');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function readFromIDB() {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get('main');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

// ── MESSAGE HANDLER ──
self.addEventListener('message', event => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Artikeldaten aus Firestore im IndexedDB-Cache speichern (Stale-while-revalidate)
  if (event.data.type === 'CACHE_ARTIKEL') {
    saveToIDB(event.data.data).catch(err =>
      console.warn('[SW] IndexedDB-Schreibfehler:', err)
    );
  }

  // Gecachte Artikeldaten zurückliefern (Offline-Fallback)
  if (event.data.type === 'GET_CACHED_ARTIKEL') {
    readFromIDB()
      .then(cached => event.ports[0].postMessage(cached))
      .catch(() => event.ports[0].postMessage(null));
  }

  // Benachrichtigung direkt vom Client senden
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, url, urgent } = event.data;
    self.registration.showNotification(title, {
      body,
      icon:    `${BASE_PATH}/icons/icon-192.png`,
      badge:   `${BASE_PATH}/icons/icon-192.png`,
      data:    url || `${BASE_PATH}/pages/portal.html`,
      vibrate: [200, 100, 200],
      requireInteraction: urgent || false,
    });
  }
});
