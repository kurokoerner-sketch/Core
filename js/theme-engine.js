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
//  - Theme-Editor: eine "Vorlage"-Leiste im Editor selbst erlaubt es,
//    die Werte eines bereits vorhandenen Themes (eingebaut oder eigen)
//    in die aktuell offenen Formularfelder zu übernehmen. Das ist KEIN
//    separates Verwaltungssystem — nichts wird dabei angelegt/verändert,
//    erst der normale "Speichern"-Klick erzeugt/ändert ein Theme.
// =============================================================

// ── Eingebaute Themes: Anzeige-Metadaten, NICHT die CSS-Kaskade selbst
//    (die bleibt vollständig in main.css). `core` dupliziert absichtlich
//    die literalen Werte aus main.css (:root + [data-theme="x"]) — nötig,
//    weil eingebaute Themes reines CSS sind und kein JS-Objekt haben, aus
//    dem sich Werte für die Vorlagen-Leiste im Theme-Editor lesen ließen.
//    Nav/Modal entsprechen bei den eingebauten Themes --surface (siehe
//    main.css: --core-nav-bg/-modal-bg leiten sich dort von
//    --surface-solid ab). Akzent hat im ganzen main.css nur zwei echte
//    Werte (Light vs. gemeinsame Dark-Familie — keine der 5 benannten
//    Dark-Varianten überschreibt --sage einzeln).
const THEME_REGISTRY = [
  { id: 'light',    label: 'Light',        core: { bg: '#EFEBe3', surface: '#FDFAF5', nav: '#FDFAF5', modal: '#FDFAF5', text: '#24211C', border: '#786541', accent: '#6B7F58' } },
  { id: 'dark',     label: 'Classic Dark', core: { bg: '#181817', surface: '#20201e', nav: '#20201e', modal: '#20201e', text: '#e6e3df', border: '#CBC8C2', accent: '#728460' } },
  { id: 'midnight', label: 'Midnight',     core: { bg: '#121419', surface: '#141925', nav: '#141925', modal: '#141925', text: '#dde0e8', border: '#B0BEDD', accent: '#728460' } },
  { id: 'forest',   label: 'Forest',       core: { bg: '#131915', surface: '#16251b', nav: '#16251b', modal: '#16251b', text: '#dee7e1', border: '#B5D9C2', accent: '#728460' } },
  { id: 'espresso', label: 'Espresso',     core: { bg: '#1a1815', surface: '#252019', nav: '#252019', modal: '#252019', text: '#ede3d8', border: '#E6C9A8', accent: '#728460' } },
  { id: 'oled',     label: 'OLED',         core: { bg: '#070707', surface: '#090909', nav: '#090909', modal: '#090909', text: '#e3e3e2', border: '#C7C7C7', accent: '#728460' } },
];

// Tokens, die ein eigenes Theme inline überschreibt. --dash-bg/-border
// gehören bewusst NICHT dazu (main.css: .dash-content & Co. haben keinen
// Hintergrund mehr) — Sage-Familie, Navigation, Modal und Schriftart sind
// einstellbar. Prio-/Budget-/Code-Panel-Farben bleiben bewusst invariant
// (main.css-Kommentar) und sind hier nicht enthalten.
const CUSTOM_THEME_VARS = [
  '--bg', '--bg-2', '--surface', '--surface-2', '--surface-3',
  '--border', '--border-strong',
  '--text', '--text-2', '--text-3', '--accent-soft',
  '--sage', '--sage-dark', '--sage-light', '--sage-bg', '--sage-border',
  '--core-nav-bg', '--core-modal-bg', '--core-card-opacity',
  '--font', '--core-font-scale', '--mono',
];

