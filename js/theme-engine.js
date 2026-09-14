// =============================================================
// THEME-ENGINE.JS — Eigene Themes + Hintergrundbilder
// Lädt direkt nach hub-utils.js (braucht DB/theme/THEME_FAMILY aus
// main.js), vor allen Tab-Skripten. Erweitert setTheme() in main.js nur
// additiv über typeof-Guards — die 6 eingebauten Themes funktionieren
// unverändert, selbst falls diese Datei einmal fehlen sollte.
//
// Zuständigkeiten:
//  - Eigene Themes (Nutzer konfiguriert mehrere UI-Bereiche einzeln,
//    Rest wird abgeleitet), gespeichert wie jede andere Nook-Einstellung
//    über DB.
//  - Hintergrundbild + Kartendurchlässigkeit sind Teil des jeweiligen
//    eigenen Themes (ct.bg / ct.cardOpacity) — beim Wechsel auf ein
//    eigenes Theme wird alles gemeinsam angewendet. Eingebaute Themes
//    (feste CSS, kein Objekt zum Speichern) behalten ihre eigene, davon
//    unabhängige Hintergrundbild-Sektion in den Einstellungen.
//  - Bilddaten liegen in IndexedDB, nicht localStorage (das sich Nook-
//    weit ein Speicherlimit mit allen anderen Daten teilt).
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

// Tokens, die ein eigenes Theme inline überschreibt. --dash-bg/-border
// gehören bewusst NICHT mehr dazu (main.css: .dash-content & Co. haben
// keinen Hintergrund mehr, siehe Problem 3 des Theme-Redesigns) — Sage-
// Familie, Navigation und Modal sind neu dazugekommen (waren vorher
// Markenidentität bzw. an --surface gekoppelt, sind jetzt pro Theme
// einstellbar). Prio-/Budget-/Code-Panel-Farben bleiben weiterhin bewusst
// invariant (main.css-Kommentar) und sind hier nicht enthalten.
const CUSTOM_THEME_VARS = [
  '--bg', '--bg-2', '--surface', '--surface-2', '--surface-3',
  '--border', '--border-strong',
  '--text', '--text-2', '--text-3', '--accent-soft',
  '--sage', '--sage-dark', '--sage-light', '--sage-bg', '--sage-border',
  '--core-nav-bg', '--core-modal-bg', '--core-card-opacity',
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

// Leitet aus den vom Nutzer gewählten Kernfarben (Hintergrund, Fläche,
// Navigation, Modal, Text, Rahmen, Akzent) die restlichen Tokens ab —
// nach demselben Muster, das main.css für die eingebauten Themes
// verwendet (bg-2/surface-2/-3 gestuft, Rahmen als transparente rgba-
// Töne). --surface/-2/-3, Navigation und Modal werden zusätzlich über
// color-mix() mit der gewählten Kartendurchlässigkeit verrechnet — exakt
// derselbe Mechanismus wie bei den 6 eingebauten Themes in main.css,
// hier nur zur Speicherzeit in JS statt im Stylesheet berechnet.
function deriveThemeVars(core, cardOpacityPct) {
  const isDark = teLuminance(core.bg) < 128;
  const tint = isDark ? '#ffffff' : '#000000';
  const borderAlphaLow  = isDark ? 0.09 : 0.16;
  const borderAlphaHigh = isDark ? 0.18 : 0.28;
  const opacity = cardOpacityPct + '%';
  const mix = hex => `color-mix(in srgb, ${hex} ${opacity}, transparent)`;
  return {
    '--bg':            core.bg,
    '--bg-2':          mixHex(core.bg, tint, 0.05),
    '--surface':       mix(core.surface),
    '--surface-2':     mix(mixHex(core.surface, tint, 0.06)),
    '--surface-3':     mix(mixHex(core.surface, tint, 0.12)),
    '--border':        hexToRgba(core.border, borderAlphaLow),
    '--border-strong': hexToRgba(core.border, borderAlphaHigh),
    '--text':          core.text,
    '--text-2':        mixHex(core.text, core.bg, 0.35),
    '--text-3':        mixHex(core.text, core.bg, 0.6),
    '--accent-soft':   mixHex(core.surface, tint, 0.08),
    '--sage':          core.accent,
    '--sage-dark':     mixHex(core.accent, '#000000', 0.25),
    '--sage-light':    mixHex(core.accent, '#ffffff', 0.25),
    '--sage-bg':       hexToRgba(core.accent, 0.13),
    '--sage-border':   hexToRgba(core.accent, 0.32),
    '--core-nav-bg':   mix(core.nav),
    '--core-modal-bg': mix(core.modal),
    '--core-card-opacity': opacity,
  };
}

// =========================================================================
// HINTERGRUNDBILDER
// Metadaten (welches Theme, Größe, Abdunkelung, aktiv/inaktiv) über DB —
// die Bilddaten selbst in IndexedDB (siehe Begründung im Dateikopf).
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

// Parst einen CSS-Farbwert (#rgb, #rrggbb oder rgb[a](...)) in {r,g,b}.
// Zentral hier statt pro Farbe manuell hinterlegt — deckt alle Formate ab,
// die im Theme-System vorkommen können (main.css: Hex; eigene Themes:
// ebenfalls Hex, siehe deriveThemeVars()). Gibt null zurück, wenn der Wert
// nicht geparst werden konnte.
function parseColorToRgb(str) {
  if (!str) return null;
  str = str.trim();
  let m = str.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  }
  m = str.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const h = m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) };
  return null;
}

