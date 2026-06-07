    import { initializeApp, getApps, deleteApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword }
                              from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
    import { getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, query, orderBy, limit, where, onSnapshot, Timestamp, writeBatch }
                              from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
    import { getStorage, ref as storageRef, getDownloadURL, getBytes }
                              from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
    import { firebaseConfig, getDBRoot, switchWache, getActiveWache, WACHEN } from "../js/firebase-config.js";

    // Theme
    const savedTheme  = localStorage.getItem('lager-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme       = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    window.toggleTheme = function() {
      const cur  = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('lager-theme', next);
      document.getElementById('theme-toggle').textContent = next === 'dark' ? '☀️' : '🌙';
    };

    // Firebase

    const app     = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const auth    = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);

    const CLOUDINARY_CLOUD  = 'YOUR_CLOUDINARY_CLOUD_NAME';
    const CLOUDINARY_PRESET = 'YOUR_CLOUDINARY_UPLOAD_PRESET';

    let alleArtikel   = [];
    let alleBereiche  = [];
    let alleBestellungen = [];
    let _currentRole  = null;
    let currentPin    = '1234';
    let newPinValue   = '';
    let pinVisible    = false;
    let chargenFilter = 'alle';
    let chargenSort   = 'bereich';
    let currentBest   = null;
    let currentFotoType = 'produkt';

    // ── Auth ──
    onAuthStateChanged(auth, async user => {
      if (!user) { window.location.href = 'login.html'; return; }
      let snap, role;
      try {
        snap = await getDoc(doc(db, 'users', user.uid));
        role = snap.exists() ? snap.data().role : null;
      } catch (e) {
        role = null;
      }
      // Fallback: sessionStorage role (set by doWlLogin after successful Firebase auth)
      if (role !== 'wachenleiter' && role !== 'admin') {
        const ssRole = sessionStorage.getItem('lager-portal-role');
        if (ssRole === 'wachenleiter' || ssRole === 'admin') {
          role = ssRole;
        } else {
          window.location.href = 'login.html?tab=wachenleiter'; return;
        }
      }
      _currentRole = role;
      const displayName = snap?.data()?.name || user.email;
      window._portalDisplayName = displayName;
      document.getElementById('nav-user').textContent = '';
      document.getElementById('auth-loading').classList.add('hidden');
      document.getElementById('portal-layout').classList.remove('hidden');
      document.getElementById('bottom-nav').classList.remove('hidden');
      document.getElementById('dashboard-greeting').textContent = `Willkommen, ${displayName}`;
      const sidebarName = document.getElementById('sidebar-user-name');
      if (sidebarName) sidebarName.textContent = displayName;
      const sidebarAvatar = document.getElementById('sidebar-user-avatar');
      if (sidebarAvatar) {
        const avatarUrl = snap?.data()?.avatarUrl;
        if (avatarUrl) {
          sidebarAvatar.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;
        } else {
          sidebarAvatar.textContent = (displayName[0] || 'W').toUpperCase();
        }
      }

      // Admin-Button nur für Admins anzeigen
      if (role === 'admin') {
        const adminBtn = document.createElement('a');
        adminBtn.href = 'admin.html';
        adminBtn.className = 'nav-action-btn hide-mobile';
        adminBtn.textContent = '⚙️ Admin';
        document.querySelector('.p-btn-logout').before(adminBtn);
      }

      setupWachenSelect(role, snap?.data());
      await loadAll();
      setupSessionListener();
    });

    // ── Wachenleiter Avatar Upload ──
    document.getElementById('wl-avatar-input')?.addEventListener('change', async function() {
      const file = this.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', CLOUDINARY_PRESET);
      formData.append('folder', 'avatars');
      const avatarEl = document.getElementById('sidebar-user-avatar');
      const prev = avatarEl?.innerHTML || avatarEl?.textContent || '';
      try {
        const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!data.secure_url) throw new Error(data.error?.message || 'Upload fehlgeschlagen');
        if (avatarEl) avatarEl.innerHTML = `<img src="${data.secure_url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">`;
        const fbUser = auth.currentUser;
        if (fbUser) await updateDoc(doc(db, 'users', fbUser.uid), { avatarUrl: data.secure_url });
        showPortalToast('Profilbild gespeichert', 'success');
      } catch (e) {
        if (avatarEl) { avatarEl.innerHTML = ''; avatarEl.textContent = prev; }
        showPortalToast('Upload fehlgeschlagen: ' + e.message, 'error');
      }
      this.value = '';
    });

    window.doLogout = async function() {
      ['lager-pin-auth','lager-pin-name','lager-employee-id','lager-portal-role'].forEach(k => {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
      });
      localStorage.removeItem('lager-keep-login');
      await signOut(auth);
      window.location.href = 'login.html';
    };

    function setupWachenSelect(role, userData) {
      const sel = document.getElementById('wachen-select');
      if (!sel) return;

      // Heimat-Wache beim Login setzen, aber nur wenn noch keine Wache aktiv
      const heimatWache = userData?.wache;
      if (heimatWache && WACHEN[heimatWache] && !getActiveWache()) {
        switchWache(heimatWache);
      }

      // Alle 4 Wachen im Dropdown (Urlaubsvertretung möglich)
      sel.innerHTML = Object.keys(WACHEN).map(id =>
        `<option value="${id}" ${id === getActiveWache() ? 'selected' : ''}>${WACHEN[id]?.label ?? id}</option>`
      ).join('');
      sel.classList.remove('hidden');
    }

    window.onWacheSelect = async function(id) {
      if (!id || id === getActiveWache()) return;
      switchWache(id);
      await loadAll();
      showPortalToast(`Gewechselt zu ${WACHEN[id]?.label ?? id}`, 'success');
    };

    window.goToMitarbeiter = function() {
      const name = window._portalDisplayName || document.getElementById('nav-user').textContent;
      sessionStorage.setItem('lager-pin-auth', 'true');
      sessionStorage.setItem('lager-portal-role', _currentRole || 'wachenleiter');
      if (name) sessionStorage.setItem('lager-pin-name', name);
      window.location.href = 'mitarbeiter.html';
    };

    window.toggleMobileNav = function() {
      openBottomSheet();
    };

    // ── Load All ──
    async function loadAll() {
      const [bSnap, aSnap, bestSnap, configSnap] = await Promise.all([
        getDocs(query(collection(db, `${getDBRoot()}/bereiche`), orderBy('reihenfolge'))),
        getDocs(collection(db, `${getDBRoot()}/artikel`)),
        getDocs(query(collection(db, `${getDBRoot()}/bestellungen`), orderBy('datum', 'desc'), limit(50))),
        getDoc(doc(db, `${getDBRoot()}/config`, 'app')),
      ]);

      alleBereiche     = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      alleArtikel      = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      alleBestellungen = bestSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (configSnap.exists()) {
        currentPin = configSnap.data().pin || '1234';
        const lbText = configSnap.data().laufband || '';
        const lbInput = document.getElementById('laufband-input');
        if (lbInput) { lbInput.value = lbText; updateLaufbandPreview(); }
      }

      renderDashboard();
      renderBestellungen();
      renderChargen();
      renderArtikelTable(alleArtikel);
      renderBereiche();
      renderFotos();
      populateBereichFilter();
      populateFotoSelect();
      populateSsBereichFilter();
      populateFotoBereichFilter();
    }

    // ── Navigation ──
    const moreSheetSections = ['artikel','bereiche','fotos','ss-fotos','statistik','pin','sessions','verfallskalender','rollen','mitarbeiter','anleitung','laufband'];

    window.showSection = function(name) {
      document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.bottom-tab').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.bottom-sheet-item').forEach(s => s.classList.remove('active'));
      document.getElementById(`section-${name}`).classList.add('active');
      const nav = document.getElementById(`nav-${name}`);
      if (nav) nav.classList.add('active');
      const bottomTab = document.querySelector(`.bottom-tab[data-section="${name}"]`);
      if (bottomTab) {
        bottomTab.classList.add('active');
      } else if (moreSheetSections.includes(name)) {
        document.getElementById('bottom-more-tab').classList.add('active');
        const sheetItem = document.querySelector(`.bottom-sheet-item[data-section="${name}"]`);
        if (sheetItem) sheetItem.classList.add('active');
      }
      if (name === 'statistik') renderStatistik();
      if (name === 'ss-fotos') renderSsFotos();
      if (name === 'anleitung') renderAnleitung();
      if (name === 'verfallskalender') renderVerfallskalender();
      if (name === 'rollen') loadRollen();
      if (name === 'mitarbeiter') loadMitarbeiter();
    };

    window.openBottomSheet = function() {
      document.getElementById('bottom-sheet-backdrop').classList.remove('hidden');
      document.getElementById('bottom-sheet-backdrop').classList.add('open');
      document.getElementById('bottom-sheet').classList.add('open');
    };

    window.closeBottomSheet = function() {
      document.getElementById('bottom-sheet-backdrop').classList.remove('open');
      document.getElementById('bottom-sheet').classList.remove('open');
      setTimeout(() => document.getElementById('bottom-sheet-backdrop').classList.add('hidden'), 300);
    };

    function esc(str) {
      return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function prettyBereich(name) {
      return String(name ?? '').replace(/^Lager\s*[-–]\s*/i, '').trim();
    }

    // ── Analytics (echte Firestore-Daten) ──
    function renderAnalytics() {
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const lagerchecksMonat = alleBestellungen.filter(b => {
        const d = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
        return d >= firstOfMonth;
      }).length;

      const kritischeArtikel = alleArtikel.filter(a =>
        (a.items || []).some(it => it.status === 'crit') ||
        (a.status === 'crit')
      );

      // KPI Cards
      document.getElementById('analytics-kpis').innerHTML = `
        <div class="la-card outline" style="padding:16px 18px;">
          <div style="font-size:10px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);margin-bottom:6px;">Lagerchecks (dieser Monat)</div>
          <div style="font-size:32px;font-weight:700;letter-spacing:-.5px;line-height:1;font-family:var(--font-mono)">${lagerchecksMonat}</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">${alleBestellungen.length} gesamt in den letzten 50</div>
        </div>
        <div class="la-card outline" style="padding:16px 18px;">
          <div style="font-size:10px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);margin-bottom:6px;">Kritische Artikel</div>
          <div style="font-size:32px;font-weight:700;letter-spacing:-.5px;line-height:1;font-family:var(--font-mono);color:var(--crit)">${kritischeArtikel.length}</div>
          <div style="font-size:11px;color:var(--crit);margin-top:4px;">${kritischeArtikel.length > 0 ? 'Sofort nachbestellen' : 'Alles im grünen Bereich'}</div>
        </div>`;

      // Letzte Bestellungen Tabelle
      const bestellRows = alleBestellungen.slice(0, 10).map((b, i) => {
        const d = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
        const dateStr = isNaN(d) ? '–' : d.toLocaleDateString('de-DE');
        const cnt = (b.items || b.nachbestellungen || []).length || '–';
        return `<tr class="${i < alleBestellungen.slice(0,10).length - 1 ? 'lin-tr' : ''}">
          <td class="lin-td" style="font-family:var(--font-mono);font-size:12px;">${dateStr}</td>
          <td class="lin-td" style="font-size:13px;">${esc(b.mitarbeiter || b.name || '–')}</td>
          <td class="lin-td" style="text-align:right;font-family:var(--font-mono);font-size:12px;">${cnt}</td>
        </tr>`;
      }).join('');
      document.getElementById('analytics-bestellungen-tbody').innerHTML =
        bestellRows || '<tr><td colspan="3" class="lin-td" style="text-align:center;color:var(--ink-3);">Keine Bestellungen</td></tr>';

      // Kritische Artikel Tabelle
      const kritRows = kritischeArtikel.slice(0, 10).map((a, i) => {
        const bereich = alleBereiche.find(b => b.id === a.bereich)?.name || a.bereich || '–';
        return `<tr class="${i < kritischeArtikel.slice(0,10).length - 1 ? 'lin-tr' : ''}">
          <td class="lin-td" style="font-size:13px;font-weight:500;">${esc(a.name)}</td>
          <td class="lin-td" style="font-size:12px;color:var(--ink-2);">${esc(bereich)}</td>
          <td class="lin-td" style="text-align:center;"><span class="la-chip crit" style="height:18px;font-size:10px;"><span class="dot"></span>Kritisch</span></td>
        </tr>`;
      }).join('');
      document.getElementById('analytics-kritisch-tbody').innerHTML =
        kritRows || '<tr><td colspan="3" class="lin-td" style="text-align:center;color:var(--ok);">Keine kritischen Artikel</td></tr>';
    }

    // ── Live Sessions (echte Firestore-Daten via onSnapshot) ──
    function setupSessionListener() {
      onSnapshot(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'), (snap) => {
        const activeCard = document.getElementById('sessions-active-card');
        const noActive   = document.getElementById('sessions-no-active');
        const badge      = document.getElementById('session-live-badge');

        if (snap.exists() && snap.data().status === 'aktiv') {
          const s = snap.data();
          badge.style.display = 'inline-flex';
          activeCard.style.display = 'block';
          noActive.style.display   = 'none';

          // Meta info
          document.getElementById('sessions-active-meta').textContent =
            `PIN ···· · Gestartet ${s.startedAt?.toDate
              ? s.startedAt.toDate().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})
              : 'Unbekannt'}`;

          // Teilnehmer
          const teilnehmer = (s.teilnehmer || []);
          document.getElementById('sessions-active-teilnehmer').innerHTML = teilnehmer.length
            ? teilnehmer.map(t => `<div style="display:flex;align-items:center;gap:8px;">
                <span class="la-av live" style="width:28px;height:28px;font-size:10px;">${esc(t.name||'?').slice(0,2).toUpperCase()}</span>
                <span style="font-size:13px;">${esc(t.name)}</span>
              </div>`).join('')
            : '<span style="font-size:13px;color:var(--ink-3);">Keine Teilnehmer</span>';

          // Bereiche
          const bereichStatus = s.bereichStatus || {};
          const bereichRows = Object.entries(bereichStatus).map(([bid, bs]) => {
            const bName = alleBereiche.find(b => b.id === bid)?.name || bid;
            const dot = bs.status === 'erledigt' ? '🟢' : bs.status === 'gesperrt' ? '🟠' : bs.status === 'abgebrochen' ? '🔴' : '⚪';
            return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2);padding:3px 0;">
              <span>${dot}</span><span>${esc(bName)}</span>
              ${bs.mitarbeiter ? `<span style="color:var(--ink-3)">· ${esc(bs.mitarbeiter)}</span>` : ''}
            </div>`;
          });
          document.getElementById('sessions-active-bereiche').innerHTML =
            bereichRows.length ? bereichRows.join('') : '<span style="font-size:12px;color:var(--ink-3);">Noch kein Bereich gestartet</span>';
        } else {
          badge.style.display   = 'none';
          activeCard.style.display = 'none';
          noActive.style.display   = 'block';
        }

        // Vergangene Bestellungen
        const rows = alleBestellungen.slice(0, 10).map((b, i) => {
          const d = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
          const dateStr = isNaN(d) ? '–' : d.toLocaleDateString('de-DE');
          const cnt = (b.items || b.nachbestellungen || []).length || '–';
          return `<tr class="${i < 9 ? 'lin-tr' : ''}">
            <td class="lin-td" style="font-family:var(--font-mono);font-size:12px;">${dateStr}</td>
            <td class="lin-td" style="font-size:13px;">${esc(b.mitarbeiter || b.name || '–')}</td>
            <td class="lin-td" style="text-align:right;font-family:var(--font-mono);font-size:12px;">${cnt}</td>
          </tr>`;
        }).join('');
        document.getElementById('sessions-past-tbody').innerHTML =
          rows || '<tr><td colspan="3" class="lin-td" style="text-align:center;color:var(--ink-3);">Keine vergangenen Bestellungen</td></tr>';
      }, () => {
        document.getElementById('sessions-no-active').style.display = 'block';
      });
    }

    // ── Session Reset ──
    window.resetSession = async function() {
      const ok = confirm(
        'Session komplett zurücksetzen?\n\n' +
        'Dadurch wird die laufende Bestellung gelöscht – alle Bereiche und Warenkorb-Einträge gehen verloren.\n\n' +
        'Nur nutzen wenn die Session feststeckt!'
      );
      if (!ok) return;

      try {
        // Delete all warenkorb docs for this session
        const wSnap = await getDocs(
          query(collection(db, `${getDBRoot()}/warenkorb`), where('sessionId', '==', 'current'))
        );
        if (!wSnap.empty) {
          const batch = writeBatch(db);
          wSnap.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }

        // Delete the session document
        await deleteDoc(doc(db, `${getDBRoot()}/bestellungen_session`, 'current'));

        showPortalToast('Session wurde zurückgesetzt', 'success');
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    // ── Laufband ──
    window.updateLaufbandPreview = function() {
      const text = document.getElementById('laufband-input')?.value.trim() || '';
      const el = document.getElementById('laufband-preview-text');
      if (el) el.textContent = text || '(kein Text)';
    };

    window.saveLaufband = async function() {
      const text = document.getElementById('laufband-input')?.value.trim() || '';
      try {
        await setDoc(doc(db, `${getDBRoot()}/config`, 'app'), { laufband: text }, { merge: true });
        showPortalToast('Laufband gespeichert', 'success');
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    window.clearLaufband = async function() {
      const input = document.getElementById('laufband-input');
      if (input) input.value = '';
      updateLaufbandPreview();
      try {
        await setDoc(doc(db, `${getDBRoot()}/config`, 'app'), { laufband: '' }, { merge: true });
        showPortalToast('Laufband gelöscht', 'success');
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    // ── Verfallskalender ──
    window.setVkView = function(view) {
      document.getElementById('vk-view-liste').style.display    = view === 'liste' ? '' : 'none';
      document.getElementById('vk-view-kalender').style.display = view === 'kalender' ? '' : 'none';
      const btnL = document.getElementById('vk-btn-liste');
      const btnK = document.getElementById('vk-btn-kalender');
      btnL.style.background  = view === 'liste'    ? 'var(--surface-3)' : 'transparent';
      btnK.style.background  = view === 'kalender' ? 'var(--surface-3)' : 'transparent';
      btnL.style.fontWeight  = view === 'liste'    ? '600' : '400';
      btnK.style.fontWeight  = view === 'kalender' ? '600' : '400';
      btnL.style.color       = view === 'liste'    ? 'var(--ink)'  : 'var(--ink-3)';
      btnK.style.color       = view === 'kalender' ? 'var(--ink)'  : 'var(--ink-3)';
    };

    let vkRendered = false;
    function renderVerfallskalender() {
      if (vkRendered) return;
      vkRendered = true;

      const heute = new Date();
      heute.setHours(0, 0, 0, 0);

      // Collect all charges with a verfall date
      const charges = [];
      for (const a of alleArtikel) {
        for (const c of (a.chargen || [])) {
          if (!c.verfall) continue;
          const exp  = new Date(c.verfall);
          const days = Math.round((exp - heute) / 86400000);
          const bereich = alleBereiche.find(b => b.id === a.bereichId)?.name || a.bereichId || '–';
          charges.push({ a, c, days, exp, bereich });
        }
      }
      charges.sort((x, y) => x.days - y.days);

      // Bucket counts
      const akut    = charges.filter(x => x.days <= 7).length;
      const monat   = charges.filter(x => x.days > 7  && x.days <= 30).length;
      const spaeter = charges.filter(x => x.days > 30).length;
      document.getElementById('vk-count-akut').textContent    = akut;
      document.getElementById('vk-count-monat').textContent   = monat;
      document.getElementById('vk-count-spaeter').textContent = spaeter;

      // Badge
      const badge = document.getElementById('vk-badge');
      const badgeCount = document.getElementById('vk-badge-count');
      if (akut > 0) {
        badge.style.display = 'inline-flex';
        badge.className = 'la-chip crit';
        badgeCount.textContent = akut;
      } else if (monat > 0) {
        badge.style.display = 'inline-flex';
        badge.className = 'la-chip low';
        badgeCount.textContent = monat;
      } else {
        badge.style.display = 'none';
      }

      // Liste-View
      const timeline = document.getElementById('vk-timeline-list');
      if (charges.length === 0) {
        timeline.innerHTML = '<div style="padding:20px 16px;font-size:13px;color:var(--ink-3);text-align:center;">Keine Chargen mit Verfallsdatum erfasst</div>';
      } else {
        timeline.innerHTML = charges.map((x, i) => {
          const isLast = i === charges.length - 1;
          let dotColor = 'var(--ink-4)';
          let daysLabel = '';
          if (x.days < 0) {
            dotColor = 'var(--crit)';
            daysLabel = `Abgelaufen vor ${Math.abs(x.days)} Tag${Math.abs(x.days) === 1 ? '' : 'en'}`;
          } else if (x.days === 0) {
            dotColor = 'var(--crit)';
            daysLabel = 'Läuft heute ab';
          } else if (x.days <= 7) {
            dotColor = 'var(--crit)';
            daysLabel = `Noch ${x.days} Tag${x.days === 1 ? '' : 'e'}`;
          } else if (x.days <= 30) {
            dotColor = 'var(--low)';
            daysLabel = `Noch ${x.days} Tage`;
          } else {
            dotColor = 'var(--ok)';
            daysLabel = `Noch ${x.days} Tage`;
          }
          const verfallStr = x.exp.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
          return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;${isLast ? '' : 'border-bottom:1px solid var(--hairline);'}">
            <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;"></span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(x.a.name)}</div>
              <div style="font-size:11px;color:var(--ink-3);margin-top:1px;">${esc(prettyBereich(x.bereich))}${x.c.lot ? ` · LOT ${esc(x.c.lot)}` : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:12px;font-family:var(--font-mono);">${verfallStr}</div>
              <div style="font-size:11px;color:${dotColor};margin-top:1px;">${daysLabel}</div>
            </div>
          </div>`;
        }).join('');
      }

      // Kalender-View: 6-Monats-Heatmap
      const grid = document.getElementById('vk-heatmap-grid');
      const monthCards = [];
      for (let m = 0; m < 6; m++) {
        const d = new Date(heute.getFullYear(), heute.getMonth() + m, 1);
        const year  = d.getFullYear();
        const month = d.getMonth();
        const monthCharges = charges.filter(x => {
          return x.exp.getFullYear() === year && x.exp.getMonth() === month;
        });
        const akutM    = monthCharges.filter(x => x.days <= 7).length;
        const monatM   = monthCharges.filter(x => x.days > 7 && x.days <= 30).length;
        const spaeterM = monthCharges.filter(x => x.days > 30).length;
        const isThisMonth = m === 0;
        const color = akutM > 0 ? 'var(--crit)' : monatM > 0 ? 'var(--low)' : spaeterM > 0 ? '#F0A12E' : 'var(--ink-4)';
        const monthName = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
        monthCards.push(`<div class="la-card outline" style="padding:12px;${isThisMonth ? 'box-shadow:inset 0 0 0 2px var(--brand);' : ''}">
          <div style="font-size:10px;font-family:var(--font-mono);color:${isThisMonth ? 'var(--brand)' : 'var(--ink-3)'};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${monthName}</div>
          <div style="font-size:22px;font-weight:700;color:${monthCharges.length > 0 ? color : 'var(--ink-4)'};">${monthCharges.length}</div>
          <div style="font-size:10px;color:var(--ink-3);margin-top:2px;">Charge${monthCharges.length !== 1 ? 'n' : ''}</div>
        </div>`);
      }
      grid.innerHTML = monthCards.join('');
    }

    // ── Konten & Rollen (echte Firestore-Daten) ──
    let alleUsers = [];
    let aktiverRollenFilter = 'alle';

    async function loadRollen() {
      if (alleUsers.length > 0) { renderRollen(); return; }
      try {
        const snap = await getDocs(collection(db, 'users'));
        alleUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderRollen();
      } catch(e) {
        document.getElementById('rollen-liste').innerHTML =
          `<div style="padding:12px 16px;font-size:13px;color:var(--crit);">Fehler: ${esc(e.message)}</div>`;
      }
    }

    function renderRollen() {
      const rollenMap = {};
      alleUsers.forEach(u => {
        const r = u.role || 'unbekannt';
        rollenMap[r] = (rollenMap[r] || []);
        rollenMap[r].push(u);
      });

      // Rollen-Panel
      const alleRollenListe = [{ id: 'alle', label: 'Alle', count: alleUsers.length }];
      Object.entries(rollenMap).forEach(([r, users]) => {
        alleRollenListe.push({ id: r, label: r.charAt(0).toUpperCase() + r.slice(1), count: users.length });
      });

      document.getElementById('rollen-liste').innerHTML = alleRollenListe.map(r => `
        <div onclick="setRollenFilter('${esc(r.id)}')"
             style="padding:10px 16px;cursor:pointer;border-left:2px solid ${aktiverRollenFilter===r.id?'var(--brand)':'transparent'};
                    background:${aktiverRollenFilter===r.id?'var(--surface)':'transparent'};
                    display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;font-weight:${aktiverRollenFilter===r.id?'600':'400'}">${esc(r.label)}</span>
          <span style="font-size:11px;color:var(--ink-3);font-family:var(--font-mono);">${r.count}</span>
        </div>`).join('');

      renderRollenUsers();
    }

    window.setRollenFilter = function(rolle) {
      aktiverRollenFilter = rolle;
      renderRollen();
    };

    window.filterRollenSearch = function() {
      renderRollenUsers();
    };

    function renderRollenUsers() {
      const search = (document.getElementById('rollen-search')?.value || '').toLowerCase();
      const filtered = alleUsers.filter(u => {
        const matchRole = aktiverRollenFilter === 'alle' || u.role === aktiverRollenFilter;
        const matchSearch = !search ||
          (u.name || '').toLowerCase().includes(search) ||
          (u.email || '').toLowerCase().includes(search);
        return matchRole && matchSearch;
      });

      const label = aktiverRollenFilter === 'alle' ? 'Alle Konten' :
        `${aktiverRollenFilter.charAt(0).toUpperCase()}${aktiverRollenFilter.slice(1)} · ${filtered.length} Konto${filtered.length !== 1 ? 'en' : ''}`;
      document.getElementById('rollen-user-header').textContent = label;

      const rows = filtered.map((u, i) => {
        const d = u.createdAt ? new Date(u.createdAt).toLocaleDateString('de-DE') : '–';
        return `<tr class="${i < filtered.length - 1 ? 'lin-tr' : ''}">
          <td class="lin-td" style="font-size:13px;font-weight:500;">${esc(u.name || '–')}</td>
          <td class="lin-td" style="font-size:12px;color:var(--ink-2);font-family:var(--font-mono);">${esc(u.email || '–')}</td>
          <td class="lin-td"><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;
            background:${u.role==='admin'?'var(--crit-soft)':u.role==='wachenleiter'?'var(--brand-soft)':'var(--surface-3)'};
            color:${u.role==='admin'?'var(--crit)':u.role==='wachenleiter'?'var(--brand)':'var(--ink-2)'}">
            ${esc(u.role || '–')}</span></td>
          <td class="lin-td" style="font-size:12px;color:var(--ink-3);">${d}</td>
        </tr>`;
      }).join('');

      document.getElementById('rollen-user-tbody').innerHTML =
        rows || '<tr><td colspan="4" class="lin-td" style="text-align:center;color:var(--ink-3);">Keine Konten gefunden</td></tr>';
    }

    // ── Toast ──
    function toast(msg, type = 'success') {
      const existing = document.querySelector('.toast-msg');
      if (existing) existing.remove();
      const t = document.createElement('div');
      t.className = `toast-msg ${type}`;
      t.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    }

    // ── DASHBOARD ──
    function renderDashboard() {
      document.getElementById('kpi-artikel').textContent = alleArtikel.length;
      document.getElementById('kpi-total').textContent   = alleBestellungen.length;

      if (alleBestellungen.length > 0) {
        const last = alleBestellungen[0];
        const d = last.datum?.toDate ? last.datum.toDate() : new Date();
        document.getElementById('kpi-last').textContent     = d.toLocaleDateString('de-DE');
        document.getElementById('kpi-last-sub').textContent = last.mitarbeiter || '–';
      }

      const kritisch = alleArtikel.filter(a =>
        (a.chargen||[]).some(c => {
          const days = Math.round((new Date(c.verfall||'9999') - new Date()) / (1000*60*60*24));
          return days <= 30;
        })
      ).length;
      document.getElementById('kpi-verfall').textContent = kritisch;
      document.getElementById('kpi-verfall').style.color = kritisch > 0 ? 'var(--red)' : 'var(--green)';

      const last5 = alleBestellungen.slice(0, 5);
      const wrap  = document.getElementById('dashboard-bestellungen');
      if (last5.length === 0) {
        wrap.innerHTML = '<div class="empty-state">Noch keine Lagerchecks</div>';
        return;
      }
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">Mitarbeiter</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">Datum</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">Nachbestell.</th>
          <th style="padding:8px 14px;text-align:left;font-size:0.62rem;color:var(--muted);text-transform:uppercase;font-family:'IBM Plex Mono',monospace;background:var(--surface2);border-bottom:1px solid var(--border);">PDF</th>
        </tr></thead>
        <tbody>${last5.map(b => {
          const d  = b.datum?.toDate ? b.datum.toDate() : new Date();
          const nb = (b.items || b.nachbestellungen || []).length;
          return `<tr style="cursor:pointer;" onclick="openDetail('${b.id}')">
            <td style="padding:10px 14px;font-size:0.82rem;font-weight:600;border-bottom:1px solid var(--border);">${b.mitarbeiter||'–'}</td>
            <td style="padding:10px 14px;font-size:0.75rem;font-family:'IBM Plex Mono',monospace;color:var(--muted);border-bottom:1px solid var(--border);">${d.toLocaleDateString('de-DE')}</td>
            <td style="padding:10px 14px;font-size:0.75rem;border-bottom:1px solid var(--border);color:${nb>0?'var(--red)':'var(--green)'};">${nb>0?`⚠️ ${nb}`:'✅ Keine'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid var(--border);">
              <div style="display:flex;gap:4px;">
                <button class="tbl-btn" onclick="event.stopPropagation();quickPDF('${b.id}',this)">↓ PDF</button>
                <button class="tbl-btn del" onclick="event.stopPropagation();deleteBestellung('${b.id}')">🗑️</button>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    }

    // ── BESTELLUNGEN ──
    function renderBestellungen() {
      const list = document.getElementById('bestellungen-list');
      if (alleBestellungen.length === 0) {
        list.innerHTML = '<div class="empty-state">Noch keine Lagerchecks</div>';
        return;
      }
      list.innerHTML = alleBestellungen.map(b => {
        const d  = b.datum?.toDate ? b.datum.toDate() : new Date();
        const nb = (b.items || b.nachbestellungen || []).length;
        return `
          <div class="bestellung-item" onclick="openDetail('${b.id}')">
            <div class="bestellung-icon">📋</div>
            <div class="bestellung-info">
              <div class="bestellung-name">${b.mitarbeiter||'Unbekannt'}</div>
              <div class="bestellung-meta">${d.toLocaleDateString('de-DE')} · ${d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</div>
              ${nb>0?`<div class="bestellung-warn">⚠️ ${nb} Artikel nachbestellen</div>`:'<div style="font-size:0.68rem;color:var(--green);">✅ Alles in Ordnung</div>'}
            </div>
            <button class="tbl-btn" onclick="event.stopPropagation();quickPDF('${b.id}',this)">↓ PDF</button>
          </div>`;
      }).join('');
    }

    // ── CHARGEN (Fach für Fach) ──
    window.setChargenFilter = function(f) {
      chargenFilter = f;
      ['alle','kritisch','ok'].forEach(x =>
        document.getElementById(`cf-${x}`).classList.toggle('active', x === f)
      );
      renderChargen();
    };

    window.setChargenSort = function(s) {
      chargenSort = s;
      ['bereich','verfall','name'].forEach(x => {
        const el = document.getElementById(`sort-${x}`);
        if (el) el.classList.toggle('active', x === s);
      });
      renderChargen();
    };

    function renderChargen() {
      const container = document.getElementById('chargen-content');
      const heute     = new Date();
      let totalChargen = 0;

      // Alle Chargen sammeln
      let allRows = [];
      for (const a of alleArtikel) {
        const bereich = alleBereiche.find(b => b.id === a.bereich);
        for (const c of (a.chargen || [])) {
          const days = Math.round((new Date(c.verfall||'9999') - heute) / (1000*60*60*24));
          if (chargenFilter === 'kritisch' && days > 30)  continue;
          if (chargenFilter === 'ok'       && days <= 30) continue;
          allRows.push({ artikel: a, charge: c, days, bereich });
        }
      }

      if (allRows.length === 0) {
        container.innerHTML = '<div class="empty-state">🟢 Keine Chargen gefunden</div>';
        return;
      }

      // Sortierung
      if (chargenSort === 'verfall') {
        allRows.sort((a, b) => a.days - b.days);
      } else if (chargenSort === 'name') {
        allRows.sort((a, b) => (a.artikel.name||'').localeCompare(b.artikel.name||''));
      } else {
        // Bereich-Sortierung (nach Reihenfolge in alleBereiche)
        const bereichOrder = {};
        alleBereiche.forEach((b, i) => bereichOrder[b.id] = i);
        allRows.sort((a, b) => {
          const bo = (bereichOrder[a.artikel.bereich]||99) - (bereichOrder[b.artikel.bereich]||99);
          if (bo !== 0) return bo;
          return naturalSort(a.artikel.lp||'', b.artikel.lp||'');
        });
      }

      totalChargen = allRows.length;

      // Gruppieren
      let html    = '';
      let lastKey = null;

      for (const { artikel: a, charge: c, days, bereich } of allRows) {
        const color = days <= 0 ? 'var(--red)' : days <= 7 ? 'var(--red)' : days <= 30 ? 'var(--yellow)' : 'var(--green)';
        const label = days <= 0 ? 'ABGELAUFEN' : days <= 30 ? `${days} Tage` : `${Math.round(days/30)} Mon.`;

        // Gruppenheader
        let groupKey;
        if (chargenSort === 'bereich') {
          groupKey = a.bereich;
          if (groupKey !== lastKey) {
            if (lastKey !== null) html += '</div>';
            const icon = getBereichIcon(bereich?.name||'');
            html += `<div class="bereich-group">
              <div class="bereich-group-header">
                <span class="bereich-group-icon">${icon}</span>
                ${esc(prettyBereich(bereich?.name||'Unbekannt'))}
              </div>`;
            lastKey = groupKey;
          }
        } else if (chargenSort === 'verfall') {
          groupKey = days <= 0 ? 'abgelaufen' : days <= 7 ? 'kritisch' : days <= 30 ? 'bald' : 'ok';
          if (groupKey !== lastKey) {
            if (lastKey !== null) html += '</div>';
            const labels = { abgelaufen:'🔴 Abgelaufen', kritisch:'🔴 Kritisch (≤7 Tage)', bald:'🟡 Bald (≤30 Tage)', ok:'🟢 OK' };
            html += `<div class="bereich-group">
              <div class="bereich-group-header">${labels[groupKey]}</div>`;
            lastKey = groupKey;
          }
        } else {
          // Name – keine Gruppen
          if (lastKey === null) {
            html += '<div class="bereich-group">';
            lastKey = 'all';
          }
        }

        // Charge-Zeile mit Bearbeiten-Button
        const chargeIdx = (a.chargen||[]).findIndex(x => x.lot === c.lot && x.verfall === c.verfall);
        html += `
          <div class="charge-row" id="crow-${a.id}-${chargeIdx}">
            <div class="charge-dot" style="background:${color}"></div>
            <div class="charge-info" style="flex:1;min-width:0;">
              <div class="charge-name">${a.name}</div>
              <div class="charge-lot">LOT: ${c.lot||'–'} · ${c.verfall ? new Date(c.verfall).toLocaleDateString('de-DE',{month:'2-digit',year:'numeric'}) : '–'} · ${a.lp||''}</div>
            </div>
            <div class="charge-days" style="color:${color};flex-shrink:0;">${label}</div>
            <button class="charge-del" style="color:var(--accent2);font-size:0.75rem;padding:4px 6px;"
              onclick="editCharge('${a.id}',${chargeIdx})">✏️</button>
            <button class="charge-del"
              onclick="deleteCharge('${a.id}','${c.lot}','${c.verfall||''}')">✕</button>
          </div>`;
      }

      if (lastKey !== null) html += '</div>';
      container.innerHTML = html;
    }

    // ── Charge bearbeiten ──
    window.editCharge = function(artikelId, idx) {
      const a = alleArtikel.find(x => x.id === artikelId);
      if (!a) return;
      const c = (a.chargen||[])[idx];
      if (!c) return;

      // Inline-Edit einblenden
      const rowEl = document.getElementById(`crow-${artikelId}-${idx}`);
      if (!rowEl) return;

      rowEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;width:100%;padding:4px 0;">
          <div style="font-size:0.8rem;font-weight:600;color:var(--text2);">${a.name}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-size:0.6rem;color:var(--muted);font-family:'IBM Plex Mono',monospace;margin-bottom:2px;">CHARGE / LOT</div>
              <input type="text" id="edit-lot-${artikelId}-${idx}" value="${c.lot||''}"
                style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.82rem;width:140px;">
            </div>
            <div>
              <div style="font-size:0.6rem;color:var(--muted);font-family:'IBM Plex Mono',monospace;margin-bottom:2px;">VERFALLSDATUM</div>
              <input type="date" id="edit-verfall-${artikelId}-${idx}" value="${c.verfall||''}"
                style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.82rem;">
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="saveEditCharge('${artikelId}',${idx})"
              style="padding:6px 14px;border-radius:8px;background:var(--green);color:#fff;border:none;font-family:'DM Sans',sans-serif;font-size:0.8rem;font-weight:600;cursor:pointer;">
              ✅ Speichern
            </button>
            <button onclick="renderChargen()"
              style="padding:6px 14px;border-radius:8px;background:var(--surface2);color:var(--text2);border:1px solid var(--border);font-family:'DM Sans',sans-serif;font-size:0.8rem;cursor:pointer;">
              Abbrechen
            </button>
          </div>
        </div>`;
    };

    window.saveEditCharge = async function(artikelId, idx) {
      const newLot    = document.getElementById(`edit-lot-${artikelId}-${idx}`)?.value.trim();
      const newVerfall= document.getElementById(`edit-verfall-${artikelId}-${idx}`)?.value;

      const a = alleArtikel.find(x => x.id === artikelId);
      if (!a) return;

      const chargen = [...(a.chargen||[])];
      chargen[idx]  = { ...chargen[idx], lot: newLot, verfall: newVerfall || null };

      await updateDoc(doc(db, `${getDBRoot()}/artikel`, artikelId), { chargen });
      const i = alleArtikel.findIndex(x => x.id === artikelId);
      if (i >= 0) alleArtikel[i].chargen = chargen;

      showPortalToast('Charge gespeichert ✅');
      renderChargen();
    };

    // ── Natürliche Sortierung für LP-Nummern ──
    function naturalSort(a, b) {
      const seg = s => (s||'').split(/[.\-]/).map(x => isNaN(x) ? x : parseInt(x,10));
      const sa = seg(a), sb = seg(b);
      for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
        const va = sa[i] ?? '', vb = sb[i] ?? '';
        if (va < vb) return -1;
        if (va > vb) return  1;
      }
      return 0;
    }

    function getBereichIcon(name) {
      const n = name.toLowerCase();
      if (n.includes('schrank')) return '🗄️';
      if (n.includes('regal'))   return '📦';
      if (n.includes('sauer'))   return '🫧';
      if (n.includes('büro'))    return '📋';
      if (n.includes('küche'))   return '🍽️';
      if (n.includes('wasch'))   return '🚿';
      if (n.includes('mpg'))     return '🔋';
      if (n.includes('medika'))  return '💊';
      return '📁';
    }

    window.deleteCharge = async function(artikelId, lot, verfall) {
      if (!confirm(`Charge ${lot} wirklich löschen?`)) return;
      const a       = alleArtikel.find(x => x.id === artikelId);
      const chargen = (a.chargen||[]).filter(c => !(c.lot === lot && (c.verfall||'') === verfall));
      await updateDoc(doc(db, `${getDBRoot()}/artikel`, artikelId), { chargen });
      const idx = alleArtikel.findIndex(x => x.id === artikelId);
      if (idx >= 0) alleArtikel[idx].chargen = chargen;
      renderChargen();
      toast('Charge gelöscht');
    };

    // ── ARTIKEL ──
    function renderArtikelTable(data) {
      data = [...data].sort((a,b) => naturalSort(a.lp||'', b.lp||''));
      const tbody = document.getElementById('artikel-tbody');
      tbody.innerHTML = data.map(a => {
        const b = alleBereiche.find(x => x.id === a.bereich);
        return `<tr>
          <td data-label="Artikel" style="font-weight:600;max-width:200px;">${a.name}</td>
          <td data-label="Standort" style="font-family:'IBM Plex Mono',monospace;font-size:0.72rem;color:var(--accent);">${a.location||'–'}<br><span style="color:var(--muted);font-size:0.62rem;">${prettyBereich(b?.name||'–')}</span></td>
          <td data-label="MIN / MAX" style="font-family:'IBM Plex Mono',monospace;font-size:0.7rem;">${a.min??'–'} ${a.minEinheit||''} / ${a.max??'–'} ${a.maxEinheit||''}</td>
          <td data-label="Aktionen" style="display:flex;gap:6px;">
            <button class="tbl-btn" onclick="openArtikelModal('${a.id}')">✏️</button>
            <button class="tbl-btn del" onclick="deleteArtikel('${a.id}','${a.name.replace(/'/g,"\\'")}')">🗑️</button>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--muted);">Keine Artikel</td></tr>';
    }

    window.filterArtikel = function(val) {
      const q = (val || document.getElementById('artikel-search').value || '').toLowerCase();
      const b = document.getElementById('bereich-filter').value;
      renderArtikelTable(alleArtikel.filter(a =>
        (!q || a.name?.toLowerCase().includes(q) || a.lp?.toLowerCase().includes(q)) &&
        (!b || a.bereich === b)
      ));
    };

    function populateBereichFilter() {
      const sel = document.getElementById('bereich-filter');
      sel.innerHTML = '';
      const def = document.createElement('option'); def.value = ''; def.textContent = 'Alle Bereiche';
      sel.appendChild(def);
      alleBereiche.forEach(b => {
        const o = document.createElement('option'); o.value = b.id; o.textContent = prettyBereich(b.name);
        sel.appendChild(o);
      });
    }

    window.openArtikelModal = function(id) {
      const sel = document.getElementById('edit-bereich');
      sel.innerHTML = '';
      alleBereiche.forEach(b => {
        const o = document.createElement('option'); o.value = b.id; o.textContent = prettyBereich(b.name);
        sel.appendChild(o);
      });
      if (id) {
        const a = alleArtikel.find(x => x.id === id);
        document.getElementById('artikel-modal-title').textContent = 'Artikel bearbeiten';
        document.getElementById('edit-id').value       = a.id;
        document.getElementById('edit-name').value     = a.name||'';
        document.getElementById('edit-lp').value       = a.lp||'';
        document.getElementById('edit-location').value = a.location||'';
        document.getElementById('edit-bereich').value  = a.bereich||'';
        document.getElementById('edit-min').value      = a.min??'';
        document.getElementById('edit-minE').value     = a.minEinheit||'';
        document.getElementById('edit-max').value      = a.max??'';
        document.getElementById('edit-maxE').value     = a.maxEinheit||'';
        document.getElementById('edit-aliases').value  = (a.aliases||[]).join(', ');
        document.getElementById('edit-hinweis').value  = a.hinweis||'';
      } else {
        document.getElementById('artikel-modal-title').textContent = 'Neuer Artikel';
        ['edit-id','edit-name','edit-lp','edit-location','edit-min','edit-minE','edit-max','edit-maxE','edit-aliases','edit-hinweis'].forEach(i => document.getElementById(i).value = '');
      }
      document.getElementById('artikel-modal').classList.remove('hidden');
    };

    window.closeArtikelModal = () => document.getElementById('artikel-modal').classList.add('hidden');

    window.saveArtikel = async function() {
      const id   = document.getElementById('edit-id').value;
      const name = document.getElementById('edit-name').value.trim();
      if (!name) { toast('Name ist Pflichtfeld', 'error'); return; }
      const data = {
        name,
        lp:         document.getElementById('edit-lp').value.trim(),
        location:   document.getElementById('edit-location').value.trim(),
        bereich:    document.getElementById('edit-bereich').value,
        min:        parseFloat(document.getElementById('edit-min').value) || null,
        minEinheit: document.getElementById('edit-minE').value.trim(),
        max:        parseFloat(document.getElementById('edit-max').value) || null,
        maxEinheit: document.getElementById('edit-maxE').value.trim(),
        aliases:    document.getElementById('edit-aliases').value.split(',').map(s=>s.trim()).filter(Boolean),
        hinweis:    document.getElementById('edit-hinweis').value.trim(),
      };
      try {
        if (id) {
          await updateDoc(doc(db, `${getDBRoot()}/artikel`, id), data);
          const idx = alleArtikel.findIndex(a => a.id === id);
          if (idx >= 0) alleArtikel[idx] = { ...alleArtikel[idx], ...data };
          toast('Artikel gespeichert');
        } else {
          const ref = await addDoc(collection(db, `${getDBRoot()}/artikel`), { ...data, fotoUrl:'', chargen:[], aktiv:true });
          alleArtikel.push({ id: ref.id, ...data, fotoUrl:'', chargen:[] });
          toast('Artikel hinzugefügt');
        }
        closeArtikelModal();
        filterArtikel();
      } catch(e) { toast(e.message, 'error'); }
    };

    window.deleteArtikel = async function(id, name) {
      if (!confirm(`„${name}" wirklich löschen?`)) return;
      await deleteDoc(doc(db, `${getDBRoot()}/artikel`, id));
      alleArtikel = alleArtikel.filter(a => a.id !== id);
      filterArtikel();
      toast('Artikel gelöscht');
    };

    // ── BEREICHE ──
    function renderBereiche() {
      document.getElementById('bereich-list').innerHTML = alleBereiche.map(b => {
        const count = alleArtikel.filter(a => a.bereich === b.id).length;
        return `
          <div class="bereich-item">
            <div class="bereich-item-icon">${getBereichIcon(b.name)}</div>
            <div style="flex:1;">
              <div class="bereich-item-name">${esc(prettyBereich(b.name))}</div>
              <div class="bereich-item-count">${count} Artikel · Reihenfolge: ${b.reihenfolge}</div>
            </div>
            <button class="tbl-btn" onclick="openBereichModal('${b.id}')">✏️</button>
          </div>`;
      }).join('');
    }

    window.openBereichModal = function(id) {
      if (id) {
        const b = alleBereiche.find(x => x.id === id);
        document.getElementById('bereich-modal-title').textContent    = 'Bereich bearbeiten';
        document.getElementById('bereich-edit-id').value              = b.id;
        document.getElementById('bereich-edit-name').value            = b.name;
        document.getElementById('bereich-edit-reihenfolge').value     = b.reihenfolge;
      } else {
        document.getElementById('bereich-modal-title').textContent    = 'Neuer Bereich';
        document.getElementById('bereich-edit-id').value              = '';
        document.getElementById('bereich-edit-name').value            = '';
        document.getElementById('bereich-edit-reihenfolge').value     = alleBereiche.length + 1;
      }
      document.getElementById('bereich-modal').classList.remove('hidden');
    };

    window.closeBereichModal = () => document.getElementById('bereich-modal').classList.add('hidden');

    window.saveBereich = async function() {
      const id   = document.getElementById('bereich-edit-id').value;
      const name = document.getElementById('bereich-edit-name').value.trim();
      const reihenfolge = parseInt(document.getElementById('bereich-edit-reihenfolge').value) || 99;
      if (!name) { toast('Name ist Pflichtfeld', 'error'); return; }
      try {
        if (id) {
          await updateDoc(doc(db, `${getDBRoot()}/bereiche`, id), { name, reihenfolge });
          const idx = alleBereiche.findIndex(b => b.id === id);
          if (idx >= 0) alleBereiche[idx] = { ...alleBereiche[idx], name, reihenfolge };
          toast('Bereich gespeichert');
        } else {
          const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[äöüß]/g,c=>({ä:'ae',ö:'oe',ü:'ue',ß:'ss'}[c])).replace(/[^a-z0-9-]/g,'');
          await setDoc(doc(db, `${getDBRoot()}/bereiche`, slug), { name, reihenfolge, aktiv: true });
          alleBereiche.push({ id: slug, name, reihenfolge });
          toast('Bereich hinzugefügt');
        }
        closeBereichModal();
        alleBereiche.sort((a,b) => a.reihenfolge - b.reihenfolge);
        renderBereiche();
      } catch(e) { toast(e.message, 'error'); }
    };

    // ── FOTOS ──
    function populateFotoSelect() {
      const sel = document.getElementById('foto-artikel-select');
      if (!sel) return;
      sel.innerHTML = '';
      const def2 = document.createElement('option'); def2.value = ''; def2.textContent = '– Artikel wählen –';
      sel.appendChild(def2);
      [...alleArtikel].sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(a => {
        const o = document.createElement('option'); o.value = a.id;
        o.textContent = a.lp ? `${a.lp} – ${a.name}` : a.name;
        sel.appendChild(o);
      });
    }

    let fotoUploadTargetId = null;
    let fotoUploadType = 'produkt';

    function populateFotoBereichFilter() {
      const sel = document.getElementById('foto-bereich');
      if (!sel) return;
      while (sel.options.length > 1) sel.remove(1);
      alleBereiche.forEach(b => {
        const o = document.createElement('option');
        o.value = b.id; o.textContent = prettyBereich(b.name);
        sel.appendChild(o);
      });
    }

    window.triggerFotoUpload = function(id, type) {
      fotoUploadTargetId = id;
      fotoUploadType = type;
      const inp = document.getElementById('foto-file-input');
      inp.value = '';
      inp.click();
    };

    window.uploadFotoFromGrid = async function() {
      const file = document.getElementById('foto-file-input').files[0];
      if (!file || !fotoUploadTargetId) return;
      toast('Foto wird hochgeladen…');
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_PRESET);
        formData.append('folder', 'lagerapp/artikel');
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload fehlgeschlagen');
        const data = await res.json();
        const field = fotoUploadType === 'lager' ? 'lagerFotoUrl' : 'fotoUrl';
        await updateDoc(doc(db, `${getDBRoot()}/artikel`, fotoUploadTargetId), { [field]: data.secure_url });
        const idx = alleArtikel.findIndex(a => a.id === fotoUploadTargetId);
        if (idx >= 0) alleArtikel[idx][field] = data.secure_url;
        renderFotos();
        toast('Foto gespeichert ✅');
      } catch(e) { toast(e.message, 'error'); }
    };

    window.deleteFotoFromGrid = async function(id, type) {
      if (!confirm('Foto wirklich löschen?')) return;
      const field = type === 'lager' ? 'lagerFotoUrl' : 'fotoUrl';
      try {
        await updateDoc(doc(db, `${getDBRoot()}/artikel`, id), { [field]: '' });
        const idx = alleArtikel.findIndex(a => a.id === id);
        if (idx >= 0) alleArtikel[idx][field] = '';
        renderFotos();
        toast('Foto gelöscht');
      } catch(e) { toast(e.message, 'error'); }
    };

    window.updateArtikelLP = async function(id, lp) {
      try {
        await updateDoc(doc(db, `${getDBRoot()}/artikel`, id), { lp });
        const idx = alleArtikel.findIndex(a => a.id === id);
        if (idx >= 0) alleArtikel[idx].lp = lp;
        toast('LP gespeichert');
      } catch(e) { toast(e.message, 'error'); }
    };

    function getLpOptions(currentLp) {
      const lps = [...new Set(alleArtikel.map(a => a.lp).filter(Boolean))].sort((a,b) => naturalSort(a,b));
      return lps.map(lp => `<option value="${esc(lp)}"${lp === currentLp ? ' selected' : ''}>${esc(lp)}</option>`).join('');
    }

    window.renderFotos = function renderFotos() {
      const grid    = document.getElementById('foto-grid');
      const search  = (document.getElementById('foto-search')?.value  || '').toLowerCase();
      const filter  = document.getElementById('foto-filter')?.value   || 'alle';
      const bereich = document.getElementById('foto-bereich')?.value  || '';
      const sort    = document.getElementById('foto-sort')?.value     || 'name';

      let items = alleArtikel.filter(a => {
        const matchSearch  = !search || (a.name||'').toLowerCase().includes(search) || (a.lp||'').toLowerCase().includes(search);
        const matchFilter  = filter === 'ohne-produkt' ? !a.fotoUrl
                           : filter === 'ohne-lager'   ? !a.lagerFotoUrl
                           : filter === 'ohne-beide'   ? !a.fotoUrl && !a.lagerFotoUrl
                           : filter === 'vollstaendig' ? !!a.fotoUrl && !!a.lagerFotoUrl
                           : true;
        const matchBereich = !bereich || a.bereich === bereich;
        return matchSearch && matchFilter && matchBereich;
      });

      if (sort === 'lp') items.sort((a,b) => naturalSort(a.lp||'', b.lp||''));
      else               items.sort((a,b) => (a.name||'').localeCompare(b.name||''));

      document.getElementById('foto-grid-label').textContent = `${items.length} Artikel`;
      items = items.slice(0, 60);

      grid.innerHTML = items.map(a => {
        const short = a.name.length > 24 ? a.name.substring(0,21) + '…' : a.name;
        const slotP = a.fotoUrl
          ? `<img src="${esc(a.fotoUrl)}" style="width:100%;height:110px;object-fit:cover;display:block;" loading="lazy">`
          : `<div style="width:100%;height:110px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;"><span style="font-size:1.8rem;">📦</span><span style="font-size:0.58rem;color:var(--muted);">Kein Produktfoto</span></div>`;
        const slotL = a.lagerFotoUrl
          ? `<img src="${esc(a.lagerFotoUrl)}" style="width:100%;height:110px;object-fit:cover;display:block;" loading="lazy">`
          : `<div style="width:100%;height:110px;background:var(--surface3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;"><span style="font-size:1.8rem;">🗄️</span><span style="font-size:0.58rem;color:var(--muted);">Kein Lagerortfoto</span></div>`;
        const delP = a.fotoUrl
          ? `<button onclick="deleteFotoFromGrid('${esc(a.id)}','produkt')" style="padding:6px 10px;background:none;border:none;color:var(--red);cursor:pointer;font-size:0.85rem;flex-shrink:0;" title="Löschen">🗑</button>`
          : '';
        const delL = a.lagerFotoUrl
          ? `<button onclick="deleteFotoFromGrid('${esc(a.id)}','lager')" style="padding:6px 10px;background:none;border:none;color:var(--red);cursor:pointer;font-size:0.85rem;flex-shrink:0;" title="Löschen">🗑</button>`
          : '';
        return `
          <div class="foto-card">
            ${slotP}
            <div style="display:flex;align-items:center;border-top:1px solid var(--border);">
              <button class="foto-upload-btn" style="flex:1;border:none;text-align:left;" onclick="triggerFotoUpload('${esc(a.id)}','produkt')">📸 Produktfoto</button>
              ${delP}
            </div>
            <div style="border-top:1px solid var(--border);">${slotL}</div>
            <div style="display:flex;align-items:center;border-top:1px solid var(--border);">
              <button class="foto-upload-btn" style="flex:1;border:none;text-align:left;" onclick="triggerFotoUpload('${esc(a.id)}','lager')">🗄️ Lagerortfoto</button>
              ${delL}
            </div>
            <div class="foto-name" style="padding-bottom:4px;">
              ${esc(short)}
            </div>
            <div style="padding:0 8px 8px;">
              <select onchange="updateArtikelLP('${esc(a.id)}', this.value)"
                style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:0.68rem;color:var(--accent2);font-family:'IBM Plex Mono',monospace;cursor:pointer;">
                <option value="">— kein LP —</option>
                ${getLpOptions(a.lp)}
              </select>
            </div>
          </div>`;
      }).join('') || '<div class="empty-state">Keine Artikel gefunden</div>';
    };

    // ── STOCKSWIPE FOTOS ──
    let ssFotoTargetId = null;

    function populateSsBereichFilter() {
      const sel = document.getElementById('ss-foto-bereich');
      if (!sel) return;
      // Remove old options except first
      while (sel.options.length > 1) sel.remove(1);
      alleBereiche.forEach(b => {
        const o = document.createElement('option');
        o.value = b.id; o.textContent = prettyBereich(b.name);
        sel.appendChild(o);
      });
    }

    window.renderSsFotos = function() {
      const grid    = document.getElementById('ss-foto-grid');
      if (!grid) return;
      const search  = (document.getElementById('ss-foto-search')?.value || '').toLowerCase();
      const filter  = document.getElementById('ss-foto-filter')?.value  || 'alle';
      const bereich = document.getElementById('ss-foto-bereich')?.value || '';

      let items = alleArtikel.filter(a => {
        const matchSearch  = !search || (a.name||'').toLowerCase().includes(search) || (a.lp||'').toLowerCase().includes(search);
        const matchFilter  = filter === 'ohne-ss' ? !a.stockswipeFotoUrl
                           : filter === 'mit-ss'  ?  !!a.stockswipeFotoUrl
                           : true;
        const matchBereich = !bereich || a.bereich === bereich;
        return matchSearch && matchFilter && matchBereich;
      });
      items.sort((a, b) => (a.name||'').localeCompare(b.name||''));

      document.getElementById('ss-foto-grid-label').textContent = `${items.length} Artikel`;

      grid.innerHTML = items.map(a => {
        const short    = a.name.length > 26 ? a.name.substring(0,23) + '…' : a.name;
        const hasSsFoto = !!a.stockswipeFotoUrl;
        const photoSlot = hasSsFoto
          ? `<img src="${esc(a.stockswipeFotoUrl)}" style="width:100%;height:120px;object-fit:cover;display:block;" loading="lazy">`
          : (a.fotoUrl
              ? `<div style="position:relative;"><img src="${esc(a.fotoUrl)}" style="width:100%;height:120px;object-fit:cover;display:block;filter:grayscale(0.4);opacity:0.7;" loading="lazy"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);font-size:0.6rem;color:white;font-family:'IBM Plex Mono',monospace;letter-spacing:0.05em;">STANDARD FOTO</div></div>`
              : `<div style="width:100%;height:120px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;"><span style="font-size:2rem;">📦</span><span style="font-size:0.62rem;color:var(--muted);">Kein Foto</span></div>`
            );
        return `
          <div class="foto-card">
            ${photoSlot}
            <div class="foto-name">
              ${a.lp ? `<div style="font-size:0.6rem;color:var(--accent2);margin-bottom:2px;font-family:'IBM Plex Mono',monospace;">${esc(a.lp)}</div>` : ''}
              ${esc(short)}
              ${hasSsFoto ? '<div style="font-size:0.58rem;color:var(--green);margin-top:2px;">✓ StockSwipe-Foto</div>' : ''}
            </div>
            <div style="display:flex;align-items:center;border-top:1px solid var(--border);">
              <button class="foto-upload-btn" style="flex:1;border:none;text-align:left;" onclick="triggerSsFotoUpload('${esc(a.id)}')">
                🃏 ${hasSsFoto ? 'Ändern' : 'Hochladen'}
              </button>
              ${hasSsFoto ? `<button onclick="deleteSsFoto('${esc(a.id)}')" style="padding:6px 10px;background:none;border:none;color:var(--red);cursor:pointer;font-size:0.85rem;flex-shrink:0;" title="Löschen">🗑</button>` : ''}
            </div>
          </div>`;
      }).join('') || '<div class="empty-state">Keine Artikel gefunden</div>';
    };

    window.triggerSsFotoUpload = function(id) {
      ssFotoTargetId = id;
      const inp = document.getElementById('ss-foto-file-input');
      inp.value = '';
      inp.click();
    };

    window.uploadSsFoto = async function() {
      const file = document.getElementById('ss-foto-file-input').files[0];
      if (!file || !ssFotoTargetId) return;
      toast('StockSwipe-Foto wird hochgeladen…');
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_PRESET);
        formData.append('folder', 'lagerapp/stockswipe');
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload fehlgeschlagen');
        const data = await res.json();
        await updateDoc(doc(db, `${getDBRoot()}/artikel`, ssFotoTargetId), { stockswipeFotoUrl: data.secure_url });
        const idx = alleArtikel.findIndex(a => a.id === ssFotoTargetId);
        if (idx >= 0) alleArtikel[idx].stockswipeFotoUrl = data.secure_url;
        renderSsFotos();
        toast('StockSwipe-Foto gespeichert ✅');
      } catch(e) { toast(e.message, 'error'); }
    };

    window.deleteSsFoto = async function(id) {
      if (!confirm('StockSwipe-Foto wirklich löschen?')) return;
      try {
        await updateDoc(doc(db, `${getDBRoot()}/artikel`, id), { stockswipeFotoUrl: '' });
        const idx = alleArtikel.findIndex(a => a.id === id);
        if (idx >= 0) alleArtikel[idx].stockswipeFotoUrl = '';
        renderSsFotos();
        toast('Foto gelöscht');
      } catch(e) { toast(e.message, 'error'); }
    };

    // ── PIN ──
    window.togglePinVisibility = function() {
      pinVisible = !pinVisible;
      document.getElementById('current-pin-display').textContent = pinVisible ? currentPin : '****';
    };

    window.adminPinKey = function(d) {
      if (newPinValue.length >= 4) return;
      newPinValue += d;
      updatePinDots();
    };

    window.adminPinDel = function() {
      newPinValue = newPinValue.slice(0,-1);
      updatePinDots();
    };

    function updatePinDots() {
      for (let i=0; i<4; i++)
        document.getElementById(`pdot-${i}`).classList.toggle('filled', i < newPinValue.length);
    }

    window.savePIN = async function() {
      const msg = document.getElementById('pin-msg');
      if (newPinValue.length < 4) { msg.style.color='var(--red)'; msg.textContent='Bitte 4-stelligen PIN eingeben.'; return; }
      await updateDoc(doc(db, `${getDBRoot()}/config`, 'app'), { pin: newPinValue });
      currentPin  = newPinValue;
      newPinValue = '';
      updatePinDots();
      msg.style.color = 'var(--green)';
      msg.textContent = '✅ PIN gespeichert!';
      toast('PIN geändert!');
      setTimeout(() => msg.textContent = '', 3000);
    };

    // ── BESTELLUNG DETAIL MODAL ──
    window.openDetail = function(id) {
      const b = alleBestellungen.find(x => x.id === id);
      if (!b) return;
      currentBest = b;
      const d   = b.datum?.toDate ? b.datum.toDate() : new Date();
      const nb  = b.items || b.nachbestellungen || [];
      document.getElementById('detail-modal-title').textContent = `Lagercheck – ${b.mitarbeiter}`;
      document.getElementById('detail-modal-body').innerHTML = `
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);font-size:0.82rem;"><span style="color:var(--muted);">Mitarbeiter</span><span style="font-family:'IBM Plex Mono',monospace;font-weight:600;">${b.mitarbeiter||'–'}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);font-size:0.82rem;"><span style="color:var(--muted);">Datum</span><span style="font-family:'IBM Plex Mono',monospace;font-weight:600;">${d.toLocaleDateString('de-DE')} · ${d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 16px;font-size:0.82rem;"><span style="color:var(--muted);">Nachbestellungen</span><span style="font-family:'IBM Plex Mono',monospace;font-weight:600;color:${nb.length>0?'var(--red)':'var(--green)'};">${nb.length} Artikel</span></div>
        </div>
        ${nb.length > 0 ? `
          <div>
            <div class="section-label mb-8">Nachbestellungen</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${nb.map(a=>`
                <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:0.78rem;font-weight:600;">${a.artikelName||a.name||'–'}</span>
                  <span style="font-size:0.7rem;font-family:'IBM Plex Mono',monospace;color:var(--red);">${a.menge||a.ist||'–'} ${a.einheit||a.minEinheit||''}</span>
                </div>`).join('')}
            </div>
          </div>` : '<div class="alert alert-success">✅ Alle Artikel ausreichend</div>'}
        ${b.unterschrift?`<div><div class="section-label mb-8">Unterschrift</div><img src="${b.unterschrift}" style="width:100%;border-radius:8px;border:1px solid var(--border);background:var(--surface2);"></div>`:''}`;
      document.getElementById('detail-modal').classList.remove('hidden');
      const medBtn = document.getElementById('btn-medikamente-pdf');
      if (medBtn) medBtn.style.display = false /* wachen-spezifische Logik hier anpassen */ ? '' : 'none';
    };

    window.closeDetailModal = () => document.getElementById('detail-modal').classList.add('hidden');

    // ── Bestellung löschen ──
    window.deleteBestellung = async function(id) {
      if (!confirm('Bestellung wirklich löschen?')) return;
      try {
        await deleteDoc(doc(db, `${getDBRoot()}/bestellungen`, id));
        alleBestellungen = alleBestellungen.filter(b => b.id !== id);
        renderDashboard();
        renderBestellungen();
        toast('Bestellung gelöscht');
      } catch(e) { toast(e.message, 'error'); }
    };

    // ── PDF ──
    window.quickPDF = function(id, btn) {
      const b = alleBestellungen.find(x => x.id === id);
      if (!b) return;
      currentBest = b;
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      generatePDF().catch(e => { console.error(e); alert('PDF-Fehler: ' + e.message); })
                   .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '↓ PDF'; } });
    };

    // ── PDF: Wachen-Konfiguration (eigene Wachen hier eintragen) ──
    const _WACHEN_PDF = {
      // w1_meinstadt: { title:'Lagerbestellung Wache 1', col5:'Ist', hinweis:false, redBox:false },
    };

    function _fmtMenge(val, einheit) {
      if (val == null || val === '') return '';
      const n = parseFloat(val);
      const s = n === 0.5 ? '½' : (n % 1 === 0 ? String(n|0) : String(n));
      return einheit ? `${s} ${einheit}` : s;
    }

    // ── Lager-PDF (von Grund auf, kein Template) ──
    async function _buildLagerPDF(cfg) {
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const b      = currentBest;
      const datum  = b.datum?.toDate ? b.datum.toDate() : new Date();
      const datStr = datum.toLocaleDateString('de-DE');
      const timStr = datum.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
      const nb     = b.items || b.nachbestellungen || [];

      const pdf   = await PDFDocument.create();
      const fReg  = await pdf.embedFont(StandardFonts.Helvetica);
      const fBold = await pdf.embedFont(StandardFonts.HelveticaBold);

      const C = {
        black:  rgb(0,0,0),       red:   rgb(0.82,0.05,0.05),
        gray:   rgb(0.87,0.87,0.87), border:rgb(0.60,0.60,0.60),
        white:  rgb(1,1,1),       green: rgb(0.91,1,0.91),
        muted:  rgb(0.40,0.40,0.40),
      };

      const PW=595.28, PH=841.89, ML=40, MR=555, CW=MR-ML;
      // Spaltenbreiten: LP | Produkt | Min | Max | col5 | Bestellen  (Summe=515)
      const CWIDTHS=[70,215,58,58,68,46];
      const CXPOS=[]; let cx=ML;
      for(const w of CWIDTHS){CXPOS.push(cx);cx+=w;}

      const ROW_H=17, SEC_H=18, CHDR_H=20;
      let pages=[], curPage=null, curY=0;

      function _drawDRKFull() {
        curPage.drawRectangle({x:340,y:PH-75,width:215,height:75,borderColor:C.border,borderWidth:0.5,color:C.white});
        curPage.drawText('+',{x:354,y:PH-40,size:42,font:fBold,color:C.red});
        curPage.drawLine({start:{x:404,y:PH-8},end:{x:404,y:PH-70},thickness:0.5,color:C.border});
        curPage.drawLine({start:{x:462,y:PH-8},end:{x:462,y:PH-70},thickness:0.5,color:C.border});
        curPage.drawText('Deutsches',{x:408,y:PH-22,size:9,font:fBold,color:C.black});
        curPage.drawText('Rotes',    {x:408,y:PH-33,size:9,font:fBold,color:C.black});
        curPage.drawText('Kreuz',    {x:408,y:PH-44,size:9,font:fBold,color:C.black});
        curPage.drawText('DRK-Rettungsdienst',{x:466,y:PH-22,size:7.5,font:fBold,color:C.black});
        curPage.drawText('gGmbH · Böblingen', {x:466,y:PH-33,size:7.5,font:fBold,color:C.black});
        curPage.drawRectangle({x:464,y:PH-53,width:85,height:14,color:C.black});
        curPage.drawText('STABIL SOZIAL',{x:466,y:PH-47,size:6.5,font:fBold,color:C.white});
        // Titelzeile
        curPage.drawRectangle({x:ML,y:PH-115,width:CW,height:36,borderColor:C.black,borderWidth:0.8,color:C.white});
        const tW=fBold.widthOfTextAtSize(cfg.title,14);
        curPage.drawText(cfg.title,{x:ML+(CW-tW)/2,y:PH-105,size:14,font:fBold,color:C.black});
      }

      function _drawDRKSmall() {
        curPage.drawRectangle({x:370,y:PH-44,width:185,height:44,borderColor:C.border,borderWidth:0.5,color:C.white});
        curPage.drawText('+',{x:380,y:PH-26,size:28,font:fBold,color:C.red});
        curPage.drawLine({start:{x:410,y:PH-7},end:{x:410,y:PH-41},thickness:0.5,color:C.border});
        curPage.drawLine({start:{x:450,y:PH-7},end:{x:450,y:PH-41},thickness:0.5,color:C.border});
        curPage.drawText('Deutsches',{x:413,y:PH-17,size:7,font:fBold,color:C.black});
        curPage.drawText('Rotes',    {x:413,y:PH-27,size:7,font:fBold,color:C.black});
        curPage.drawText('Kreuz',    {x:413,y:PH-37,size:7,font:fBold,color:C.black});
        curPage.drawText('DRK-Rettungsdienst',{x:453,y:PH-17,size:6.5,font:fReg,color:C.black});
        curPage.drawText('gGmbH · Böblingen', {x:453,y:PH-28,size:6.5,font:fReg,color:C.black});
        curPage.drawRectangle({x:451,y:PH-41,width:98,height:12,color:C.black});
        curPage.drawText('STABIL SOZIAL',{x:453,y:PH-36,size:6,font:fBold,color:C.white});
      }

      function _drawColHeaders() {
        const labels=['LP','Produkt','Min','Max',cfg.col5,'Bestellen'];
        curPage.drawRectangle({x:ML,y:curY-CHDR_H,width:CW,height:CHDR_H,color:C.gray});
        for(let i=0;i<labels.length;i++){
          curPage.drawText(labels[i],{x:CXPOS[i]+3,y:curY-CHDR_H+6,size:8.5,font:fBold,color:C.black});
        }
        for(let i=1;i<CXPOS.length;i++){
          curPage.drawLine({start:{x:CXPOS[i],y:curY},end:{x:CXPOS[i],y:curY-CHDR_H},thickness:0.3,color:C.border});
        }
        curPage.drawLine({start:{x:ML,y:curY-CHDR_H},end:{x:MR,y:curY-CHDR_H},thickness:0.5,color:C.border});
      }

      function _addPage(isFirst) {
        curPage=pdf.addPage([PW,PH]); pages.push(curPage);
        if(isFirst){_drawDRKFull(); curY=PH-118;} else {_drawDRKSmall(); curY=PH-48;}
        _drawColHeaders(); curY-=CHDR_H;
      }

      function _need(h){if(curY-h<80)_addPage(false);}

      function _section(name){
        _need(SEC_H);
        curPage.drawRectangle({x:ML,y:curY-SEC_H,width:CW,height:SEC_H,color:C.gray});
        curPage.drawText(name,{x:ML+4,y:curY-SEC_H+5,size:8.5,font:fBold,color:C.black});
        curPage.drawLine({start:{x:ML,y:curY-SEC_H},end:{x:MR,y:curY-SEC_H},thickness:0.5,color:C.border});
        curY-=SEC_H;
      }

      function _row(lp,name,min,max,col5,bestellen){
        _need(ROW_H);
        const ok=!!bestellen;
        if(ok) curPage.drawRectangle({x:ML,y:curY-ROW_H,width:CW,height:ROW_H,color:C.green});
        const cells=[lp,name,min,max,col5,bestellen];
        for(let i=0;i<cells.length;i++){
          if(!cells[i])continue;
          curPage.drawText(String(cells[i]),{
            x:CXPOS[i]+3,y:curY-ROW_H+5,size:8,
            font:(i===5&&ok)?fBold:fReg,color:(i===5&&ok)?C.red:C.black,
            maxWidth:CWIDTHS[i]-6,
          });
        }
        curPage.drawLine({start:{x:ML,y:curY-ROW_H},end:{x:MR,y:curY-ROW_H},thickness:0.3,color:C.border});
        curY-=ROW_H;
      }

      // ── Inhalt ──
      _addPage(true);
      const bereiche=[...alleBereiche].sort((a,b)=>(a.reihenfolge||99)-(b.reihenfolge||99));
      for(const br of bereiche){
        const arts=alleArtikel.filter(a=>a.bereich===br.id);
        if(!arts.length)continue;
        _section(br.name);
        for(const art of arts){
          const match=nb.find(x=>x.id===art.id||x.artikelId===art.id||x.name===art.name||x.artikelName===art.name);
          const ordered=match?true:(b.bestellungen?.[art.id]?.bestellen===true);
          const menge=match?.menge??b.bestellungen?.[art.id]?.menge??'';
          const einheit=match?.einheit||art.minEinheit||'';
          _row(
            art.lp||'', art.name||'',
            _fmtMenge(art.min,art.minE), _fmtMenge(art.max,art.maxE),
            cfg.hinweis?(art.hinweis||''):'',
            (ordered&&menge)?`${menge} ${einheit}`.trim():''
          );
        }
      }

      // ── Legende + Unterschrift ──
      _need(200); curY-=8;
      const legRows=[
        ['Stk. = Stück','VE = Verpackungseinheit','K = Kanister'],
        ['Pack = Pack','R = Rolle','Fl. = Flasche'],
        ['S = Schrank','L = Lagerplatz','R = Regal'],
        ['LB = Lagerboden','RB = Regalboden','B. = Bögen'],
      ];
      const legCW=CW/3;
      for(const row of legRows){
        _need(13);
        curPage.drawRectangle({x:ML,y:curY-13,width:CW,height:13,borderColor:C.border,borderWidth:0.3,color:C.white});
        for(let i=0;i<row.length;i++){
          if(row[i])curPage.drawText(row[i],{x:ML+i*legCW+4,y:curY-9,size:7.5,font:fReg,color:C.black});
        }
        curY-=13;
      }
      curY-=12;

      const sigLines=[
        `Bestellt am:  ${datStr}  ·  ${timStr} Uhr`,
        `Name Besteller*in:  ${b.mitarbeiter||''}`,
        'Unterschrift Besteller*in:',
      ];
      for(const line of sigLines){
        _need(28);
        curPage.drawText(line,{x:ML,y:curY-16,size:9,font:fReg,color:C.black});
        curPage.drawLine({start:{x:ML,y:curY-19},end:{x:MR,y:curY-19},thickness:0.5,color:C.border});
        curY-=28;
      }
      if(b.unterschrift){
        try{
          const pngBytes=Uint8Array.from(atob(b.unterschrift.split(',')[1]),c=>c.charCodeAt(0));
          const img=await pdf.embedPng(pngBytes);
          const{width:iW,height:iH}=img.size();
          const scale=Math.min(200/iW,30/iH);
          curPage.drawImage(img,{x:ML+165,y:curY+22,width:iW*scale,height:iH*scale});
        }catch(_){}
      }

      if(cfg.redBox){
        _need(40); curY-=10;
        curPage.drawRectangle({x:ML,y:curY-28,width:CW,height:28,borderColor:C.red,borderWidth:1.5,color:rgb(1,0.96,0.96)});
        curPage.drawText('Hinweis = nur den Bestand im Regal über den Schränken kontrollieren und ggf. bestellen!',
          {x:ML+6,y:curY-18,size:9,font:fBold,color:C.red,maxWidth:CW-12});
        curY-=32;
      }

      // Seitenzahlen (Nachlauf)
      const total=pages.length;
      for(let i=0;i<total;i++){
        pages[i].drawText(`Seite ${i+1} von ${total}`,{x:PW/2-25,y:15,size:7.5,font:fReg,color:C.muted});
        pages[i].drawText(`Stand: ${datStr}`,{x:MR-48,y:15,size:7.5,font:fReg,color:C.muted});
      }

      const bytes=await pdf.save();
      const blob=new Blob([bytes],{type:'application/pdf'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      const wName=cfg.title.replace('Lagerbestellung Rettungswache ','');
      a.download=`Lagerbestellung_${wName}_${(b.mitarbeiter||'').replace(/\s/g,'_')}_${datStr.replace(/\./g,'-')}.pdf`;
      a.click(); URL.revokeObjectURL(a.href);
    }

    window.generatePDF = async function() {
      if(!currentBest)return;
      const cfg=_WACHEN_PDF[getActiveWache()];
      if(!cfg){alert(`Kein PDF-Generator für diese Wache konfiguriert.`);return;}
      await _buildLagerPDF(cfg);
    };

    // ── Medikamenten-PDF Mapping (LP → Art.Nr. codiert als menge_ARTNR_IDX) ──
    const _MED_LP_FIELD = {"S.3.2.2.":"menge_103823_0","S.3.3.2.":"menge_103626_1","S.5.3.2.":"menge_103648_2","S.3.2.3.":"menge_103680_3","S.3.1.3.":"menge_103684_4","S.7.2.3.":"menge_114608_5","S.3.2.1.":"menge_104228_6","S.9.2.3.":"menge_103766_7","S.2.":"menge_103729_8","2.3.3.3.":"menge_103844_9","S.3.3.1.":"menge_103845_10","S.9.3.3.":"menge_104012_11","S.3.1.2.":"menge_104028_12","S.3.1.1.":"menge_104037_13","S.10.2.1.":"menge_101680_14","S.4.1.2.":"menge_104139_15","S.7.2.2.":"menge_113178_16","S.6.3.3.":"menge_103159_17","S.4.3.3.":"menge_100017_18","S.4.1.3.":"menge_100018_19","S.4.1.1.":"menge_102313_20","S.4.2.1.":"menge_102565_21","S.5.2.1.":"menge_100721_22","S.5.1.3.":"menge_103251_23","S.5.1.1.":"menge_102715_24","S.6.1.4.":"menge_106172_25","S.6.1.5.":"menge_100451_26","S.10.3.2.":"menge_111834_27","S.5.3.3.":"menge_100493_28","S.5.3.1.":"menge_100874_29","S.4.3.2.":"menge_100293_30","S.4.2.3.":"menge_109467_31","S.6.2.2.":"menge_110510_32","S.5.2.3.":"menge_100703_33","S.1.":"menge_100737_34","S.6.1.7.":"menge_100737_34","S.10.2.2.":"menge_100775_35","S.6.2.1.":"menge_104295_36","S.6.2.3.":"menge_102348_37","S.7.2.2.b":"menge_101012_38","S.10.1.2.":"menge_100986_39","S.7.3.3.":"menge_110402_40","S.7.2.1.":"menge_100902_41","S.6.1.2.":"menge_115001_42","S.7.1.2.":"menge_100077_43","S.7.1.1.":"menge_112406_44","S.7.3.2.":"menge_101258_45","S.7.1.3.":"menge_101253_46","S.5.2.2.":"menge_101325_47","S.8.1.2.":"menge_103821_48","S.7.3.1.":"menge_101341_49","S.8.2.2.":"menge_102392_50","S.9.3.1.":"menge_101381_51","S.10.3.1.":"menge_101393_52","S.8.1.3.":"menge_102812_53","S.6.1.6.":"menge_114739_54","S.5.1.2.":"menge_103507_55","S.8.2.1.":"menge_101859_56","S.8.1.1.":"menge_101547_57","S.8.3.2.":"menge_101604_58","S.9.1.2.":"menge_113494_59","S.4.2.2.":"menge_101699_60","S.9.2.2.":"menge_112777_61","S.4.3.1.":"menge_101947_62","S.6.1.1.":"menge_101998_63","S.9.2.1.":"menge_104332_64","S.8.3.3.":"menge_102128_65","S.9.1.3.":"menge_110751_66","S.6.1.3.":"menge_102194_67","S.9.1.1.":"menge_100111_68","S.10.1.1.":"menge_103944_69","S.6.3.2.":"menge_106370_72","S.6.3.1.":"menge_104688_73"};

    // ── Medikamenten-PDF (von Grund auf, Klinikum-Format) ──
    window.generateMedikamentePDF = async function() {
      if (!currentBest) return;
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const b      = currentBest;
      const datum  = b.datum?.toDate ? b.datum.toDate() : new Date();
      const datStr = datum.toLocaleDateString('de-DE');
      const timStr = datum.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
      const nb     = b.items || b.nachbestellungen || [];

      const pdf   = await PDFDocument.create();
      const fReg  = await pdf.embedFont(StandardFonts.Helvetica);
      const fBold = await pdf.embedFont(StandardFonts.HelveticaBold);

      const C = {
        black:rgb(0,0,0), gray:rgb(0.87,0.87,0.87),
        border:rgb(0.6,0.6,0.6), white:rgb(1,1,1), muted:rgb(0.4,0.4,0.4),
      };
      const PW=595.28, PH=841.89, ML=40, MR=555, CW=MR-ML;
      // Art.Nr. | Artikelbezeichnung | Menge | Gebinde | Bedarf(14T)
      const CWIDTHS=[55,240,40,100,80];
      const CXPOS=[]; let cx2=ML;
      for(const w of CWIDTHS){CXPOS.push(cx2);cx2+=w;}

      const ROW_H=16, CHDR_H=22;
      let pages2=[], curPage2=null, curY2=0;

      function _hdrFull2() {
        // Empfängeradresse hier anpassen
        curPage2.drawText('Lieferant / Apotheke',{x:ML,y:PH-22,size:12,font:fBold,color:C.black});
        curPage2.drawText('Straße Nr.',{x:ML,y:PH-35,size:8.5,font:fReg,color:C.black});
        curPage2.drawText('PLZ Ort',{x:ML,y:PH-45,size:8.5,font:fReg,color:C.black});
        curPage2.drawText('Materialanforderung',{x:ML,y:PH-70,size:15,font:fBold,color:C.black});
        curPage2.drawText('Ihre Organisation',{x:370,y:PH-18,size:8.5,font:fBold,color:C.black});
        curPage2.drawText('Lieferant',{x:370,y:PH-55,size:8.5,font:fBold,color:C.black});
        curPage2.drawText('Abteilung',{x:370,y:PH-67,size:8.5,font:fBold,color:C.black});
        curPage2.drawText(`letzte Änderung  ${datStr}`,{x:370,y:PH-80,size:8,font:fReg,color:C.black});
        curPage2.drawText(`Druckdatum :  ${datStr}`,{x:370,y:PH-91,size:8,font:fReg,color:C.black});
        curPage2.drawText(`Druckzeit :  ${timStr}`,{x:370,y:PH-102,size:8,font:fReg,color:C.black});
        curPage2.drawLine({start:{x:ML,y:PH-82},end:{x:358,y:PH-82},thickness:0.5,color:C.border});
        const PI=[
          ['Profil','IHRE ORGANISATION'],
          ['Kunde','Ihr vollständiger Organisationsname'],
          ['Kostenstelle','Ihre Kostenstelle'],
          ['Kopftext','Anforderungshinweis hier eintragen'],
        ];
        let py=PH-96;
        for(const[k,v]of PI){
          curPage2.drawText(k,{x:ML,y:py,size:8.5,font:fBold,color:C.black});
          curPage2.drawText(v,{x:ML+72,y:py,size:8.5,font:fReg,color:C.black,maxWidth:280});
          py-=13;
        }
        curPage2.drawLine({start:{x:ML,y:py+2},end:{x:358,y:py+2},thickness:0.5,color:C.border});
        curY2=py-8;
      }

      function _hdrSmall2() {
        curPage2.drawText('Materialanforderung – Lieferant / Abteilung',
          {x:ML,y:PH-20,size:9.5,font:fBold,color:C.black});
        curPage2.drawText(`Druckdatum: ${datStr}  ·  ${timStr}`,{x:ML,y:PH-33,size:8,font:fReg,color:C.black});
        curY2=PH-48;
      }

      function _colHdr2() {
        const labels=['Art. Nr.','Artikelbezeichnung','Menge','Gebinde','Bedarf\n(14 Tage)'];
        curPage2.drawRectangle({x:ML,y:curY2-CHDR_H,width:CW,height:CHDR_H,color:C.gray});
        curPage2.drawLine({start:{x:ML,y:curY2},end:{x:MR,y:curY2},thickness:0.5,color:C.border});
        for(let i=0;i<labels.length;i++){
          const parts=labels[i].split('\n');
          if(parts.length>1){
            curPage2.drawText(parts[0],{x:CXPOS[i]+3,y:curY2-9,size:7.5,font:fBold,color:C.black});
            curPage2.drawText(parts[1],{x:CXPOS[i]+3,y:curY2-17,size:7.5,font:fBold,color:C.black});
          }else{
            curPage2.drawText(parts[0],{x:CXPOS[i]+3,y:curY2-CHDR_H+7,size:8,font:fBold,color:C.black});
          }
        }
        curPage2.drawLine({start:{x:ML,y:curY2-CHDR_H},end:{x:MR,y:curY2-CHDR_H},thickness:0.5,color:C.border});
        curY2-=CHDR_H;
      }

      function _addPage2(isFirst){
        curPage2=pdf.addPage([PW,PH]); pages2.push(curPage2);
        if(isFirst)_hdrFull2(); else _hdrSmall2();
        _colHdr2();
      }

      function _need2(h){if(curY2-h<60)_addPage2(false);}

      function _medRow(artNr,name,menge,gebinde){
        _need2(ROW_H);
        const cells=[artNr,name,menge,gebinde,''];
        for(let i=0;i<cells.length;i++){
          if(!cells[i])continue;
          curPage2.drawText(String(cells[i]),{x:CXPOS[i]+3,y:curY2-ROW_H+5,size:8,font:fReg,color:C.black,maxWidth:CWIDTHS[i]-6});
        }
        curPage2.drawLine({start:{x:ML,y:curY2-ROW_H},end:{x:MR,y:curY2-ROW_H},thickness:0.3,color:C.border});
        curY2-=ROW_H;
      }

      // Bestellte Medikamente sammeln
      const bestellte=[];
      for(const art of alleArtikel){
        const lpRaw=art.lp||'';
        const fnKey=_MED_LP_FIELD[lpRaw]||_MED_LP_FIELD[lpRaw.replace(/^M\./,'S.')]||art.formularfeld||null;
        if(!fnKey)continue;
        const match=nb.find(x=>x.id===art.id||x.artikelId===art.id||x.name===art.name||x.artikelName===art.name);
        const ordered=match?true:(b.bestellungen?.[art.id]?.bestellen===true);
        if(!ordered)continue;
        const menge=match?.menge??b.bestellungen?.[art.id]?.menge??'';
        if(!menge)continue;
        const artNr=fnKey.replace(/^menge_(\d+)_\d+$/,'$1');
        bestellte.push({artNr,name:art.wirkstoff||art.name,menge:String(menge),gebinde:art.minE||''});
      }

      if(!bestellte.length){showPortalToast('Keine bestellten Medikamente gefunden','error');return;}

      _addPage2(true);
      for(const med of bestellte)_medRow(med.artNr,med.name,med.menge,med.gebinde);

      _need2(20); curY2-=8;
      curPage2.drawText('– Listenende –',{x:PW/2-30,y:curY2-10,size:9,font:fReg,color:C.muted});
      curY2-=25;

      _need2(90);
      const sigData=[
        {label:'angefordert am',value:datStr},
        {label:'Anzahl Seiten',value:String(pages2.length)},
        {label:'Unterschrift Arzt',value:b.mitarbeiter||''},
        {label:'Unterschrift Apotheker',value:''},
      ];
      for(const s of sigData){
        curPage2.drawText(s.label,{x:ML,y:curY2-14,size:9,font:fReg,color:C.black});
        curPage2.drawLine({start:{x:ML+115,y:curY2-13},end:{x:ML+260,y:curY2-13},thickness:0.5,color:C.border});
        if(s.value)curPage2.drawText(s.value,{x:ML+118,y:curY2-11,size:8.5,font:fReg,color:C.black});
        curY2-=20;
      }

      const total2=pages2.length;
      for(let i=0;i<total2;i++){
        pages2[i].drawText(`Seite ${i+1}  von  ${total2}`,{x:PW/2-25,y:15,size:8,font:fReg,color:C.muted});
      }

      const bytes=await pdf.save();
      const blob=new Blob([bytes],{type:'application/pdf'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=`Medikamente_${(b.mitarbeiter||'').replace(/\s/g,'_')}_${datStr.replace(/\./g,'-')}.pdf`;
      a.click(); URL.revokeObjectURL(a.href);
    };


    // ── STATISTIK ──

    async function renderStatistik() {
      const zeitraum = document.getElementById('stat-zeitraum')?.value || 'alle';
      const alle = getStatistikBestellungen(zeitraum);

      if (alle.length === 0) {
        document.getElementById('stat-total').textContent  = '0';
        document.getElementById('stat-orders').textContent = '0';
        document.getElementById('stat-avg').textContent    = '0';
        document.getElementById('stat-top-artikel').innerHTML   = '<div class="empty-state">Noch keine Daten</div>';
        document.getElementById('stat-empfehlungen').innerHTML  = '<div class="empty-state">Noch keine Daten</div>';
        return;
      }

      // ── Artikel-Häufigkeit berechnen ──
      const artikelCount = {};
      let totalNachbest = 0;

      for (const b of alle) {
        const nb = b.items || b.nachbestellungen || [];
        totalNachbest += nb.length;
        for (const a of nb) {
          const key = a.artikelName || a.name || a.artikelId || a.id;
          artikelCount[key] = (artikelCount[key] || 0) + 1;
        }
      }

      // ── KPIs ──
      document.getElementById('stat-total').textContent  = alle.length;
      document.getElementById('stat-orders').textContent = totalNachbest;
      document.getElementById('stat-avg').textContent    = (totalNachbest / alle.length).toFixed(1);

      // ── Mitarbeiter-Häufigkeit ──
      const mitarbeiterCount = {};
      for (const b of alle) {
        const namen = b.mitarbeiterListe || [b.mitarbeiter || '–'];
        for (const n of namen) {
          if (n) mitarbeiterCount[n] = (mitarbeiterCount[n] || 0) + 1;
        }
      }

      const topMitarbeiter = Object.entries(mitarbeiterCount)
        .sort((a, b) => b[1] - a[1]);



      // ── Top Artikel ──
      const topArtikel = Object.entries(artikelCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const maxCount = topArtikel[0]?.[1] || 1;

      document.getElementById('stat-top-artikel').innerHTML = topArtikel.length === 0
        ? '<div class="empty-state">Keine Nachbestellungen</div>'
        : topArtikel.map(([name, count], i) => {
            const pct = Math.round((count / maxCount) * 100);
            const color = i < 3 ? 'var(--red)' : i < 6 ? 'var(--yellow)' : 'var(--accent2)';
            return `
              <div style="padding:8px 16px;border-bottom:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                  <span style="font-size:0.78rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                  <span style="font-size:0.72rem;font-family:'IBM Plex Mono',monospace;color:${color};flex-shrink:0;margin-left:8px;">${count}×</span>
                </div>
                <div style="background:var(--surface2);border-radius:4px;height:4px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.5s ease;"></div>
                </div>
              </div>`;
          }).join('');



      // ── Wochenverlauf (letzte 12 Wochen) ──
      const wochen = {};
      const jetzt  = new Date();

      for (let i = 11; i >= 0; i--) {
        const d = new Date(jetzt);
        d.setDate(d.getDate() - i * 7);
        const key = `KW${getWeek(d)}`;
        wochen[key] = { label: key, count: 0, nb: 0 };
      }

      for (const b of alle) {
        const d = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
        const key = `KW${getWeek(d)}`;
        if (wochen[key]) {
          wochen[key].count++;
          wochen[key].nb += (b.items || b.nachbestellungen || []).length;
        }
      }

      drawChart(Object.values(wochen));

      // ── MIN/MAX Empfehlungen ──
      // Artikel die in mehr als 30% aller Bestellungen nachbestellt wurden
      const threshold = alle.length * 0.3;
      const empf = Object.entries(artikelCount)
        .filter(([, count]) => count >= threshold && count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      document.getElementById('stat-empfehlungen').innerHTML = empf.length === 0
        ? '<div class="empty-state" style="padding:20px;">✅ Alle Artikel scheinen gut bestandsmäßig versorgt</div>'
        : empf.map(([name, count]) => {
            const pct = Math.round((count / alle.length) * 100);
            const artikel = alleArtikel.find(a => a.name === name);
            return `
              <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
                  <div style="font-size:0.65rem;color:var(--muted);font-family:'IBM Plex Mono',monospace;margin-top:2px;">
                    In ${pct}% aller Bestellungen nachbestellt · ${count}× total
                    ${artikel ? ` · MIN: ${artikel.min||'–'} ${artikel.minEinheit||''}` : ''}
                  </div>
                </div>
                <div style="background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.3);border-radius:6px;padding:3px 8px;font-size:0.65rem;color:var(--accent);font-family:'IBM Plex Mono',monospace;white-space:nowrap;flex-shrink:0;">
                  MIN erhöhen?
                </div>
              </div>`;
          }).join('');
    }

    function getWeek(d) {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    }

    function drawChart(wochen) {
      const canvas = document.getElementById('stat-chart');
      if (!canvas) return;
      const ctx    = canvas.getContext('2d');
      const W      = canvas.offsetWidth || 600;
      const H      = 80;
      canvas.width  = W;
      canvas.height = H;

      const max    = Math.max(...wochen.map(w => w.count), 1);
      const barW   = (W - 40) / wochen.length;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const barColor  = '#f97316';
      const textColor = isDark ? '#6b7280' : '#9ca3af';

      ctx.clearRect(0, 0, W, H);

      wochen.forEach((w, i) => {
        const x   = 20 + i * barW;
        const pct = w.count / max;
        const bh  = Math.max(pct * (H - 24), w.count > 0 ? 4 : 0);
        const y   = H - 16 - bh;

        // Bar
        ctx.fillStyle = w.count > 0 ? barColor : (isDark ? '#1f2937' : '#f3f4f6');
        const r = 3;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - 4 - r, y);
        ctx.arcTo(x + barW - 4, y, x + barW - 4, y + r, r);
        ctx.lineTo(x + barW - 4, y + bh);
        ctx.lineTo(x, y + bh);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();

        // Count label
        if (w.count > 0) {
          ctx.fillStyle = barColor;
          ctx.font      = `bold 9px 'IBM Plex Mono'`;
          ctx.textAlign = 'center';
          ctx.fillText(w.count, x + (barW - 4) / 2, y - 3);
        }

        // Week label
        ctx.fillStyle = textColor;
        ctx.font      = '8px IBM Plex Mono';
        ctx.textAlign = 'center';
        ctx.fillText(w.label, x + (barW - 4) / 2, H - 3);
      });
    }

    // ── Statistik Export ──

    window.exportStatistikCSV = function() {
      const zeitraum = document.getElementById('stat-zeitraum')?.value || 'alle';
      const alle = getStatistikBestellungen(zeitraum);
      if (alle.length === 0) { showPortalToast('Keine Daten vorhanden', 'error'); return; }

      const rows = [['Datum', 'Mitarbeiter', 'Quelle', 'Artikel bestellt', 'Artikelnamen']];
      for (const b of alle) {
        const dt = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
        const nb = b.items || b.nachbestellungen || [];
        const namen = nb.map(a => a.artikelName || a.name || '').filter(Boolean).join('; ');
        rows.push([
          dt.toLocaleDateString('de-DE'),
          b.mitarbeiter || '–',
          b.quelle === 'stockswipe' ? 'StockSwipe' : 'Lagerbestellung',
          nb.length,
          namen,
        ]);
      }

      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const label = WACHEN[getActiveWache()]?.label ?? 'Wache';
      a.download = `Statistik_${label.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    window.exportStatistikPDF = function() {
      const zeitraum = document.getElementById('stat-zeitraum')?.value || 'alle';
      const alle = getStatistikBestellungen(zeitraum);
      if (alle.length === 0) { showPortalToast('Keine Daten vorhanden', 'error'); return; }

      const label = WACHEN[getActiveWache()]?.label ?? 'Wache';
      const now = new Date().toLocaleDateString('de-DE');

      const artikelCount = {};
      let totalNb = 0;
      for (const b of alle) {
        const nb = b.items || b.nachbestellungen || [];
        totalNb += nb.length;
        for (const a of nb) {
          const key = a.artikelName || a.name || '';
          if (key) artikelCount[key] = (artikelCount[key] || 0) + 1;
        }
      }
      const topArtikel = Object.entries(artikelCount).sort((a, b) => b[1] - a[1]).slice(0, 15);

      let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 30px; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
          .kpi-row { display: flex; gap: 20px; margin-bottom: 24px; }
          .kpi { background: #f5f5f5; border-radius: 8px; padding: 12px 18px; flex: 1; }
          .kpi-val { font-size: 28px; font-weight: 700; }
          .kpi-lbl { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: .08em; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th { background: #f0f0f0; padding: 8px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
          td { padding: 8px 12px; border-bottom: 1px solid #eee; }
          h2 { font-size: 14px; margin: 24px 0 8px; }
        </style>
      </head><body>
        <h1>Statistik – ${label}</h1>
        <div class="sub">Erstellt am ${now} · Zeitraum: ${zeitraum === 'alle' ? 'Alle Zeiträume' : zeitraum === 'monat' ? 'Dieser Monat' : zeitraum === 'quartal' ? 'Dieses Quartal' : 'Dieses Jahr'}</div>
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-val">${alle.length}</div><div class="kpi-lbl">Lagerchecks</div></div>
          <div class="kpi"><div class="kpi-val">${totalNb}</div><div class="kpi-lbl">Nachbestellungen</div></div>
          <div class="kpi"><div class="kpi-val">${alle.length > 0 ? (totalNb / alle.length).toFixed(1) : '0'}</div><div class="kpi-lbl">Ø pro Check</div></div>
        </div>
        <h2>Meistbestellte Artikel</h2>
        <table><thead><tr><th>#</th><th>Artikel</th><th>Anzahl</th></tr></thead><tbody>
        ${topArtikel.map(([name, cnt], i) => `<tr><td>${i + 1}</td><td>${name}</td><td><strong>${cnt}×</strong></td></tr>`).join('')}
        </tbody></table>
        <h2>Letzte Lagerchecks</h2>
        <table><thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Quelle</th><th>Bestellt</th></tr></thead><tbody>
        ${alle.slice(0, 30).map(b => {
          const dt = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
          const nb = (b.items || b.nachbestellungen || []).length;
          return `<tr><td>${dt.toLocaleDateString('de-DE')}</td><td>${b.mitarbeiter || '–'}</td><td>${b.quelle === 'stockswipe' ? 'StockSwipe' : 'Lagerbestellung'}</td><td>${nb}</td></tr>`;
        }).join('')}
        </tbody></table>
      </body></html>`;

      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 600);
    };

    function getStatistikBestellungen(zeitraum) {
      if (!zeitraum || zeitraum === 'alle') return alleBestellungen;
      const now = new Date();
      return alleBestellungen.filter(b => {
        const dt = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
        if (zeitraum === 'monat') return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
        if (zeitraum === 'quartal') {
          const q = Math.floor(now.getMonth() / 3);
          return Math.floor(dt.getMonth() / 3) === q && dt.getFullYear() === now.getFullYear();
        }
        if (zeitraum === 'jahr') return dt.getFullYear() === now.getFullYear();
        return true;
      });
    }

    // ══════════════════════════════════════════
    // MITARBEITER VERWALTUNG
    // ══════════════════════════════════════════
    async function sha256(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    let _maPinVal = '', _maPinFirst = '', _maPinConfirming = false, _maEditId = null;

    function updateMaPinDots() {
      for (let i = 0; i < 4; i++)
        document.getElementById(`ma-pdot-${i}`)?.classList.toggle('filled', i < _maPinVal.length);
    }

    window.maPinKey = function(d) {
      if (_maPinVal.length >= 4) return;
      _maPinVal += d;
      updateMaPinDots();
      if (_maPinVal.length === 4) setTimeout(handleMaPinFull, 150);
    };

    window.maPinDel = function() {
      _maPinVal = _maPinVal.slice(0, -1);
      updateMaPinDots();
    };

    function handleMaPinFull() {
      if (!_maPinConfirming) {
        _maPinFirst = _maPinVal;
        _maPinConfirming = true;
        _maPinVal = '';
        updateMaPinDots();
        document.getElementById('ma-pin-label').textContent = 'PIN bestätigen';
        document.getElementById('ma-pin-sub').textContent = 'PIN erneut eingeben';
        document.getElementById('ma-modal-error').textContent = '';
      }
    }

    window.openMaModal = function(empId) {
      _maEditId = empId || null;
      _maPinVal = ''; _maPinFirst = ''; _maPinConfirming = false;
      updateMaPinDots();
      document.getElementById('ma-modal-error').textContent = '';
      document.getElementById('ma-pin-sub').textContent = 'PIN eingeben';
      if (empId) {
        document.getElementById('ma-modal-title').textContent = 'PIN zurücksetzen';
        document.getElementById('ma-modal-fields').style.display = 'none';
        document.getElementById('ma-pin-label').textContent = 'Neuer PIN (4 Stellen)';
      } else {
        document.getElementById('ma-modal-title').textContent = 'Mitarbeiter anlegen';
        document.getElementById('ma-modal-fields').style.display = '';
        document.getElementById('ma-vorname').value = '';
        document.getElementById('ma-nachname').value = '';
        document.getElementById('ma-pin-label').textContent = 'PIN (4 Stellen)';
      }
      document.getElementById('ma-modal').classList.remove('hidden');
    };

    window.closeMaModal = function() {
      document.getElementById('ma-modal').classList.add('hidden');
    };

    window.saveMitarbeiter = async function() {
      const errEl = document.getElementById('ma-modal-error');
      if (!_maPinConfirming || _maPinVal.length < 4) {
        errEl.textContent = 'Bitte PIN zweimal vollständig eingeben';
        return;
      }
      if (_maPinVal !== _maPinFirst) {
        errEl.textContent = 'PINs stimmen nicht überein';
        _maPinConfirming = false; _maPinFirst = ''; _maPinVal = '';
        updateMaPinDots();
        document.getElementById('ma-pin-label').textContent = _maEditId ? 'Neuer PIN (4 Stellen)' : 'PIN (4 Stellen)';
        document.getElementById('ma-pin-sub').textContent = 'PIN eingeben';
        return;
      }
      const btn = document.getElementById('ma-save-btn');
      btn.disabled = true; btn.textContent = '…';
      try {
        const pinHash = await sha256(_maPinVal);
        if (_maEditId) {
          // Check whether this mitarbeiter already has a Firebase Auth account
          const maSnap = await getDoc(doc(db, `${getDBRoot()}/mitarbeiter`, _maEditId));
          const updateData = { pinHash };

          if (!maSnap.data()?.fbEmail) {
            // First-time migration: create Firebase Auth account for existing mitarbeiter
            const fbEmail    = `${_maEditId}@drk.local`;
            const fbPassword = [...crypto.getRandomValues(new Uint8Array(9))]
              .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
            const secondaryApp = initializeApp(firebaseConfig, 'ma-reset-' + _maEditId);
            try {
              await createUserWithEmailAndPassword(getAuth(secondaryApp), fbEmail, fbPassword);
            } finally {
              await deleteApp(secondaryApp);
            }
            updateData.fbEmail    = fbEmail;
            updateData.fbPassword = fbPassword;
          }

          await updateDoc(doc(db, `${getDBRoot()}/mitarbeiter`, _maEditId), updateData);
          showPortalToast('PIN erfolgreich zurückgesetzt', 'success');
        } else {
          const vorname  = document.getElementById('ma-vorname').value.trim();
          const nachname = document.getElementById('ma-nachname').value.trim();
          if (!vorname || !nachname) {
            errEl.textContent = 'Bitte Vor- und Nachname eingeben';
            btn.disabled = false; btn.textContent = 'Speichern'; return;
          }
          const nameKey = (vorname + ' ' + nachname).toLowerCase().replace(/\s+/g, ' ');

          // Pre-generate Firestore doc ID so we can derive the Firebase Auth email from it
          const newDocRef = doc(collection(db, `${getDBRoot()}/mitarbeiter`));
          const fbEmail   = `${newDocRef.id}@drk.local`;
          const fbPassword = [...crypto.getRandomValues(new Uint8Array(9))]
            .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);

          // Create Firebase Auth user via secondary app — avoids logging out the current WL session
          const secondaryApp = initializeApp(firebaseConfig, 'ma-create-' + newDocRef.id);
          try {
            await createUserWithEmailAndPassword(getAuth(secondaryApp), fbEmail, fbPassword);
          } finally {
            await deleteApp(secondaryApp);
          }

          await setDoc(newDocRef, {
            vorname, nachname, nameKey, pinHash,
            fbEmail, fbPassword,
            createdAt: new Date().toISOString(),
          });
          showPortalToast('Mitarbeiter angelegt', 'success');
        }
        closeMaModal();
        loadMitarbeiter();
      } catch(e) {
        errEl.textContent = 'Fehler: ' + e.message;
      } finally {
        btn.disabled = false; btn.textContent = 'Speichern';
      }
    };

    window.deleteMitarbeiter = async function(id, name) {
      if (!confirm(`${name} wirklich löschen?`)) return;
      try {
        await deleteDoc(doc(db, `${getDBRoot()}/mitarbeiter`, id));
        showPortalToast('Mitarbeiter gelöscht', 'success');
        loadMitarbeiter();
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    async function loadMitarbeiter() {
      const tbody = document.getElementById('ma-tbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="3"><div class="loading-state"><div class="spinner"></div></div></td></tr>';
      try {
        const snap = await getDocs(query(collection(db, `${getDBRoot()}/mitarbeiter`), orderBy('nachname')));
        if (snap.empty) {
          tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state">Noch keine Mitarbeiter angelegt.</div></td></tr>';
          return;
        }
        tbody.innerHTML = snap.docs.map(d => {
          const ma      = d.data();
          const created = ma.createdAt ? new Date(ma.createdAt).toLocaleDateString('de-DE') : '–';
          const name    = esc(ma.vorname + ' ' + ma.nachname);
          return `<tr>
            <td><strong>${name}</strong></td>
            <td style="font-family:var(--font-mono);font-size:0.75rem;color:var(--ink-3);">${created}</td>
            <td style="white-space:nowrap;">
              <button class="tbl-btn" onclick="window.openMaModal('${d.id}')">PIN zurücksetzen</button>
              <button class="tbl-btn del" onclick="window.deleteMitarbeiter('${d.id}','${name}')" style="margin-left:6px;">Löschen</button>
            </td>
          </tr>`;
        }).join('');
      } catch(e) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--crit);padding:16px;">${e.message}</td></tr>`;
      }
    }

    function showPortalToast(msg, type = 'success') {
      const t = document.createElement('div');
      t.className = `toast-msg ${type}`;
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    }

    // ── ANLEITUNGEN ──
    const HELP_ITEMS = [
      { id: 'lagersuche',      icon: '🔍', title: 'Lagersuche',                   sub: 'Artikel, Bestände und Lagerorte durchsuchen' },
      { id: 'verfallsmonitor', icon: '⏳', title: 'Verfallsmonitor',               sub: 'Ablaufdaten aller Chargen im Überblick' },
      { id: 'lagerbestellung', icon: '📋', title: 'Lagerbestellung (Multi)',        sub: 'Artikel mit Ja/Nein und Menge bestellen' },
      { id: 'stockswipe',      icon: '👆', title: 'Lagerbestellung (StockSwipe)',   sub: 'Karten swipen – rechts bestellen, links OK' },
      { id: 'verfallscan',     icon: '📷', title: 'Verfallsscan',                  sub: 'Chargen per Barcode scannen und Verfall erfassen' },
      { id: 'pin',             icon: '🔑', title: 'PIN ändern',                    sub: 'Persönlichen 4-stelligen PIN aktualisieren' },
    ];

    let helpImagesPortal  = {};
    let helpContentPortal = {};
    let helpFotoTargetId  = null;

    async function renderAnleitung() {
      try {
        const [snapImg, snapTxt] = await Promise.all([
          getDoc(doc(db, `${getDBRoot()}/config`, 'help_images')),
          getDoc(doc(db, `${getDBRoot()}/config`, 'help_content')),
        ]);
        if (snapImg.exists()) helpImagesPortal  = snapImg.data();
        if (snapTxt.exists()) helpContentPortal = snapTxt.data();
      } catch(e) {}

      const list = document.getElementById('anleitung-list');
      list.innerHTML = HELP_ITEMS.map(item => {
        const imgUrl = helpImagesPortal[item.id];
        const steps  = helpContentPortal[item.id] || [];
        const stepsHtml = steps.map((s, i) => stepRowHTML(item.id, i, s)).join('');
        return `
          <div style="background:var(--surface);border:1px solid var(--hairline);border-radius:14px;padding:14px 16px;">
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
              <div style="font-size:1.6rem;flex-shrink:0;width:36px;text-align:center;">${item.icon}</div>
              <div style="flex:1;min-width:120px;">
                <div style="font-size:0.88rem;font-weight:600;">${esc(item.title)}</div>
                <div style="font-size:0.7rem;color:var(--ink-3);margin-top:2px;">${esc(item.sub)}</div>
                ${steps.length
                  ? `<div style="font-size:0.65rem;color:var(--ok);font-family:var(--font-mono);margin-top:3px;">${steps.length} eigene Schritt${steps.length !== 1 ? 'e' : ''}</div>`
                  : `<div style="font-size:0.65rem;color:var(--ink-4);font-family:var(--font-mono);margin-top:3px;">Standard-Text</div>`}
              </div>
              ${imgUrl ? `
                <img src="${esc(imgUrl)}" alt="${esc(item.title)}"
                  style="width:60px;height:60px;object-fit:cover;border-radius:10px;
                    border:1px solid var(--hairline);flex-shrink:0;">
              ` : `
                <div style="width:60px;height:60px;border-radius:10px;border:1.5px dashed var(--hairline-2);
                  background:var(--surface-2);display:flex;align-items:center;justify-content:center;
                  font-size:1.2rem;flex-shrink:0;color:var(--ink-4);">📷</div>
              `}
              <div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;">
                <button onclick="triggerHelpFotoUpload('${item.id}')" class="tbl-btn">${imgUrl ? '↺ Bild' : '+ Bild'}</button>
                ${imgUrl ? `<button onclick="deleteHelpFoto('${item.id}')" class="tbl-btn del">🗑</button>` : ''}
                <button onclick="toggleStepEditor('${item.id}')" class="tbl-btn">✏️ Schritte</button>
              </div>
            </div>
            <div id="step-editor-${item.id}" style="display:none;margin-top:14px;border-top:1px solid var(--hairline);padding-top:14px;">
              <div style="font-size:0.7rem;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Schritte bearbeiten</div>
              <div id="steps-list-${item.id}">${stepsHtml}</div>
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                <button onclick="addStep('${item.id}')" class="tbl-btn">+ Schritt</button>
                <button onclick="saveSteps('${item.id}')" class="tbl-btn" style="color:var(--ok);border-color:var(--ok);">💾 Speichern</button>
                ${steps.length ? `<button onclick="resetSteps('${item.id}')" class="tbl-btn del" style="margin-left:auto;">↩ Standard</button>` : ''}
              </div>
            </div>
          </div>`;
      }).join('');
    }

    function stepRowHTML(id, idx, text) {
      const rowId = 'step-row-' + id + '-' + idx;
      return `<div id="${rowId}" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">
        <textarea rows="2" style="flex:1;background:var(--surface-2);border:1.5px solid var(--hairline-2);
          border-radius:8px;padding:7px 10px;font-family:var(--font-ui);font-size:0.82rem;color:var(--ink);
          resize:vertical;outline:none;min-height:38px;" placeholder="Schritt beschreiben…"
          onfocus="this.style.borderColor='var(--brand)'" onblur="this.style.borderColor='var(--hairline-2)'">${esc(text)}</textarea>
        <button onclick="document.getElementById('${rowId}').remove()" class="tbl-btn del" style="flex-shrink:0;margin-top:2px;">✕</button>
      </div>`;
    }

    window.toggleStepEditor = function(id) {
      const el = document.getElementById('step-editor-' + id);
      el.style.display = el.style.display === 'none' ? '' : 'none';
    };

    window.addStep = function(id) {
      const list = document.getElementById('steps-list-' + id);
      list.insertAdjacentHTML('beforeend', stepRowHTML(id, Date.now(), ''));
      list.lastElementChild?.querySelector('textarea')?.focus();
    };

    window.saveSteps = async function(id) {
      const list  = document.getElementById('steps-list-' + id);
      const steps = [...list.querySelectorAll('textarea')].map(t => t.value.trim()).filter(Boolean);
      try {
        await setDoc(doc(db, `${getDBRoot()}/config`, 'help_content'), { [id]: steps }, { merge: true });
        helpContentPortal[id] = steps;
        showPortalToast('Schritte gespeichert', 'success');
        renderAnleitung();
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    window.resetSteps = async function(id) {
      const item = HELP_ITEMS.find(x => x.id === id);
      if (!confirm('Standard-Schritte für „' + (item?.title || id) + '" wiederherstellen? Eigene Änderungen gehen verloren.')) return;
      try {
        await setDoc(doc(db, `${getDBRoot()}/config`, 'help_content'), { [id]: [] }, { merge: true });
        helpContentPortal[id] = [];
        showPortalToast('Standard wiederhergestellt', 'success');
        renderAnleitung();
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    window.triggerHelpFotoUpload = function(id) {
      helpFotoTargetId = id;
      document.getElementById('help-foto-input').value = '';
      document.getElementById('help-foto-input').click();
    };

    window.uploadHelpFoto = async function(input) {
      const file = input.files[0];
      if (!file || !helpFotoTargetId) return;
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', CLOUDINARY_PRESET);
        fd.append('folder', 'lagerapp/help');
        const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.secure_url) throw new Error('Upload fehlgeschlagen');
        await setDoc(doc(db, `${getDBRoot()}/config`, 'help_images'), { [helpFotoTargetId]: data.secure_url }, { merge: true });
        helpImagesPortal[helpFotoTargetId] = data.secure_url;
        showPortalToast('Bild gespeichert', 'success');
        renderAnleitung();
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

    window.deleteHelpFoto = async function(id) {
      const item = HELP_ITEMS.find(x => x.id === id);
      if (!confirm('Bild für „' + (item?.title || id) + '" löschen?')) return;
      try {
        await setDoc(doc(db, `${getDBRoot()}/config`, 'help_images'), { [id]: null }, { merge: true });
        delete helpImagesPortal[id];
        showPortalToast('Bild gelöscht', 'success');
        renderAnleitung();
      } catch(e) {
        showPortalToast('Fehler: ' + e.message, 'error');
      }
    };