// =========================================================================
// SCHRIFTART
// --font ist main.css' bereits vorhandene, zentrale Font-Variable (body
// { font-family: var(--font) } main.css:250 u.a.) — es wird bewusst KEINE
// zweite/parallele Variable eingeführt, sondern dieselbe von eigenen
// Themes mit überschrieben (siehe CUSTOM_THEME_VARS oben). --mono (Zahlen/
// Zeitangaben) bleibt unangetastet, wie im restlichen main.css auch.
//
// Klassisch/Modern/Exotisch brauchen keine eigenen Font-Dateien im Projekt:
// Klassisch = Systemschriften (immer vorhanden), Modern/Exotisch = Google
// Fonts über denselben CDN-Link, den main.css für DM Sans/DM Mono ohnehin
// schon lädt (siehe index.html <head>), alle SIL Open Font License.
const FONT_CATEGORIES = [
  { label: 'Standard', fonts: [
    { label: 'CORE Standard (DM Sans)', stack: "'DM Sans', system-ui, sans-serif" },
  ]},
  { label: 'Klassisch', fonts: [
    { label: 'Arial',            stack: "Arial, Helvetica, sans-serif" },
    { label: 'Georgia',          stack: "Georgia, 'Times New Roman', serif" },
    { label: 'Verdana',          stack: "Verdana, Geneva, sans-serif" },
    { label: 'Trebuchet MS',     stack: "'Trebuchet MS', sans-serif" },
    { label: 'Times New Roman',  stack: "'Times New Roman', Times, serif" },
    { label: 'Courier New',      stack: "'Courier New', Courier, monospace" },
  ]},
  { label: 'Modern', fonts: [
    { label: 'Inter',      stack: "'Inter', sans-serif" },
    { label: 'Montserrat', stack: "'Montserrat', sans-serif" },
    { label: 'Poppins',    stack: "'Poppins', sans-serif" },
    { label: 'Roboto',     stack: "'Roboto', sans-serif" },
  ]},
  { label: 'Exotisch', fonts: [
    { label: 'Orbitron (Sci-Fi)',            stack: "'Orbitron', sans-serif" },
    { label: 'Cinzel (Mystic)',              stack: "'Cinzel', serif" },
    { label: 'UnifrakturCook (Gothic)',      stack: "'UnifrakturCook', cursive" },
    { label: 'Press Start 2P (Pixel)',       stack: "'Press Start 2P', monospace" },
    { label: 'Bangers (Comic)',              stack: "'Bangers', cursive" },
    { label: 'Permanent Marker (Handschrift)', stack: "'Permanent Marker', cursive" },
  ]},
];
const DEFAULT_FONT_STACK = FONT_CATEGORIES[0].fonts[0].stack;

