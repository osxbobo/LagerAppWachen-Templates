// ─────────────────────────────────────────────
// LAGER//APP – Firebase Konfiguration & Init
// ─────────────────────────────────────────────
import { initializeApp, getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

export const firebaseConfig = {
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
  measurementId:     'YOUR_MEASUREMENT_ID',
  databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.europe-west1.firebasedatabase.app',
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// ── Multi-Wachen ──────────────────────────────────────────────────────────────

// Hier eigene Wachen eintragen. ID = Firestore-Pfad-Segment (z. B. 'w1_meinstadt')
export const WACHEN = {
  // w1_meinstadt: { id: 'w1_meinstadt', label: 'W1 Meine Stadt' },
};

export function getActiveWache() {
  return localStorage.getItem('activeWache') || null;
}

export function getDBRoot() {
  const w = getActiveWache();
  if (!w) throw new Error('Keine Wache ausgewählt');
  return `wachen/${w}`;
}

export function switchWache(id) {
  localStorage.setItem('activeWache', id);
}