// Liest die tatsächlich aktive Hintergrundfarbe des aktuellen Themes direkt
// aus der lebenden CSS-Variable --bg (main.css bzw. inline bei eigenen
// Themes, siehe deriveThemeVars()) — eine einzige Quelle der Wahrheit statt
// einer zweiten, separat gepflegten Farbliste pro Theme.
function getThemeBgOverlayColor() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  return parseColorToRgb(raw) || { r: 0, g: 0, b: 0 };
}

// Ein einziger background-image-Stack aus Abdunkelungs-Layer + Bild, statt
// einem eigenen Overlay-Element — body-Hintergrund wird laut CSS-Spec auf
// das Canvas propagiert (siehe main.css: body hat background, html nicht)
// und malt daher garantiert hinter #app, unabhängig von dessen Stacking-
// Context. Kein Risiko, versehentlich über der App-UI zu landen.
// Das Overlay nutzt bewusst die Theme-Hintergrundfarbe (--bg) statt eines
// neutralen Schwarz/Grau — das Bild soll wirken, als schiene es durch die
// gewählte Farbe hindurch, nicht einfach nur dunkler werden.
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
  const { r, g, b } = getThemeBgOverlayColor();
  document.body.style.backgroundImage = `linear-gradient(rgba(${r},${g},${b},${dim}), rgba(${r},${g},${b},${dim})), url("${url}")`;
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundAttachment = 'fixed';
  const size = meta.size || 'cover';
  const imgSize = size === 'contain' ? 'contain' : (size === 'center' ? 'auto' : 'cover');
  document.body.style.backgroundSize = `auto, ${imgSize}`;
  document.body.style.backgroundPosition = 'center, center';
}