// ── Eigene Fonts aus assets/fonts/ ───────────────────────────────────────
// Bewusst KEINE automatische Erkennung beliebiger Dateien (siehe Auftrag,
// unter file:// technisch ohnehin nicht zuverlässig möglich — kein
// fetch()/Verzeichnis-Listing) — jede Datei wird hier einmal eingetragen.
// Mehrere Schnitte derselben Familie bekommen denselben `family`-Wert mit
// passendem weight/style (aktuell kommt jede Datei als einzelner Schnitt
// vor, keine Regular/Bold/Italic-Gruppen unter den vorhandenen Dateien).
//
// Anzeigenamen kommen aus den echten Font-Metadaten (family-Feld der
// Datei, per `fc-scan` ausgelesen — kein Parsing im Projekt selbst, nur
// zur Erstellung dieser Liste verwendet), mit leichter manueller
// Nachbearbeitung, wo die Metadaten Rauschen enthalten (z.B. eingebettete
// Lizenztexte oder "PERSONAL USE"-Zusätze im Namen selbst).
const CUSTOM_FONT_FILES = [
  { family: 'Shock Rumble',       source: 'assets/fonts/Shock Rumble Demo.ttf', weight: '400', style: 'normal' },
  { family: 'Another Tag',        source: 'assets/fonts/aAnotherTag.ttf', weight: '400', style: 'normal' },
  { family: 'Alice in Wonderland', source: 'assets/fonts/Alice_in_Wonderland_3.ttf', weight: '400', style: 'normal' },
  { family: 'Ancient Greek',      source: 'assets/fonts/Ancient Greek.ttf', weight: '400', style: 'normal' },
  { family: 'Bing Boss',          source: 'assets/fonts/Bing Boss.otf', weight: '400', style: 'normal' },
  { family: 'Black North',        source: 'assets/fonts/Black North.ttf', weight: '400', style: 'normal' },
  { family: 'Blade Knight',       source: 'assets/fonts/Blade Knight Regular.otf', weight: '400', style: 'normal' },
  { family: 'California',         source: 'assets/fonts/CALIFORNIA PERSONAL USE.ttf', weight: '400', style: 'normal' },
  { family: 'Celtic Garamond',    source: 'assets/fonts/CELTG___.TTF', weight: '400', style: 'normal' },
  { family: "Coraline's Cat",     source: "assets/fonts/Coraline's Cat.ttf", weight: '400', style: 'normal' },
  { family: 'Cubic',              source: 'assets/fonts/cubic.ttf', weight: '400', style: 'normal' },
  { family: 'Cyber Digital',      source: 'assets/fonts/CyberDigital.ttf', weight: '400', style: 'normal' },
  { family: 'Darling Letter',     source: 'assets/fonts/Darling Letter.otf', weight: '400', style: 'normal' },
  { family: 'Diogenes',           source: 'assets/fonts/DIOGENES.ttf', weight: '400', style: 'normal' },
  { family: 'Dune Rise',          source: 'assets/fonts/Dune_Rise.ttf', weight: '400', style: 'normal' },
  { family: 'Evanescent',         source: 'assets/fonts/evanescent_p.ttf', weight: '400', style: 'normal' },
  { family: 'Father Galaxy',      source: 'assets/fonts/FatherGalaxy-Regular.otf', weight: '400', style: 'normal' },
  { family: 'First Order',        source: 'assets/fonts/firstorder.ttf', weight: '400', style: 'normal' },
  { family: 'Game Of Squids',     source: 'assets/fonts/Game Of Squids.ttf', weight: '400', style: 'normal' },
  { family: 'Gang of Three',      source: 'assets/fonts/go3v2.ttf', weight: '400', style: 'normal' },
  { family: 'Greek Freak',        source: 'assets/fonts/Greek-Freak.ttf', weight: '400', style: 'normal' },
  { family: 'Harry P',            source: 'assets/fonts/HARRYP__.TTF', weight: '400', style: 'normal' },
  { family: 'Help Me',            source: 'assets/fonts/HelpMe.ttf', weight: '400', style: 'normal' },
  { family: 'Hoshiko Satsuki',    source: 'assets/fonts/Hoshiko Satsuki.ttf', weight: '400', style: 'normal' },
  { family: 'Impact Label SWL Reversed', source: 'assets/fonts/Impact Label SWL Reversed.ttf', weight: '400', style: 'normal' },
  { family: 'JMH Typewriter',     source: 'assets/fonts/JMH Typewriter.ttf', weight: '400', style: 'normal' },
  { family: 'Klaxon Crunchy',     source: 'assets/fonts/Klaxon-Crunchy.otf', weight: '400', style: 'normal' },
  { family: 'Laugh Tales',        source: 'assets/fonts/Laugh Tales Demo.otf', weight: '400', style: 'normal' },
  { family: 'Mayan',              source: 'assets/fonts/Mayan.ttf', weight: '400', style: 'normal' },
  { family: 'Minecraft PE',       source: 'assets/fonts/MINECRAFT PE.ttf', weight: '400', style: 'normal' },
  { family: 'Nasalization',       source: 'assets/fonts/Nasalization Rg.otf', weight: '400', style: 'normal' },
  { family: 'Norse',              source: 'assets/fonts/Norse.otf', weight: '400', style: 'normal' },
  { family: 'Ruritania',          source: 'assets/fonts/Ruritania.ttf', weight: '400', style: 'normal' },
  { family: 'Saluki Juice',       source: 'assets/fonts/SalukiJuice_PERSONAL_USE_ONLY.otf', weight: '400', style: 'normal' },
  { family: 'Searle',             source: 'assets/fonts/Searle.ttf', weight: '400', style: 'normal' },
  { family: 'Shanghai',           source: 'assets/fonts/shanghai.ttf', weight: '400', style: 'normal' },
  { family: 'Shizuoka Cyberpunk', source: 'assets/fonts/Shizuoka Cyberpunk.otf', weight: '400', style: 'normal' },
  { family: 'Slacker Devil',      source: 'assets/fonts/SlackerDevil.ttf', weight: '400', style: 'normal' },
  { family: 'Smashed Graffiti',   source: 'assets/fonts/SmashedGraffiti.otf', weight: '400', style: 'normal' },
  { family: 'Tempting',           source: 'assets/fonts/Tempting - PERSONAL USE ONLY.ttf', weight: '400', style: 'normal' },
  { family: 'Vengeance at Sea',   source: 'assets/fonts/Vengeance at Sea.otf', weight: '400', style: 'normal' },
];

function fontFormatFromPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }[ext] || 'truetype';
}

