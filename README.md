# LAGER//APP

Digitale Lagerverwaltung für Rettungswachen als Progressive Web App (PWA).  
Reines HTML/CSS/JavaScript – kein Framework, offline-fähig.

## Features

- Multi-Wachen-Unterstützung (beliebig viele Standorte)
- Artikelverwaltung mit Barcode-Scanner (ZXing)
- Chargenverfolgung & Ablaufdaten-Monitoring
- Bestandsprüfung mit Foto-Dokumentation (Cloudinary)
- PDF-Export für Bestelllisten (pdf-lib)
- Admin-Dashboard mit wachenübergreifender Ansicht
- PWA: installierbar, offline-fähig (Service Worker)

## Setup

### 1. Firebase-Projekt anlegen

1. Neues Projekt auf [console.firebase.google.com](https://console.firebase.google.com)
2. Firestore-Datenbank aktivieren (Produktionsmodus)
3. Authentication aktivieren (E-Mail/Passwort)
4. Firebase-Config in `js/firebase-config.js` eintragen (alle `YOUR_*`-Platzhalter ersetzen)

### 2. Cloudinary einrichten

1. Kostenloses Konto auf [cloudinary.com](https://cloudinary.com)
2. Unsigned Upload Preset anlegen
3. Cloud Name und Preset-Name in `js/admin.js`, `js/mitarbeiter.js`, `js/portal.js` eintragen (`YOUR_CLOUDINARY_*`-Platzhalter)

### 3. Wachen konfigurieren

In `js/firebase-config.js` eigene Wachen eintragen:

```js
export const WACHEN = {
  w1_meinstadt:   { id: 'w1_meinstadt',   label: 'W1 Meine Stadt'   },
  w2_anderestadt: { id: 'w2_anderestadt', label: 'W2 Andere Stadt'  },
};
```

Firestore-Pfad-Struktur: `wachen/{wachen-id}/artikel/{artikel-id}`

### 4. Firestore Security Rules deployen

```bash
firebase deploy --only firestore:rules
```

### 5. Hosten

```bash
firebase deploy --only hosting
```

Oder als statische Website auf beliebigem Webserver.

## Firestore-Struktur

```
wachen/
  {wachen-id}/
    artikel/
      {artikel-id}/
        name, barcode, bereich, menge, einheit, mindestmenge
        chargen/ → [{charge, mhd, menge}]
        fotoUrl, lagerFotoUrl
    checks/
      {check-id}/ → Prüfprotokoll
    bestellungen/
      {bestell-id}/ → Bestellvorgang
mitarbeiter/
  {uid}/ → Profil, Rolle, Wache
```

## Technologie

| Bereich | Technologie |
|---------|-------------|
| Backend | Firebase Firestore + Auth |
| Bilderspeicher | Cloudinary (unsigned upload) |
| Barcode | ZXing (WASM) |
| PDF | pdf-lib |
| Hosting | Firebase Hosting |
| Offline | Service Worker (Cache-first) |