function applyThemeBackground(themeId) {
  const meta = getThemeBgMeta(themeId);
  if (!meta || !meta.assetId || meta.enabled === false) { applyBgToDom(null, null); return Promise.resolve(); }
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
// Hintergrundbild wird erst beim Speichern tatsächlich in IndexedDB
// geschrieben (nicht schon bei der Dateiauswahl) — so hinterlässt ein
// Abbrechen des Builders keine verwaisten Einträge.
let _teBuilderPendingFile = null;   // neu gewählte, noch nicht gespeicherte Datei
let _teBuilderExistingBg  = null;   // bg-Metadaten des bearbeiteten Themes beim Öffnen
let _teBuilderBgCleared   = false;  // Nutzer hat "Entfernen" geklickt

const DEFAULT_BUILDER_CORE = {
  bg: '#1a1815', surface: '#252119', nav: '#20201e', modal: '#252119',
  text: '#ede6d8', border: '#f0dcb4', accent: '#728460',
};

function openThemeBuilder(editId) {
  _teBuilderEditId = editId || null;
  const existing = editId ? getCustomTheme(editId) : null;
  // Fallbacks für Themes, die noch mit dem alten (4-Felder-)Builder aus
  // der vorherigen Version erstellt wurden — deren coreColors kennt
  // accent/nav/modal noch nicht.
  const core = Object.assign({}, DEFAULT_BUILDER_CORE, existing && existing.coreColors);
  const cardOpacity = existing ? (existing.cardOpacity ?? 100) : 100;

  document.getElementById('theme-builder-title').textContent = existing ? 'Theme bearbeiten' : 'Theme erstellen';
  document.getElementById('theme-builder-name').value = existing ? existing.name : '';
  document.getElementById('theme-builder-bg').value = core.bg;
  document.getElementById('theme-builder-surface').value = core.surface;
  document.getElementById('theme-builder-nav').value = core.nav;
  document.getElementById('theme-builder-modal').value = core.modal;
  document.getElementById('theme-builder-text').value = core.text;
  document.getElementById('theme-builder-border').value = core.border;
  document.getElementById('theme-builder-accent').value = core.accent;
  document.getElementById('theme-builder-opacity').value = cardOpacity;
  document.getElementById('theme-builder-opacity-label').textContent = cardOpacity + '%';
  document.getElementById('theme-builder-delete').style.display = existing ? '' : 'none';

  _teBuilderPendingFile = null;
  _teBuilderExistingBg = existing ? (existing.bg || null) : null;
  _teBuilderBgCleared = false;
  syncThemeBuilderBgUI();

  updateThemeBuilderPreview();
  document.getElementById('theme-builder-modal-overlay').classList.remove('hidden');
  document.getElementById('theme-builder-name').focus();
}

function closeThemeBuilder() {
  document.getElementById('theme-builder-modal-overlay').classList.add('hidden');
  _teBuilderEditId = null;
  _teBuilderPendingFile = null;
  _teBuilderExistingBg = null;
  _teBuilderBgCleared = false;
}

function updateThemeBuilderPreview() {
  const surface = document.getElementById('theme-builder-surface').value;
  const text = document.getElementById('theme-builder-text').value;
  const border = document.getElementById('theme-builder-border').value;
  const opacity = document.getElementById('theme-builder-opacity').value;
  document.getElementById('theme-builder-opacity-label').textContent = opacity + '%';
  const preview = document.getElementById('theme-builder-preview');
  if (!preview) return;
  preview.style.background = `color-mix(in srgb, ${surface} ${opacity}%, transparent)`;
  preview.style.color = text;
  preview.style.borderColor = hexToRgba(border, 0.35);
}

// ── Hintergrundbild-Sektion innerhalb des Builders ──────────────────────
function syncThemeBuilderBgUI() {
  const filenameEl = document.getElementById('theme-builder-bg-filename');
  const optRow = document.getElementById('theme-builder-bg-options');
  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const dimLabel = document.getElementById('theme-builder-bg-dim-label');
  const enabledCb = document.getElementById('theme-builder-bg-enabled');

  const pendingName = _teBuilderPendingFile ? _teBuilderPendingFile.name : null;
  const meta = _teBuilderBgCleared ? null : (pendingName ? { name: pendingName, size: sizeSel.value, dim: parseInt(dimSlider.value, 10), enabled: enabledCb.checked } : _teBuilderExistingBg);
  const has = !!(meta && (meta.name || meta.assetId));

  filenameEl.textContent = has ? (meta.name || 'Bild geladen') : 'Kein Bild ausgewählt';
  optRow.classList.toggle('hidden', !has);
  if (has && !pendingName) {
    sizeSel.value = meta.size || 'cover';
    dimSlider.value = meta.dim ?? 40;
    dimLabel.textContent = (meta.dim ?? 40) + '%';
    enabledCb.checked = meta.enabled !== false;
  }
}

function initThemeBuilderBgControls() {
  const pickBtn = document.getElementById('theme-builder-bg-pick-btn');
  const clearBtn = document.getElementById('theme-builder-bg-clear-btn');
  const fileInput = document.getElementById('theme-builder-bg-file-input');
  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const dimLabel = document.getElementById('theme-builder-bg-dim-label');

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    _teBuilderPendingFile = file;
    _teBuilderBgCleared = false;
    syncThemeBuilderBgUI();
  });
  clearBtn.addEventListener('click', () => {
    _teBuilderPendingFile = null;
    _teBuilderBgCleared = true;
    syncThemeBuilderBgUI();
  });
  dimSlider.addEventListener('input', () => { dimLabel.textContent = dimSlider.value + '%'; });
}