// Erzeugt @font-face-Regeln aus CUSTOM_FONT_FILES — einmalig beim Laden.
function injectCustomFontFaces() {
  if (!CUSTOM_FONT_FILES.length) return;
  const css = CUSTOM_FONT_FILES.map(f => `
@font-face {
  font-family: "${f.family}";
  src: url("${f.source}") format("${fontFormatFromPath(f.source)}");
  font-weight: ${f.weight || '400'};
  font-style: ${f.style || 'normal'};
  font-display: swap;
}`).join('\n');
  const styleEl = document.createElement('style');
  styleEl.id = 'core-custom-fonts';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // GEFUNDENE URSACHE für "Vorschau zeigt trotzdem die Standardschrift":
  // @font-face allein lädt eine Schriftdatei erst "lazy" beim ersten
  // tatsächlichen Rendern mit dieser font-family (Browser-Standard-
  // verhalten) — und der Theme-Editor ist für die meisten der hier
  // registrierten Fonts die allererste Stelle im ganzen Projekt, die sie
  // überhaupt referenziert. Öffnet man das Panel, bevor der Ladevorgang
  // abgeschlossen ist, zeigt font-display:swap kurzzeitig noch die
  // Fallback-Schrift. Deshalb hier über die Font Loading API sofort beim
  // Start aktiv anstoßen (nicht erst warten, bis der Editor geöffnet
  // wird) — dadurch sind die Fonts längst bereit, bis der Nutzer die
  // Auswahl je aufklappt. Reine Ladevorschrift, ändert nichts an Auswahl,
  // Speicherung oder Anwendung der Schrift.
  if (window.FontFace && document.fonts && document.fonts.load) {
    const seen = new Set();
    CUSTOM_FONT_FILES.forEach(f => {
      if (seen.has(f.family)) return;
      seen.add(f.family);
      document.fonts.load(`16px "${f.family}"`).catch(() => {});
    });
  }
}

// Baut die Schriftart-Auswahl im Theme-Builder als eigenes Dropdown auf
// (bewusst KEIN natives <select>/<option> — Browser stellen font-family
// auf <option> nicht zuverlässig dar, gerade im geschlossenen Zustand).
// #theme-builder-font (hidden input) hält weiterhin den Font-Stack-String
// als Wert, damit saveThemeBuilder()/applyThemeTemplate() unverändert
// funktionieren — nur die Anzeige ist neu. `currentStack` wählt vor.
function renderFontSelect(currentStack) {
  const hiddenInput = document.getElementById('theme-builder-font');
  const panel = document.getElementById('theme-builder-font-panel');
  if (!hiddenInput || !panel) return;
  if (!currentStack) currentStack = hiddenInput.value || DEFAULT_FONT_STACK;
  panel.innerHTML = '';

  const addGroup = (label, fonts) => {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'tb-font-group-label';
    groupLabel.textContent = label;
    panel.appendChild(groupLabel);
    fonts.forEach(f => {
      const opt = document.createElement('div');
      opt.className = 'tb-font-option' + (f.stack === currentStack ? ' active' : '');
      opt.textContent = f.label;
      opt.style.fontFamily = f.stack;
      opt.dataset.stack = f.stack;
      opt.addEventListener('click', () => selectThemeFont(f.stack));
      panel.appendChild(opt);
    });
  };

  FONT_CATEGORIES.forEach(cat => addGroup(cat.label, cat.fonts));

  if (CUSTOM_FONT_FILES.length) {
    // Eine Zeile je Familie (nicht je Dateischnitt) — style/weight regelt
    // der Browser über die passende @font-face-Regel automatisch.
    const seen = new Set();
    const customFonts = [];
    CUSTOM_FONT_FILES.forEach(f => {
      if (seen.has(f.family)) return;
      seen.add(f.family);
      customFonts.push({ label: f.family, stack: `"${f.family}"` });
    });
    addGroup('Eigene Fonts', customFonts);
  }

  hiddenInput.value = currentStack;
  syncThemeFontTrigger();
}

// Klick auf eine Zeile im Panel: Wert übernehmen, Panel schließen, Trigger
// + Vorschau aktualisieren.
function selectThemeFont(stack) {
  const hiddenInput = document.getElementById('theme-builder-font');
  const panel = document.getElementById('theme-builder-font-panel');
  hiddenInput.value = stack;
  panel.querySelectorAll('.tb-font-option').forEach(el => {
    el.classList.toggle('active', el.dataset.stack === stack);
  });
  panel.classList.add('hidden');
  syncThemeFontTrigger();
}

