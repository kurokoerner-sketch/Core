// =============================================================
// THEME-ENGINE.JS — Eigene Themes + Hintergrundbilder
// Lädt direkt nach hub-utils.js (braucht DB/theme/THEME_FAMILY aus
// main.js), vor allen Tab-Skripten. Erweitert setTheme() in main.js nur
// additiv über typeof-Guards — die 6 eingebauten Themes funktionieren
// unverändert, selbst falls diese Datei einmal fehlen sollte.
//
// Zuständigkeiten:
//  - Eigene Themes (Nutzer wählt Kernfarben, Rest wird abgeleitet),
//    gespeichert wie jede andere Nook-Einstellung über DB.
//  - Hintergrundbilder pro Theme (eingebaut oder eigene) — Metadaten über
//    DB, die eigentlichen Bilddaten in IndexedDB (nicht localStorage, das
//    sich Nook-weit ein Speicherlimit mit allen anderen Daten teilt).
// =============================================================

// ── Eingebaute Themes: nur Anzeige-Metadaten für die Galerie, NICHT die
//    CSS-Kaskade selbst (die bleibt vollständig in main.css) ────────────
const THEME_REGISTRY = [
  { id: 'light',    label: 'Light' },
  { id: 'dark',     label: 'Classic Dark' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest',   label: 'Forest' },
  { id: 'espresso', label: 'Espresso' },
  { id: 'oled',     label: 'OLED' },
];

// Die 13 Tokens, die main.css pro Theme-Variante überschreibt (siehe
// [data-theme="..."]-Blöcke) — Sage/Prio/Budget/Code-Panel-Farben bleiben
// bewusst Markenidentität und sind hier nicht editierbar.
const CUSTOM_THEME_VARS = [
  '--bg', '--bg-2', '--surface', '--surface-2', '--surface-3',
  '--dash-bg', '--dash-border', '--border', '--border-strong',
  '--text', '--text-2', '--text-3', '--accent-soft',
];

let customThemes     = DB.get('customThemes', []);
let themeBackgrounds = DB.get('themeBackgrounds', {});

function saveCustomThemes()     { DB.set('customThemes', customThemes); }
function saveThemeBackgrounds() { DB.set('themeBackgrounds', themeBackgrounds); }

function getCustomTheme(id)  { return customThemes.find(t => t.id === id) || null; }
function isCustomThemeId(id) { return !!getCustomTheme(id); }

// ── Eigene Theme-Farben anwenden/entfernen ──────────────────────────────
// Aufgerufen aus setTheme() (main.js) über typeof-Guards.
function clearCustomThemeVars() {
  CUSTOM_THEME_VARS.forEach(v => document.documentElement.style.removeProperty(v));
}
function applyCustomThemeVars(id) {
  const ct = getCustomTheme(id);
  if (!ct) return false;
  document.documentElement.setAttribute('data-theme', id);
  document.documentElement.setAttribute('data-theme-family', ct.family);
  Object.entries(ct.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  return true;
}

// ── Farb-Hilfsfunktionen für den Theme-Builder ──────────────────────────
// mixHex(a, b, t) kommt aus hub-utils.js (lädt davor), hexToRgba(hex, a)
// aus main.js — beide hier wiederverwendet statt neu erfunden.
function teLuminance(hex) {
  const h = (hex || '#808080').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Leitet aus 4 vom Nutzer gewählten Kernfarben (Hintergrund, Fläche, Text,
// Rahmen) die restlichen der 13 Tokens ab — nach demselben Muster, das
// main.css für die eingebauten Dark-Varianten verwendet (bg-2/surface-2/-3
// gestuft, Rahmen als transparente rgba-Töne statt Volltonfarbe).
function deriveThemeVars(core) {
  const isDark = teLuminance(core.bg) < 128;
  const tint = isDark ? '#ffffff' : '#000000';
  const borderAlphaLow  = isDark ? 0.09 : 0.16;
  const borderAlphaHigh = isDark ? 0.18 : 0.28;
  return {
    '--bg':            core.bg,
    '--bg-2':          mixHex(core.bg, tint, 0.05),
    '--surface':       core.surface,
    '--surface-2':     mixHex(core.surface, tint, 0.06),
    '--surface-3':     mixHex(core.surface, tint, 0.12),
    '--dash-bg':       mixHex(core.bg, core.surface, 0.5),
    '--dash-border':   hexToRgba(core.border, borderAlphaLow),
    '--border':        hexToRgba(core.border, borderAlphaLow),
    '--border-strong': hexToRgba(core.border, borderAlphaHigh),
    '--text':          core.text,
    '--text-2':        mixHex(core.text, core.bg, 0.35),
    '--text-3':        mixHex(core.text, core.bg, 0.6),
    '--accent-soft':   mixHex(core.surface, tint, 0.08),
  };
}

// =========================================================================
// HINTERGRUNDBILDER
// Metadaten (welches Theme, Größe/Position, Abdunkelung) über DB — die
// Bilddaten selbst in IndexedDB (siehe Begründung im Dateikopf).
// =========================================================================

const THEME_ASSETS_DB_NAME = 'nook-theme-assets';
const THEME_ASSETS_STORE   = 'backgrounds';
let _teDbPromise = null;

function openThemeAssetsDB() {
  if (_teDbPromise) return _teDbPromise;
  _teDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB nicht verfügbar')); return; }
    let req;
    try { req = indexedDB.open(THEME_ASSETS_DB_NAME, 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(THEME_ASSETS_STORE)) db.createObjectStore(THEME_ASSETS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error || new Error('IndexedDB konnte nicht geöffnet werden'));
    req.onblocked = () => reject(new Error('IndexedDB blockiert'));
  });
  return _teDbPromise;
}

function putBackgroundAsset(assetId, blob) {
  return openThemeAssetsDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(THEME_ASSETS_STORE, 'readwrite');
    tx.objectStore(THEME_ASSETS_STORE).put(blob, assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function getBackgroundAsset(assetId) {
  return openThemeAssetsDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(THEME_ASSETS_STORE, 'readonly');
    const req = tx.objectStore(THEME_ASSETS_STORE).get(assetId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function deleteBackgroundAsset(assetId) {
  return openThemeAssetsDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(THEME_ASSETS_STORE, 'readwrite');
    tx.objectStore(THEME_ASSETS_STORE).delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })).catch(e => console.warn('Theme-Engine: Hintergrundbild konnte nicht gelöscht werden', e));
}

// Eingebaute Themes: Metadaten in themeBackgrounds[id]. Eigene Themes:
// Metadaten direkt am Theme-Objekt (ct.bg) — kein zweiter Speicherort.
function getThemeBgMeta(id) {
  const ct = getCustomTheme(id);
  if (ct) return ct.bg || null;
  return themeBackgrounds[id] || null;
}
function setThemeBgMeta(id, meta) {
  const ct = getCustomTheme(id);
  if (ct) { ct.bg = meta; saveCustomThemes(); return; }
  if (meta) themeBackgrounds[id] = meta; else delete themeBackgrounds[id];
  saveThemeBackgrounds();
}

let _teCurrentBgObjectUrl = null;

// Ein einziger background-image-Stack aus Abdunkelungs-Layer + Bild, statt
// einem eigenen Overlay-Element — body-Hintergrund wird laut CSS-Spec auf
// das Canvas propagiert (siehe main.css: body hat background, html nicht)
// und malt daher garantiert hinter #app, unabhängig von dessen Stacking-
// Context. Kein Risiko, versehentlich über der App-UI zu landen.
function applyBgToDom(blob, meta) {
  if (_teCurrentBgObjectUrl) { URL.revokeObjectURL(_teCurrentBgObjectUrl); _teCurrentBgObjectUrl = null; }
  if (!blob) {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundRepeat = '';
    document.body.style.backgroundAttachment = '';
    return;
  }
  const url = URL.createObjectURL(blob);
  _teCurrentBgObjectUrl = url;
  const dim = ((meta.dim ?? 40) / 100).toFixed(2);
  document.body.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${url}")`;
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundAttachment = 'fixed';
  const size = meta.size || 'cover';
  const imgSize = size === 'contain' ? 'contain' : (size === 'center' ? 'auto' : 'cover');
  document.body.style.backgroundSize = `auto, ${imgSize}`;
  document.body.style.backgroundPosition = 'center, center';
}

function applyThemeBackground(themeId) {
  const meta = getThemeBgMeta(themeId);
  if (!meta || !meta.assetId) { applyBgToDom(null, null); return Promise.resolve(); }
  return getBackgroundAsset(meta.assetId)
    .then(blob => applyBgToDom(blob, meta))
    .catch(e => {
      console.warn('Theme-Engine: Hintergrundbild konnte nicht geladen werden (IndexedDB evtl. nicht verfügbar, z.B. unter file://)', e);
      applyBgToDom(null, null);
    });
}

// =========================================================================
// EIGENE THEMES — CRUD + Builder-Modal
// =========================================================================

function deleteCustomTheme(id) {
  const ct = getCustomTheme(id);
  if (!ct) return;
  const wasActive = theme === id;
  if (ct.bg && ct.bg.assetId) deleteBackgroundAsset(ct.bg.assetId);
  customThemes = customThemes.filter(t => t.id !== id);
  saveCustomThemes();
  if (wasActive) setTheme('light');
  renderThemeGallery();
  if (typeof renderThemeSettings === 'function') renderThemeSettings();
}

let _teBuilderEditId = null;

function openThemeBuilder(editId) {
  _teBuilderEditId = editId || null;
  const existing = editId ? getCustomTheme(editId) : null;
  const core = (existing && existing.coreColors) || { bg: '#1a1815', surface: '#252119', text: '#ede6d8', border: '#f0dcb4' };

  document.getElementById('theme-builder-title').textContent = existing ? 'Theme bearbeiten' : 'Theme erstellen';
  document.getElementById('theme-builder-name').value = existing ? existing.name : '';
  document.getElementById('theme-builder-bg').value = core.bg;
  document.getElementById('theme-builder-surface').value = core.surface;
  document.getElementById('theme-builder-text').value = core.text;
  document.getElementById('theme-builder-border').value = core.border;
  document.getElementById('theme-builder-delete').style.display = existing ? '' : 'none';

  updateThemeBuilderPreview();
  document.getElementById('theme-builder-modal-overlay').classList.remove('hidden');
  document.getElementById('theme-builder-name').focus();
}

function closeThemeBuilder() {
  document.getElementById('theme-builder-modal-overlay').classList.add('hidden');
  _teBuilderEditId = null;
}

function updateThemeBuilderPreview() {
  const surface = document.getElementById('theme-builder-surface').value;
  const text = document.getElementById('theme-builder-text').value;
  const border = document.getElementById('theme-builder-border').value;
  const preview = document.getElementById('theme-builder-preview');
  if (!preview) return;
  preview.style.background = surface;
  preview.style.color = text;
  preview.style.borderColor = hexToRgba(border, 0.35);
}

function saveThemeBuilder() {
  const nameInput = document.getElementById('theme-builder-name');
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }

  const core = {
    bg:      document.getElementById('theme-builder-bg').value,
    surface: document.getElementById('theme-builder-surface').value,
    text:    document.getElementById('theme-builder-text').value,
    border:  document.getElementById('theme-builder-border').value,
  };
  const vars = deriveThemeVars(core);
  const family = teLuminance(core.bg) < 128 ? 'dark' : 'light';

  if (_teBuilderEditId) {
    const ct = getCustomTheme(_teBuilderEditId);
    if (ct) {
      ct.name = name; ct.coreColors = core; ct.vars = vars; ct.family = family;
      saveCustomThemes();
      if (theme === ct.id) setTheme(ct.id); // sofort neu anwenden, falls gerade aktiv
    }
  } else {
    const id = 'custom_' + Date.now();
    customThemes.push({ id, name, family, coreColors: core, vars, bg: null });
    saveCustomThemes();
    setTheme(id);
    if (typeof renderThemeSettings === 'function') renderThemeSettings();
  }

  closeThemeBuilder();
  renderThemeGallery();
}

// ── Galerie: eigene Theme-Buttons + "+"-Button in das bestehende
//    #theme-picker rendern, im gleichen Look wie die 6 eingebauten
//    Buttons (.clock-type-btn.theme-picker-btn) ────────────────────────
function renderThemeGallery() {
  const picker = document.getElementById('theme-picker');
  if (picker) {
    picker.querySelectorAll('.theme-picker-btn-custom, .theme-picker-btn-add').forEach(el => el.remove());

    customThemes.forEach(ct => {
      const btn = document.createElement('button');
      btn.className = 'clock-type-btn theme-picker-btn theme-picker-btn-custom' + (theme === ct.id ? ' active' : '');
      btn.dataset.themeValue = ct.id;
      btn.innerHTML = `
        <span class="theme-swatch-dot" style="background:${ct.vars['--surface']};border-color:${ct.vars['--border-strong']};"></span>
        <span>${escHtml(ct.name)}</span>
        <span class="theme-picker-icon theme-picker-icon-edit" title="Bearbeiten">✎</span>
        <span class="theme-picker-icon theme-picker-icon-del" title="Löschen">✕</span>
      `;
      btn.addEventListener('click', e => {
        if (e.target.closest('.theme-picker-icon')) return;
        setTheme(ct.id);
        renderThemeGallery();
        if (typeof renderThemeSettings === 'function') renderThemeSettings();
      });
      btn.querySelector('.theme-picker-icon-edit').addEventListener('click', e => {
        e.stopPropagation();
        openThemeBuilder(ct.id);
      });
      btn.querySelector('.theme-picker-icon-del').addEventListener('click', e => {
        e.stopPropagation();
        hubConfirm({ title: 'Theme löschen?', message: `"${ct.name}" wird endgültig gelöscht.`, confirmText: 'Löschen', danger: true })
          .then(ok => { if (ok) deleteCustomTheme(ct.id); });
      });
      picker.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'clock-type-btn theme-picker-btn-add';
    addBtn.title = 'Eigenes Theme erstellen';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => openThemeBuilder(null));
    picker.appendChild(addBtn);
  }

  syncThemeBgUI();
}

// =========================================================================
// SETTINGS: Hintergrundbild-Sektion (wirkt auf das jeweils aktive Theme,
// eingebaut oder eigen — gleicher Mechanismus für beide)
// =========================================================================

function syncThemeBgUI() {
  const filenameEl = document.getElementById('bg-image-filename');
  if (!filenameEl) return;
  const optRow  = document.getElementById('bg-image-options-row');
  const dimRow  = document.getElementById('bg-image-dim-row');
  const sizeSel = document.getElementById('bg-image-size');
  const dimSlider = document.getElementById('bg-dim-slider');
  const dimLabel  = document.getElementById('bg-dim-label');

  const meta = getThemeBgMeta(theme);
  const has = !!(meta && meta.assetId);
  filenameEl.textContent = has ? (meta.name || 'Bild geladen') : 'Kein Bild ausgewählt';
  optRow.classList.toggle('hidden', !has);
  dimRow.classList.toggle('hidden', !has);
  if (has) {
    sizeSel.value = meta.size || 'cover';
    dimSlider.value = meta.dim ?? 40;
    dimLabel.textContent = (meta.dim ?? 40) + '%';
  }
}

function initThemeBgControls() {
  const pickBtn   = document.getElementById('bg-image-pick-btn');
  const clearBtn  = document.getElementById('bg-image-clear-btn');
  const fileInput = document.getElementById('bg-image-file-input');
  const sizeSelect = document.getElementById('bg-image-size');
  const dimSlider  = document.getElementById('bg-dim-slider');
  const dimLabel   = document.getElementById('bg-dim-label');
  if (!pickBtn) return;

  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const assetId = 'bg_' + Date.now();
    const prevMeta = getThemeBgMeta(theme);
    putBackgroundAsset(assetId, file).then(() => {
      if (prevMeta && prevMeta.assetId) deleteBackgroundAsset(prevMeta.assetId);
      const meta = { assetId, name: file.name, size: (prevMeta && prevMeta.size) || 'cover', dim: prevMeta ? prevMeta.dim : 40 };
      setThemeBgMeta(theme, meta);
      applyThemeBackground(theme);
      syncThemeBgUI();
    }).catch(e => {
      console.warn('Theme-Engine: Hintergrundbild konnte nicht gespeichert werden', e);
      alert('Hintergrundbild konnte nicht gespeichert werden — dieser Browser unterstützt hier evtl. kein IndexedDB (kommt z.B. vor, wenn Nook als lokale Datei geöffnet wird).');
    });
  });

  clearBtn.addEventListener('click', () => {
    const meta = getThemeBgMeta(theme);
    if (meta && meta.assetId) deleteBackgroundAsset(meta.assetId);
    setThemeBgMeta(theme, null);
    applyThemeBackground(theme);
    syncThemeBgUI();
  });

  sizeSelect.addEventListener('change', () => {
    const meta = getThemeBgMeta(theme);
    if (!meta) return;
    meta.size = sizeSelect.value;
    setThemeBgMeta(theme, meta);
    applyThemeBackground(theme);
  });

  dimSlider.addEventListener('input', () => {
    const meta = getThemeBgMeta(theme);
    if (!meta) return;
    meta.dim = parseInt(dimSlider.value, 10);
    dimLabel.textContent = meta.dim + '%';
    setThemeBgMeta(theme, meta);
    applyThemeBackground(theme);
  });
}

// =========================================================================
// INIT
// =========================================================================

// main.js hat data-theme/-family beim Laden bereits gesetzt (kennt zu dem
// Zeitpunkt aber keine eigenen Themes, da diese Datei erst danach lädt) —
// hier ggf. auf das echte eigene Theme + dessen Family korrigieren.
if (getCustomTheme(theme)) applyCustomThemeVars(theme);
applyThemeBackground(theme);

function injectThemeBuilderListeners() {
  document.getElementById('theme-builder-close').addEventListener('click', closeThemeBuilder);
  document.getElementById('theme-builder-cancel').addEventListener('click', closeThemeBuilder);
  document.getElementById('theme-builder-save').addEventListener('click', saveThemeBuilder);
  document.getElementById('theme-builder-delete').addEventListener('click', () => {
    if (!_teBuilderEditId) return;
    const id = _teBuilderEditId;
    const ct = getCustomTheme(id);
    closeThemeBuilder();
    if (ct) {
      hubConfirm({ title: 'Theme löschen?', message: `"${ct.name}" wird endgültig gelöscht.`, confirmText: 'Löschen', danger: true })
        .then(ok => { if (ok) deleteCustomTheme(id); });
    }
  });
  ['theme-builder-bg', 'theme-builder-surface', 'theme-builder-text', 'theme-builder-border'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateThemeBuilderPreview);
  });
  document.getElementById('theme-builder-modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'theme-builder-modal-overlay') closeThemeBuilder();
  });
}
injectThemeBuilderListeners();
initThemeBgControls();