// Löst die Hintergrundbild-Auswahl des Builders in konkrete bg-Metadaten
// auf und schreibt die Bilddaten (falls neu) erst jetzt nach IndexedDB —
// wird nur beim tatsächlichen Speichern des Themes aufgerufen.
function resolveThemeBuilderBg() {
  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const enabledCb = document.getElementById('theme-builder-bg-enabled');

  if (_teBuilderBgCleared) {
    if (_teBuilderExistingBg && _teBuilderExistingBg.assetId) deleteBackgroundAsset(_teBuilderExistingBg.assetId);
    return Promise.resolve(null);
  }
  if (_teBuilderPendingFile) {
    const assetId = 'bg_' + Date.now();
    return putBackgroundAsset(assetId, _teBuilderPendingFile).then(() => {
      if (_teBuilderExistingBg && _teBuilderExistingBg.assetId) deleteBackgroundAsset(_teBuilderExistingBg.assetId);
      return { assetId, name: _teBuilderPendingFile.name, size: sizeSel.value, dim: parseInt(dimSlider.value, 10), enabled: enabledCb.checked };
    }).catch(e => {
      console.warn('Theme-Engine: Hintergrundbild konnte nicht gespeichert werden', e);
      alert('Hintergrundbild konnte nicht gespeichert werden — dieser Browser unterstützt hier evtl. kein IndexedDB (kommt z.B. vor, wenn Nook als lokale Datei geöffnet wird). Das Theme wird ohne Hintergrundbild gespeichert.');
      return _teBuilderExistingBg || null;
    });
  }
  // Kein neues Bild gewählt, keine Löschung — bestehende Metadaten ggf.
  // nur in Größe/Abdunkelung/aktiv aktualisieren.
  if (_teBuilderExistingBg) {
    return Promise.resolve(Object.assign({}, _teBuilderExistingBg, {
      size: sizeSel.value, dim: parseInt(dimSlider.value, 10), enabled: enabledCb.checked,
    }));
  }
  return Promise.resolve(null);
}

function saveThemeBuilder() {
  const nameInput = document.getElementById('theme-builder-name');
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }

  const core = {
    bg:      document.getElementById('theme-builder-bg').value,
    surface: document.getElementById('theme-builder-surface').value,
    nav:     document.getElementById('theme-builder-nav').value,
    modal:   document.getElementById('theme-builder-modal').value,
    text:    document.getElementById('theme-builder-text').value,
    border:  document.getElementById('theme-builder-border').value,
    accent:  document.getElementById('theme-builder-accent').value,
  };
  const cardOpacity = parseInt(document.getElementById('theme-builder-opacity').value, 10);
  const vars = deriveThemeVars(core, cardOpacity);
  const family = teLuminance(core.bg) < 128 ? 'dark' : 'light';
  const editId = _teBuilderEditId;

  resolveThemeBuilderBg().then(bg => {
    if (editId) {
      const ct = getCustomTheme(editId);
      if (ct) {
        ct.name = name; ct.coreColors = core; ct.vars = vars; ct.family = family;
        ct.cardOpacity = cardOpacity; ct.bg = bg;
        saveCustomThemes();
        if (theme === ct.id) setTheme(ct.id); // sofort neu anwenden, falls gerade aktiv
      }
    } else {
      const id = 'custom_' + Date.now();
      customThemes.push({ id, name, family, coreColors: core, vars, cardOpacity, bg });
      saveCustomThemes();
      setTheme(id);
      if (typeof renderThemeSettings === 'function') renderThemeSettings();
    }
    closeThemeBuilder();
    renderThemeGallery();
  });
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
// SETTINGS: Hintergrundbild-Sektion NUR für eingebaute Themes — eigene
// Themes bringen ihr Hintergrundbild direkt aus dem Theme-Builder mit
// (siehe oben), diese Sektion wird für sie ausgeblendet.
// =========================================================================

function syncThemeBgUI() {
  const filenameEl = document.getElementById('bg-image-filename');
  if (!filenameEl) return;
  const row     = document.getElementById('bg-image-row');
  const optRow  = document.getElementById('bg-image-options-row');
  const dimRow  = document.getElementById('bg-image-dim-row');
  const note    = document.getElementById('bg-image-custom-note');
  const sizeSel = document.getElementById('bg-image-size');
  const dimSlider = document.getElementById('bg-dim-slider');
  const dimLabel  = document.getElementById('bg-dim-label');

  const custom = isCustomThemeId(theme);
  row.classList.toggle('hidden', custom);
  note.classList.toggle('hidden', !custom);
  if (custom) { optRow.classList.add('hidden'); dimRow.classList.add('hidden'); return; }

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
  document.getElementById('theme-builder-opacity').addEventListener('input', updateThemeBuilderPreview);
  document.getElementById('theme-builder-modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'theme-builder-modal-overlay') closeThemeBuilder();
  });
}
injectThemeBuilderListeners();
initThemeBuilderBgControls();
initThemeBgControls();