// Zeigt den aktuell gewählten Font im Trigger-Button — im Namen selbst in
// dessen Schriftart dargestellt — und stößt die Vorschauzeile darunter an.
function syncThemeFontTrigger() {
  const hiddenInput = document.getElementById('theme-builder-font');
  const triggerLabel = document.getElementById('theme-builder-font-trigger-label');
  const trigger = document.getElementById('theme-builder-font-trigger');
  if (!hiddenInput || !triggerLabel || !trigger) return;
  const stack = hiddenInput.value || DEFAULT_FONT_STACK;
  const activeOpt = document.querySelector(`#theme-builder-font-panel .tb-font-option[data-stack="${CSS.escape(stack)}"]`);
  triggerLabel.textContent = activeOpt ? activeOpt.textContent : stack;
  trigger.style.fontFamily = stack;
  updateThemeBuilderFontPreview();
}

function updateThemeBuilderFontPreview() {
  const hiddenInput = document.getElementById('theme-builder-font');
  const preview = document.getElementById('theme-builder-font-preview');
  if (!hiddenInput || !preview) return;
  preview.style.fontFamily = hiddenInput.value || DEFAULT_FONT_STACK;
}

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
// GEFUNDENE URSACHE (Font-Vererbung griff trotz korrektem deriveThemeVars()
// nicht überall): ct.vars ist eine zum Speicherzeitpunkt eingefrorene
// Momentaufnahme (saveThemeBuilder() schreibt sie einmalig weg). Jedes
// bereits vorhandene eigene Theme wurde gespeichert, BEVOR --mono/
// --core-font-scale zu deriveThemeVars() hinzukamen — dessen ct.vars
// enthält diese Schlüssel schlicht nicht, Object.entries(ct.vars) kann sie
// also nie setzen. --mono blieb dadurch beim :root-Standard (DM Mono),
// unabhängig von der im Editor gewählten Schrift — genau das erklärt KW,
// Datum, Finanzzahlen, Scores, Timer, Block-Zeiten, Positivity-Zähler usw.
// Deshalb hier NICHT mehr die eingefrorene ct.vars anwenden, sondern bei
// jedem Aktivieren live aus den Rohdaten (coreColors/cardOpacity/fontSize
// — die werden bei jedem Speichern korrekt aktualisiert) neu ableiten.
// Das repariert automatisch auch jedes ältere, nicht neu gespeicherte
// Theme, und verhindert dieselbe Klasse von Bug bei jeder künftigen
// Erweiterung von deriveThemeVars().
function applyCustomThemeVars(id) {
  const ct = getCustomTheme(id);
  if (!ct) return false;
  // Object.assign-Fallback wie in openThemeBuilder() — sehr alte Themes
  // (vor accent/nav/modal/font) kennen manche coreColors-Felder noch
  // nicht; deriveThemeVars() bekäme sonst undefined statt eines Hex-Werts.
  const core = Object.assign({}, DEFAULT_BUILDER_CORE, ct.coreColors);
  const vars = deriveThemeVars(core, ct.cardOpacity ?? 100, ct.fontSize ?? 100);
  document.documentElement.setAttribute('data-theme', id);
  document.documentElement.setAttribute('data-theme-family', ct.family);
  Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  return true;
}

// ── Kalender-Bildthema (Kalender-Hero) ──────────────────────────────────
// Eigene Einstellung pro Theme, NICHT das allgemeine Theme-Hintergrundbild
// (das bleibt ct.bg / applyThemeBackground). Steuert nur, welches Bilder-Set
// der Kalender-Hero für die jeweilige Saison zieht (css/calendar.css:
// [data-cal-image-theme] .cal-hero-<saison>). Eingebaute Themes kennen
// dieses Feld nicht → Fallback 'cozy', identisch zum bisherigen, immer
// fest verdrahteten Verhalten (siehe Punkt 6: kein bestehendes Theme darf
// dadurch kaputtgehen).
function applyCalendarImageTheme(id) {
  const ct = getCustomTheme(id);
  const imageTheme = (ct && ct.calendar && ct.calendar.imageTheme) || 'cozy';
  document.documentElement.setAttribute('data-cal-image-theme', imageTheme);
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
function deriveThemeVars(core, cardOpacityPct, fontSizePct) {
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
    '--font':          core.font || DEFAULT_FONT_STACK,
    // --mono ist die Zahlen-/Zeit-Spur (Uhrzeiten, Daten, Beträge, Scores,
    // Timer, Formeln …) — bekommt hier bewusst dieselbe Schrift wie --font,
    // damit die gewählte Theme-Schrift wirklich überall greift, nicht nur
    // bei "normalem" Text. Echte Code-Darstellung hängt stattdessen an
    // --core-code-font (main.css, von Themes nicht überschrieben).
    '--mono':          core.font || DEFAULT_FONT_STACK,
    '--core-card-opacity': opacity,
    '--core-font-scale': ((fontSizePct || 100) / 100).toFixed(2),
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
let _teBuilderPendingFile = null;   // neu gewählte/aus Vorlage übernommene, noch nicht gespeicherte Datei
let _teBuilderExistingBg  = null;   // bg-Metadaten des bearbeiteten Themes beim Öffnen
let _teBuilderBgCleared   = false;  // Nutzer hat "Entfernen" geklickt

const DEFAULT_BUILDER_CORE = {
  bg: '#1a1815', surface: '#252119', nav: '#20201e', modal: '#252119',
  text: '#ede6d8', border: '#f0dcb4', accent: '#728460', font: DEFAULT_FONT_STACK,
};

function openThemeBuilder(editId) {
  _teBuilderEditId = editId || null;
  const existing = editId ? getCustomTheme(editId) : null;
  // Fallbacks für Themes, die noch mit einem älteren Builder erstellt
  // wurden — deren coreColors kennt manche Felder (u.a. font) noch nicht.
  const core = Object.assign({}, DEFAULT_BUILDER_CORE, existing && existing.coreColors);
  const cardOpacity = existing ? (existing.cardOpacity ?? 100) : 100;
  const fontSize = existing ? (existing.fontSize ?? 100) : 100;

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
  document.getElementById('theme-builder-fontsize').value = fontSize;
  document.getElementById('theme-builder-fontsize-label').textContent = fontSize + '%';
  document.getElementById('theme-builder-delete').style.display = existing ? '' : 'none';
  document.getElementById('theme-builder-calendar-image').value = (existing && existing.calendar && existing.calendar.imageTheme) || 'cozy';
  renderFontSelect(core.font);

  _teBuilderPendingFile = null;
  _teBuilderExistingBg = existing ? (existing.bg || null) : null;
  _teBuilderBgCleared = false;
  syncThemeBuilderBgUI();

  renderThemeTemplateStrip();
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
  const fontSize = document.getElementById('theme-builder-fontsize').value;
  document.getElementById('theme-builder-opacity-label').textContent = opacity + '%';
  document.getElementById('theme-builder-fontsize-label').textContent = fontSize + '%';
  const preview = document.getElementById('theme-builder-preview');
  if (!preview) return;
  preview.style.background = `color-mix(in srgb, ${surface} ${opacity}%, transparent)`;
  preview.style.color = text;
  preview.style.borderColor = hexToRgba(border, 0.35);
  preview.style.fontSize = (15 * fontSize / 100).toFixed(1) + 'px';
}

// ── "Vorlage"-Leiste im Theme-Editor ─────────────────────────────────────
// Reine Formular-Vorbelegung aus bereits vorhandenen Themes (eingebaut +
// eigen) — kein separates Verwaltungssystem, keine neue Theme-ID, nichts
// wird angelegt/verändert. Wird bei jedem Öffnen des Editors neu aus den
// aktuellen Datenquellen (THEME_REGISTRY, customThemes) aufgebaut, damit
// ein zuletzt gespeichertes Theme beim nächsten Öffnen ebenfalls auftaucht.
function renderThemeTemplateStrip() {
  const row = document.getElementById('theme-builder-template-row');
  if (!row) return;
  row.innerHTML = '';

  const templates = THEME_REGISTRY
    .map(reg => ({ name: reg.label, core: reg.core, cardOpacity: 100, fontSize: 100, bg: themeBackgrounds[reg.id] || null, calendarImageTheme: 'cozy' }))
    .concat(customThemes.map(ct => ({
      name: ct.name,
      core: Object.assign({}, DEFAULT_BUILDER_CORE, ct.coreColors),
      cardOpacity: ct.cardOpacity ?? 100,
      fontSize: ct.fontSize ?? 100,
      bg: ct.bg || null,
      calendarImageTheme: (ct.calendar && ct.calendar.imageTheme) || 'cozy',
    })));

  templates.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clock-type-btn';
    btn.textContent = t.name;
    btn.addEventListener('click', () => applyThemeTemplate(t));
    row.appendChild(btn);
  });
}

// Übernimmt die Werte einer Vorlage (siehe renderThemeTemplateStrip()) in
// die gerade offenen Editor-Felder. Ändert NICHT den Theme-Namen — der
// Nutzer vergibt weiterhin selbst einen Namen — und legt nichts an; erst
// der normale "Speichern"-Klick erzeugt/ändert ein Theme, unverändert über
// dieselbe _teBuilderEditId-Logik wie zuvor. Das Ausgangstheme bleibt
// dadurch in jedem Fall unangetastet.
function applyThemeTemplate(t) {
  document.getElementById('theme-builder-bg').value = t.core.bg;
  document.getElementById('theme-builder-surface').value = t.core.surface;
  document.getElementById('theme-builder-nav').value = t.core.nav;
  document.getElementById('theme-builder-modal').value = t.core.modal;
  document.getElementById('theme-builder-text').value = t.core.text;
  document.getElementById('theme-builder-border').value = t.core.border;
  document.getElementById('theme-builder-accent').value = t.core.accent;
  document.getElementById('theme-builder-opacity').value = t.cardOpacity;
  document.getElementById('theme-builder-fontsize').value = t.fontSize;
  document.getElementById('theme-builder-calendar-image').value = t.calendarImageTheme || 'cozy';
  renderFontSelect(t.core.font || DEFAULT_FONT_STACK);

  // Hintergrundbild der Vorlage übernehmen — läuft über denselben Weg wie
  // eine manuell gewählte Datei (_teBuilderPendingFile), dadurch erzeugt
  // resolveThemeBuilderBg() beim Speichern automatisch einen eigenen,
  // unabhängigen IndexedDB-Eintrag statt eine Referenz zu teilen.
  _teBuilderPendingFile = null;
  _teBuilderExistingBg = null;
  _teBuilderBgCleared = false;
  if (t.bg && t.bg.assetId && t.bg.enabled !== false) {
    getBackgroundAsset(t.bg.assetId).then(blob => {
      if (!blob) return;
      _teBuilderPendingFile = new File([blob], t.bg.name || 'hintergrund.jpg', { type: blob.type });
      syncThemeBuilderBgUI();
    }).catch(() => {});
  }

  syncThemeBuilderBgUI();
  updateThemeBuilderPreview();
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
    font:    document.getElementById('theme-builder-font').value,
  };
  const cardOpacity = parseInt(document.getElementById('theme-builder-opacity').value, 10);
  const fontSize = parseInt(document.getElementById('theme-builder-fontsize').value, 10);
  const calendar = { imageTheme: document.getElementById('theme-builder-calendar-image').value };
  const vars = deriveThemeVars(core, cardOpacity, fontSize);
  const family = teLuminance(core.bg) < 128 ? 'dark' : 'light';
  const editId = _teBuilderEditId;

  resolveThemeBuilderBg().then(bg => {
    if (editId) {
      const ct = getCustomTheme(editId);
      if (ct) {
        ct.name = name; ct.coreColors = core; ct.vars = vars; ct.family = family;
        ct.cardOpacity = cardOpacity; ct.fontSize = fontSize; ct.bg = bg; ct.calendar = calendar;
        saveCustomThemes();
        if (theme === ct.id) setTheme(ct.id); // sofort neu anwenden, falls gerade aktiv
      }
    } else {
      const id = 'custom_' + Date.now();
      customThemes.push({ id, name, family, coreColors: core, vars, cardOpacity, fontSize, bg, calendar });
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
applyCalendarImageTheme(theme);

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
  document.getElementById('theme-builder-fontsize').addEventListener('input', updateThemeBuilderPreview);
  document.getElementById('theme-builder-modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'theme-builder-modal-overlay') closeThemeBuilder();
  });

  // Schriftart-Dropdown öffnen/schließen — gleiches Muster wie
  // #forest-filter-panel (js/forest.js): Trigger togglet, Klick
  // außerhalb schließt.
  document.getElementById('theme-builder-font-trigger').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('theme-builder-font-panel').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    const panel = document.getElementById('theme-builder-font-panel');
    const trigger = document.getElementById('theme-builder-font-trigger');
    if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
}
injectCustomFontFaces();
injectThemeBuilderListeners();
initThemeBuilderBgControls();
initThemeBgControls();
