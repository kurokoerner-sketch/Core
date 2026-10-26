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

// ── Eingebaute reine CSS-Themes (Light/Classic Dark): Anzeige-Metadaten,
//    NICHT die CSS-Kaskade selbst (die bleibt vollständig in main.css).
//    `core` dupliziert absichtlich die literalen Werte aus main.css (:root +
//    [data-theme="x"]) — nötig, weil diese beiden Themes reines CSS sind
//    und kein JS-Objekt haben, aus dem sich Werte für die Vorlagen-Leiste
//    im Theme-Editor lesen ließen. Die sieben grafischen Standardvorlagen
//    (Cozy…Zombie) stehen NICHT mehr hier — sie besitzen über
//    BUILTIN_DESIGN_THEMES bereits ein vollständiges Objekt (inkl. Font/
//    Transparenz/Grafiken, nicht nur Farben); renderThemeTemplateStrip()
//    liest sie von dort, um Farb-Dopplung und Drift zwischen zwei Quellen
//    zu vermeiden.
const THEME_REGISTRY = [
  { id: 'light', label: 'Light',        core: { bg: '#EFEBe3', surface: '#FDFAF5', nav: '#FDFAF5', modal: '#FDFAF5', text: '#24211C', border: '#786541', accent: '#6B7F58' } },
  { id: 'dark',  label: 'Classic Dark', core: { bg: '#181817', surface: '#20201e', nav: '#20201e', modal: '#20201e', text: '#e6e3df', border: '#CBC8C2', accent: '#728460' } },
];

// Tokens, die ein eigenes Theme inline überschreibt. --dash-bg/-border
// gehören bewusst NICHT dazu (main.css: .dash-content & Co. haben keinen
// Hintergrund mehr) — Sage-Familie, Navigation, Modal und Schriftart sind
// einstellbar. Prio-/Budget-/Code-Panel-Farben bleiben bewusst invariant
// (main.css-Kommentar) und sind hier nicht enthalten.
const CUSTOM_THEME_VARS = [
  '--bg', '--bg-2', '--surface', '--surface-2', '--surface-3', '--surface-solid',
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
  { family: 'Shock Rumble',       source: 'assets/fonts/Shock Rumble Demo.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Another Tag',        source: 'assets/fonts/aAnotherTag.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Alice in Wonderland', source: 'assets/fonts/Alice_in_Wonderland_3.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Ancient Greek',      source: 'assets/fonts/Ancient Greek.ttf', weight: '400', style: 'normal' },
  { family: 'Bing Boss',          source: 'assets/fonts/Bing Boss.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Black North',        source: 'assets/fonts/Black North.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Blade Knight',       source: 'assets/fonts/Blade Knight Regular.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Celtic Garamond',    source: 'assets/fonts/CELTG___.TTF', weight: '400', style: 'normal' },
  { family: "Coraline's Cat",     source: "assets/fonts/Coraline's Cat.ttf", weight: '400', style: 'normal' }, //Free
  { family: 'Cubic',              source: 'assets/fonts/cubic.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Cyber Digital',      source: 'assets/fonts/CyberDigital.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Darling Letter',     source: 'assets/fonts/Darling Letter.otf', weight: '400', style: 'normal' },//Private Use Only
  { family: 'Diogenes',           source: 'assets/fonts/DIOGENES.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Dune Rise',          source: 'assets/fonts/Dune_Rise.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Evanescent',         source: 'assets/fonts/evanescent_p.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Father Galaxy',      source: 'assets/fonts/FatherGalaxy-Regular.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'First Order',        source: 'assets/fonts/firstorder.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Game Of Squids',     source: 'assets/fonts/Game Of Squids.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Gang of Three',      source: 'assets/fonts/go3v2.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Greek Freak',        source: 'assets/fonts/Greek-Freak.ttf', weight: '400', style: 'normal' },//Private Use Only
  { family: 'Harry P',            source: 'assets/fonts/HARRYP__.TTF', weight: '400', style: 'normal' }, //Free
  { family: 'Help Me',            source: 'assets/fonts/HelpMe.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Hoshiko Satsuki',    source: 'assets/fonts/Hoshiko Satsuki.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Impact Label SWL',   source: 'assets/fonts/Impact Label SWL Reversed.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'JMH Typewriter',     source: 'assets/fonts/JMH Typewriter.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Klaxon Crunchy',     source: 'assets/fonts/Klaxon-Crunchy.otf', weight: '400', style: 'normal' }, //Free
  { family: 'Mayan',              source: 'assets/fonts/Mayan.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Minecraft PE',       source: 'assets/fonts/MINECRAFT PE.ttf', weight: '400', style: 'normal' }, //Free 
  { family: 'Norse',              source: 'assets/fonts/Norse.otf', weight: '400', style: 'normal' }, //Free
  { family: 'Ruritania',          source: 'assets/fonts/Ruritania.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Searle',             source: 'assets/fonts/Searle.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Shanghai',           source: 'assets/fonts/shanghai.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Shizuoka Cyberpunk', source: 'assets/fonts/Shizuoka Cyberpunk.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Slacker Devil',      source: 'assets/fonts/SlackerDevil.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Smashed Graffiti',   source: 'assets/fonts/SmashedGraffiti.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Tempting',           source: 'assets/fonts/Tempting - PERSONAL USE ONLY.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Vengeance at Sea',   source: 'assets/fonts/Vengeance at Sea.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'TechnicalStencilVP', source: 'assets/fonts/TechnicalStencilVP.otf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Unown',              source: 'assets/fonts/unown.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Go around the books',source: 'assets/fonts/Go around the books.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'BlackBoard',         source: 'assets/fonts/BlackBoard.ttf', weight: '400', style: 'normal' }, //Private Use Only
  { family: 'Blackwood Castle',   source: 'assets/fonts/Blackwood Castle.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'SAIBA-45',           source: 'assets/fonts/SAIBA-45.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Electroharmonix',    source: 'assets/fonts/Electroharmonix.otf', weight: '400', style: 'normal' }, //Free
  { family: 'Minicomputer Lt',    source: 'assets/fonts/Minicomputer Lt.otf', weight: '400', style: 'normal' }, //Free
  { family: 'Nasalization Rg',    source: 'assets/fonts/Nasalization Rg.otf', weight: '400', style: 'normal' }, //Free
  { family: 'Capture it',         source: 'assets/fonts/Capture it.ttf', weight: '400', style: 'normal' }, //Free
  { family: 'Rafika',             source: 'assets/fonts/Rafika.otf', weight: '400', style: 'normal' }, //Free
  { family: 'Breath of the Wild', source: 'assets/fonts/The Wild Breath of Zelda.otf', weight: '400', style: 'normal' }, //Free
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
// Globale Übersteuerung, welches Grafik-Set der Projekte-Tab verwendet,
// unabhängig vom aktiven Theme — 'auto' (Standard) bedeutet "wie Theme"
// (siehe getActiveProjectGraphics() unten). Gilt themeübergreifend, für
// eingebaute wie eigene Themes.
let projectGraphics = DB.get('projectGraphics', 'auto');

function saveCustomThemes()     { DB.set('customThemes', customThemes); }
function saveThemeBackgrounds() { DB.set('themeBackgrounds', themeBackgrounds); }
function saveProjectGraphics()  { DB.set('projectGraphics', projectGraphics); }

// ── Fest eingebaute grafische Standardvorlagen (Cozy/Space/Forest/Royal/
// Cyberpunk/Laboratory/Zombie) ──────────────────────────────────────────
// Vollständige Designvorlagen, die dieselbe Theme-Engine wie eigene Themen
// nutzen (siehe getCustomTheme() unten) — bewusst NICHT in customThemes[]
// abgelegt, damit sie (a) für jeden Nutzer ohne jede Sicherung/jeden Import
// sofort verfügbar sind, (b) nicht über die normale "Löschen"-Funktion
// verschwinden können, und (c) niemals mit einem gleichnamigen, selbst
// angelegten Custom-Theme kollidieren — die IDs tragen dafür durchgehend
// das Präfix "builtin_", während eigene Themes immer "custom_<timestamp>"
// lauten (siehe saveThemeBuilder()). Farben exakt wie vorgegeben, Branding/
// Kalender/Start-Header referenzieren die bereits vorhandenen Einträge in
// BRANDING_THEMES (unten) rein über deren ID-String — keine Abhängigkeit
// von deren Position/Definition nötig. `vars` wird bewusst NICHT mitgeführt
// (siehe applyCustomThemeVars(): die leitet --Variablen seit einem früheren
// Fix ohnehin live aus coreColors/cardOpacity/fontSize ab, nie aus einer
// eingefrorenen vars-Momentaufnahme).
const BUILTIN_DESIGN_THEMES = [
  { id: 'builtin_cozy', name: 'Cozy', family: 'dark',
    coreColors: { bg: '#1D1A15', surface: '#30291F', nav: '#272219', modal: '#342C21', text: '#F0E5D2', border: '#A58A64', accent: '#78835C', font: '"Darling Letter"' },
    cardOpacity: 90, fontSize: 125,
    bg: { source: 'cozy', size: 'cover', dim: 30 },
    calendar: { imageTheme: 'cozy' }, startHeader: { banner: 'cozy' },
    branding: { theme: 'cozy', useLogo: true }, graphics: { mode: 'theme', theme: 'cozy' },
    projects: { imageTheme: 'cozy' } },
  { id: 'builtin_space', name: 'Space', family: 'dark',
    coreColors: { bg: '#07101B', surface: '#0C1928', nav: '#091522', modal: '#101E2E', text: '#DCE9F3', border: '#547896', accent: '#397FB5', font: "'Orbitron', sans-serif" },
    cardOpacity: 90, fontSize: 100,
    bg: { source: 'scifi', size: 'cover', dim: 30 },
    calendar: { imageTheme: 'scifi' }, startHeader: { banner: 'scifi' },
    branding: { theme: 'scifi', useLogo: true }, graphics: { mode: 'theme', theme: 'scifi' } },
  { id: 'builtin_forest', name: 'Forest', family: 'dark',
    coreColors: { bg: '#101511', surface: '#1B231B', nav: '#161D17', modal: '#202920', text: '#DDD9C7', border: '#66745D', accent: '#71845A', font: "'Cinzel', serif" },
    cardOpacity: 85, fontSize: 105,
    bg: { source: 'forest', size: 'cover', dim: 45 },
    calendar: { imageTheme: 'forest' }, startHeader: { banner: 'forest' },
    branding: { theme: 'forest', useLogo: true }, graphics: { mode: 'theme', theme: 'forest' },
    projects: { imageTheme: 'forest' } },
  { id: 'builtin_royal', name: 'Royal', family: 'dark',
    coreColors: { bg: '#180D0B', surface: '#291512', nav: '#21100E', modal: '#301815', text: '#E9DCC5', border: '#947354', accent: '#9A7650', font: '"Blackwood Castle"' },
    cardOpacity: 85, fontSize: 125,
    bg: { source: 'royal', size: 'cover', dim: 40 },
    calendar: { imageTheme: 'royal' }, startHeader: { banner: 'royal' },
    branding: { theme: 'royal', useLogo: true }, graphics: { mode: 'theme', theme: 'royal' } },
  { id: 'builtin_cyberpunk', name: 'Cyberpunk', family: 'dark',
    coreColors: { bg: '#080A13', surface: '#111323', nav: '#0C0E19', modal: '#15172A', text: '#E5E2F2', border: '#55456E', accent: '#B92DAF', font: '"Shizuoka Cyberpunk"' },
    cardOpacity: 85, fontSize: 105,
    bg: { source: 'cyberpunk', size: 'cover', dim: 40 },
    calendar: { imageTheme: 'cyberpunk' }, startHeader: { banner: 'cyberpunk' },
    branding: { theme: 'cyberpunk', useLogo: true }, graphics: { mode: 'theme', theme: 'cyberpunk' } },
  { id: 'builtin_lab', name: 'Laboratory', family: 'dark',
    coreColors: { bg: '#0E1211', surface: '#181D1B', nav: '#121715', modal: '#1C2220', text: '#D8DBD5', border: '#53635C', accent: '#477867', font: '"TechnicalStencilVP"' },
    cardOpacity: 85, fontSize: 140,
    bg: { source: 'lab', size: 'cover', dim: 40 },
    calendar: { imageTheme: 'lab' }, startHeader: { banner: 'lab' },
    branding: { theme: 'lab', useLogo: true }, graphics: { mode: 'theme', theme: 'lab' } },
  { id: 'builtin_zombie', name: 'Zombie', family: 'dark',
    coreColors: { bg: '#141310', surface: '#211F1A', nav: '#191814', modal: '#27241E', text: '#DDD8CB', border: '#665E50', accent: '#756F4D', font: '"Capture it"' },
    cardOpacity: 85, fontSize: 100,
    bg: { source: 'zombie', size: 'cover', dim: 30 },
    calendar: { imageTheme: 'zombie' }, startHeader: { banner: 'zombie' },
    branding: { theme: 'zombie', useLogo: true }, graphics: { mode: 'theme', theme: 'zombie' } },
];

// Eingebaute Standardvorlagen sind unveränderbar — kein Override-/Patch-
// Mechanismus mehr (eine frühere Fassung erlaubte das versehentlich; siehe
// die harten Sperren in openThemeBuilder()/saveThemeBuilder()/
// deleteCustomTheme() unten). getBuiltinDesignTheme() liefert deshalb immer
// exakt die feste Definition aus BUILTIN_DESIGN_THEMES zurück.
function getBuiltinDesignTheme(id) { return BUILTIN_DESIGN_THEMES.find(t => t.id === id) || null; }

// Sucht zuerst unter den echten eigenen Themes, dann unter den eingebauten
// Standardvorlagen — beide laufen für jeden Aufrufer (setTheme(),
// applyThemeBackground(), applyCalendarImageTheme(), applyStartHeaderTheme(),
// applyBranding() …) über denselben, bereits vorhandenen Pfad. Fürs Lesen/
// Anwenden macht das keinen Unterschied zwischen Standard- und Custom-
// Theme — die Schreibpfade (s.u.) unterscheiden sehr wohl und verweigern
// bei einer Standardvorlage jede Änderung.
function getCustomTheme(id)  { return customThemes.find(t => t.id === id) || getBuiltinDesignTheme(id); }
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
// override (optional): explizit übergebener Wert statt aus ct gelesen —
// von previewGraphicsLive() genutzt, um den noch ungespeicherten Formular-
// wert des Theme-Editors live auf der echten Seite zu zeigen, ohne die
// gespeicherten ct-Daten anzufassen. Alle bisherigen Aufrufe (main.js,
// Init unten) übergeben kein override und verhalten sich unverändert.
function applyCalendarImageTheme(id, override) {
  const ct = getCustomTheme(id);
  const imageTheme = override !== undefined ? override : ((ct && ct.calendar && ct.calendar.imageTheme) || 'cozy');
  document.documentElement.setAttribute('data-cal-image-theme', imageTheme);
}

// ── Start-Header-Bildthema (Startseiten-Banner) ─────────────────────────
// Gleiches Muster wie applyCalendarImageTheme() oben, komplett unabhängig
// davon (eigenes Attribut, eigenes ThemeConfig-Feld) UND unabhängig vom
// allgemeinen Theme-Hintergrundbild (ct.bg / applyThemeBackground). Steuert
// nur die Bildquelle von #today-main-header (css/today.css:
// [data-start-header-theme] #today-main-header). Fallback 'scifi': vor
// Einführung dieser Einstellung war das Sci-Fi-Start-Banner für ALLE
// Themes (eingebaut wie eigen) fest verdrahtet — das bleibt für Themes
// ohne gespeicherten Wert unverändert (Punkt 10: kein bestehendes
// Verhalten darf sich durch die neue Einstellung ändern).
// override: siehe applyCalendarImageTheme() oben — dasselbe Prinzip.
function applyStartHeaderTheme(id, override) {
  const ct = getCustomTheme(id);
  const banner = override !== undefined ? override : ((ct && ct.startHeader && ct.startHeader.banner) || 'scifi');
  document.documentElement.setAttribute('data-start-header-theme', banner);
}

// ── Projekt-Grafiken (Projektwald + Detailbaum) ─────────────────────────
// Anders als Kalender/Start-Header gibt es hier kein CSS-Attribut, das die
// Bildauswahl automatisch trägt — der Projekte-Tab wird komplett aus JS
// gerendert (js/forest.js, js/project-tree.js), deshalb liefert diese
// Funktion direkt das zu verwendende `projects`-Objekt aus BRANDING_THEMES
// zurück, statt (wie applyCalendarImageTheme) nur ein Attribut zu setzen.
// Reihenfolge der Auflösung (Punkt 2 des Auftrags):
//   1. globale Einstellung "Projekt-Grafiken" (projectGraphics), wenn nicht 'auto'
//   2. sonst ct.projects.imageTheme des aktiven Themes
//   3. sonst 'cozy' (bisheriges, einziges Verhalten vor dieser Funktion —
//      ändert sich für niemanden, der die neue Einstellung nie anfasst)
// Ein Theme ohne eigene Projektgrafiken (kein `projects`-Feld in seinem
// BRANDING_THEMES-Eintrag) fällt an jeder Stelle hier auf Cozy zurück,
// nie auf irgendein anderes Theme — kein stiller Fallback auf ein
// falsches Grafik-Set.
let _projectGraphicsPreviewOverride = null; // nur während Live-Vorschau im Theme-Editor (previewGraphicsLive())

function getActiveProjectGraphics() {
  const cozyProjects = findBrandingTheme('cozy').projects;
  if (_projectGraphicsPreviewOverride !== null) {
    const bt = findBrandingTheme(_projectGraphicsPreviewOverride);
    return (bt && bt.projects) || cozyProjects;
  }
  const globalSetting = typeof projectGraphics !== 'undefined' ? projectGraphics : 'auto';
  if (globalSetting && globalSetting !== 'auto') {
    const bt = findBrandingTheme(globalSetting);
    if (bt && bt.projects) return bt.projects;
  }
  const ct = getCustomTheme(theme);
  const imageTheme = (ct && ct.projects && ct.projects.imageTheme) || 'cozy';
  const bt = findBrandingTheme(imageTheme);
  return (bt && bt.projects) || cozyProjects;
}

// Rendert den Projekte-Tab neu, falls er gerade tatsächlich angezeigt wird
// (Theme-Wechsel/Einstellungsänderung sollen ihn nicht unnötig im
// Hintergrund neu aufbauen) — von setTheme() (main.js, typeof-Guard) und
// vom Einstellungs-Klick sowie der Live-Vorschau im Theme-Editor aufgerufen.
function refreshProjectGraphics() {
  if (typeof currentView === 'undefined' || currentView !== 'projects') return;
  if (typeof currentDetailProject !== 'undefined' && currentDetailProject) {
    if (typeof renderProjectDetail === 'function') renderProjectDetail();
    return;
  }
  const wrap = document.getElementById('project-forest-wrap');
  if (wrap && wrap.style.display !== 'none' && typeof renderForest === 'function') renderForest();
}

// ── Taskbar-/Favicon-Branding ("Logo & Icon") ───────────────────────────
// Zwei unabhängige, pro Theme gespeicherte Werte (ct.branding):
//   - theme:   welches Branding-Theme liefert Icon+Logo (Registry unten,
//              KEINE Kopplung an das aktive UI-Theme/an Kalender/
//              Start-Header — eigene, freie Auswahl).
//   - useLogo: false = Icon in der Taskbar, true = Logo in der Taskbar
//              (steht dann allein, ohne Text daneben). Das Favicon
//              verwendet IMMER das Icon des gewählten Branding-Themes,
//              unabhängig von useLogo.
// BRANDING_THEMES ist die einzige Stelle, die für ein künftiges weiteres
// Theme (eigenes Icon+Logo) erweitert werden muss — kein if/else pro
// Theme-Name im restlichen Code. Fallback (fehlendes/altes ct.branding
// ohne diese Felder, oder eingebaute Themes ohne ct): erster Registry-
// Eintrag + useLogo aus, damit ein Reload ohne gespeicherten Wert immer
// ein definiertes Icon zeigt statt eines kaputten Favicons.
// "background" wird zusätzlich vom Hintergrund-Dropdown (weiter unten,
// renderBackgroundSourceSelect()/applyThemeBackground()) genutzt — dieselbe
// Registry für alle drei Theme-Asset-Arten (Icon/Logo/Hintergrund), damit
// ein künftiges neues Theme an nur EINER Stelle ergänzt werden muss.
// calendar/startHeader sind hier nur für die Dropdown-Verfügbarkeit
// hinterlegt (renderCalendarThemeSelect()/renderStartHeaderThemeSelect()
// unten blenden ein Theme ohne diese Felder automatisch aus, statt einen
// kaputten Pfad zu zeigen) — die tatsächliche Bildauswahl für Kalender/
// Start-Header läuft weiterhin rein über CSS-Attributselektoren
// (css/calendar.css [data-cal-image-theme], css/today.css
// [data-start-header-theme]), exakt wie bei Cozy/Sci-Fi schon bisher.
// `projects` (optional): Grafik-Set für den Projekte-Tab (Projektwald +
// Detailbaum, siehe js/project-tree.js/js/forest.js und
// getActiveProjectGraphics() unten). Nur Themes mit eigenen Projektbäumen
// tragen dieses Feld ein — ein Theme ohne `projects` fällt automatisch auf
// Cozy zurück (siehe getActiveProjectGraphics()), taucht deshalb auch nicht
// in renderProjectsThemeSelect()/der "Projekt-Grafiken"-Einstellung auf.
//   treeCount:   Anzahl vorhandener Baumvarianten (Speicherbereich bleibt
//                bei allen Themes 1..TREE_PNG_COUNT, siehe project-tree.js —
//                nur die ANZEIGE wird auf treeCount abgebildet).
//   treePrefix:  gemeinsamer Pfad-Anfang; voller Pfad = `${treePrefix}${n}${doneSuffix wenn abgeschlossen}.png`.
//   doneSuffix:  Namensanhang für ein abgeschlossenes/archiviertes Projekt.
//   mainDecor:   Deko für erledigte KERN-/Hauptaufgaben (isExtra:false).
//   extraDecor:  Deko für erledigte EXTRA-Aufgaben (isExtra:true).
//   ellipse je Deko-Typ: Streubereich in % der Baumbildfläche, siehe
//     generateCanopySlots() in project-tree.js — Cozy nutzt eine Ellipse in
//     der Krone für beide; Forest nutzt für die Feen (Kern) eine schmalere/
//     höhere Kronen-Ellipse (Nadelbäume sind schmaler als Cozys Laubbäume)
//     und für die Pilzwesen (Extra) eine flache Ellipse am Stammfuß.
const BRANDING_THEMES = [
  { id: 'cozy',  label: 'Cozy',   icon: "assets/cozy/cozy icon.svg",            iconType: 'image/svg+xml', logo: "assets/cozy/cozy logo.png",            background: "assets/cozy/cozy background.png",
    calendar: { spring: "assets/cozy/cozy spring.png", summer: "assets/cozy/cozy summer.png", fall: "assets/cozy/cozy fall.png", winter: "assets/cozy/cozy winter.png" },
    startHeader: { day: "assets/cozy/cozy start banner day.png", night: "assets/cozy/cozy start banner night.png" },
    projects: {
      setId: 'cozy',
      background: "assets/cozy/cozy prj forest.png",
      treeCount: 5, treePrefix: "assets/cozy/cozy prj tree_", doneSuffix: "_fall",
      mainDecor:  { src: "assets/cozy/cozy prj apple.png",  alt: "Apfel",       cls: 'pdt-tree-decor-apple',  ellipse: { cx: 50, cy: 34, rx: 38, ry: 28 } },
      extraDecor: { src: "assets/cozy/cozy prj flower.png", alt: "Apfelblüte", cls: 'pdt-tree-decor-flower', ellipse: { cx: 50, cy: 34, rx: 38, ry: 28 } },
    } },
  { id: 'scifi', label: 'Sci-Fi', icon: "assets/images sci-fi/sci-fi icon.png", iconType: 'image/png',      logo: "assets/images sci-fi/sci-fi logo.png", background: "assets/images sci-fi/sci-fi background.png",
    calendar: { spring: "assets/images sci-fi/sci-fi spring.png", summer: "assets/images sci-fi/sci-fi summer.png", fall: "assets/images sci-fi/sci-fi fall.png", winter: "assets/images sci-fi/sci-fi winter.png" },
    startHeader: { day: "assets/images sci-fi/sci-fi start banner day.png", night: "assets/images sci-fi/sci-fi start banner night.png" } },
  { id: 'forest', label: 'Forest', icon: "assets/forest/forest icon.png", iconType: 'image/png', logo: "assets/forest/forest logo.png", background: "assets/forest/forest background.png",
    calendar: { spring: "assets/forest/forest spring.png", summer: "assets/forest/forest summer.png", fall: "assets/forest/forest fall.png", winter: "assets/forest/forest winter.png" },
    startHeader: { day: "assets/forest/forest start banner day.png", night: "assets/forest/forest start banner night.png" },
    projects: {
      setId: 'forest',
      background: "assets/forest/forest prj forest.png",
      treeCount: 3, treePrefix: "assets/forest/forest prj tree_", doneSuffix: "_done",
      // Ellipse etwas enger als zuvor (rx/ry reduziert) — die Feen sind jetzt
      // größer (~1.5×, siehe .pdt-tree-decor-fairy in css/project-tree.css),
      // der Streubereich wird deshalb verkleinert, damit der äußerste Rand
      // (Ellipsenradius + halbe Bildbreite) nicht über die Baumkrone
      // hinausreicht.
      mainDecor:  { src: "assets/forest/forest prj fairy.png",    alt: "Fee",       cls: 'pdt-tree-decor-fairy',    ellipse: { cx: 50, cy: 36, rx: 17, ry: 22 } },
      // Boden-Ellipse etwas breiter (rx 26→32) — die größeren Pilzwesen
      // würden sich sonst bei mehreren erledigten Extraaufgaben stärker
      // überdecken.
      extraDecor: { src: "assets/forest/forest prj mushroom.png", alt: "Pilzwesen", cls: 'pdt-tree-decor-mushroom', ellipse: { cx: 50, cy: 88, rx: 32, ry: 6 } },
    } },
  { id: 'royal', label: 'Royal', icon: "assets/royal/royal icon.png", iconType: 'image/png', logo: "assets/royal/royal logo.png", background: "assets/royal/royal background.png",
    calendar: { spring: "assets/royal/royal spring.png", summer: "assets/royal/royal summer.png", fall: "assets/royal/royal fall.png", winter: "assets/royal/royal winter.png" },
    startHeader: { day: "assets/royal/royal start banner day.png", night: "assets/royal/royal start banner night.png" } },
  { id: 'cyberpunk', label: 'Cyberpunk', icon: "assets/cyber-punk/cyber-punk icon.png", iconType: 'image/png', logo: "assets/cyber-punk/cyber-punk logo.png", background: "assets/cyber-punk/cyber-punk background.png",
    calendar: { spring: "assets/cyber-punk/cyber-punk spring.png", summer: "assets/cyber-punk/cyber-punk summer.png", fall: "assets/cyber-punk/cyber-punk fall.png", winter: "assets/cyber-punk/cyber-punk winter.png" },
    startHeader: { day: "assets/cyber-punk/cyber-punk start banner day.png", night: "assets/cyber-punk/cyber-punk start banner night.png" } },
  { id: 'lab', label: 'Lab', icon: "assets/lab/lab icon.png", iconType: 'image/png', logo: "assets/lab/lab logo.png", background: "assets/lab/lab background.png",
    calendar: { spring: "assets/lab/lab spring.png", summer: "assets/lab/lab summer.png", fall: "assets/lab/lab fall.png", winter: "assets/lab/lab winter.png" },
    startHeader: { day: "assets/lab/lab start banner day.png", night: "assets/lab/lab start banner night.png" } },
  { id: 'zombie', label: 'Zombie', icon: "assets/zombie/zombie icon.png", iconType: 'image/png', logo: "assets/zombie/zombie logo.png", background: "assets/zombie/zombie background.png",
    calendar: { spring: "assets/zombie/zombie spring.png", summer: "assets/zombie/zombie summer.png", fall: "assets/zombie/zombie fall.png", winter: "assets/zombie/zombie winter.png" },
    startHeader: { day: "assets/zombie/zombie day.png", night: "assets/zombie/zombie night.png" } },
  // "Kein Theme" — bewusst als Registry-Eintrag OHNE icon/logo/background/
  // calendar/startHeader, ganz am Ende (NICHT an Index 0 — mehrere Stellen
  // im Code nutzen BRANDING_THEMES[0] als sicheren Standard-Theme-
  // Fallback, siehe applyBranding()/openThemeBuilder() etc., und dürften
  // dadurch nie "Kein Theme" als Default bekommen). Weil renderCalendar-
  // ThemeSelect()/renderStartHeaderThemeSelect()/renderBackgroundSource-
  // Select() ihre Optionen nach dem jeweiligen Asset-Feld filtern, taucht
  // dieser Eintrag dort automatisch NICHT auf ("Kein Bild"/"Kein Banner"
  // decken das dort bereits ab) — er erscheint nur in den ungefilterten
  // renderBrandingThemeSelect() (Logo & Icon) und renderGraphicsThemeSelect()
  // (gemeinsames "Theme auswählen"), wo er tatsächlich gebraucht wird.
  { id: 'none', label: 'Kein Theme' },
];

// Neutrales, bereits vorhandenes CORE-Icon (nicht theme-spezifisch) für
// Favicon + Taskbar, solange Logo & Icon auf "Kein Theme" steht — verhindert
// einen kaputten Asset-Pfad, ohne ungefragt auf Cozy/Sci-Fi/Forest/Royal
// zurückzufallen. Bislang an keiner Stelle im Projekt referenziert.
const NEUTRAL_BRANDING_ICON = "assets/nook_icon.png";

function getBrandingTheme(id) {
  return BRANDING_THEMES.find(b => b.id === id) || BRANDING_THEMES[0];
}

// Strikte Variante ohne Fallback-auf-ersten-Eintrag — für die Hintergrund-
// Auswahl darf ein unbekannter/entfernter Quellenwert nicht stillschweigend
// durch ein anderes Theme-Bild ersetzt werden, sondern muss zu "kein Bild"
// führen (siehe applyThemeBackground() unten).
function findBrandingTheme(id) {
  return BRANDING_THEMES.find(b => b.id === id) || null;
}

// Füllt ein <select> aus der Registry — bei einem künftigen neuen Eintrag
// in BRANDING_THEMES taucht er hier automatisch auf, ohne dass die
// Markup-/Options-Liste angefasst werden muss. Von renderBrandingThemeSelect()
// (Logo & Icon) UND renderGraphicsThemeSelect() (gemeinsamer "Grafische
// Elemente"-Modus) genutzt, damit beide garantiert dieselben Optionen zeigen.
function renderBrandingThemeOptions(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = BRANDING_THEMES.map(b => `<option value="${b.id}">${b.label}</option>`).join('');
}
function renderBrandingThemeSelect() { renderBrandingThemeOptions('theme-builder-branding-theme'); }
function renderGraphicsThemeSelect()  { renderBrandingThemeOptions('theme-builder-graphics-theme'); }

// Dasselbe Prinzip für das Hintergrund-Dropdown: "Kein Bild" + jedes
// Theme aus BRANDING_THEMES (das eigene "background" mitbringt) +
// "Eigenes Bild" — ein künftiges Theme mit background-Eintrag erscheint
// hier automatisch, ohne dass diese Funktion angefasst werden muss.
function renderBackgroundSourceSelect() {
  const sel = document.getElementById('theme-builder-bg-source');
  if (!sel) return;
  const options = ['<option value="none">Kein Bild</option>']
    .concat(BRANDING_THEMES.filter(b => b.background).map(b => `<option value="${b.id}">${b.label}</option>`))
    .concat(['<option value="custom">Eigenes Bild</option>']);
  sel.innerHTML = options.join('');
}

// Dasselbe Prinzip für Kalender- und Start-Header-Dropdown — "Kein Bild"/
// "Kein Banner" + jedes Theme aus BRANDING_THEMES, das die jeweiligen
// Assets besitzt (.calendar bzw. .startHeader). Ein künftiges Theme ohne
// vollständige Kalender-/Start-Header-Bilder taucht dort dadurch
// automatisch nicht auf, statt eine kaputte Option anzubieten.
function renderCalendarThemeSelect() {
  const sel = document.getElementById('theme-builder-calendar-image');
  if (!sel) return;
  sel.innerHTML = ['<option value="none">Kein Bild</option>']
    .concat(BRANDING_THEMES.filter(b => b.calendar).map(b => `<option value="${b.id}">${b.label}</option>`))
    .join('');
}
function renderStartHeaderThemeSelect() {
  const sel = document.getElementById('theme-builder-start-header');
  if (!sel) return;
  sel.innerHTML = ['<option value="none">Kein Banner</option>']
    .concat(BRANDING_THEMES.filter(b => b.startHeader).map(b => `<option value="${b.id}">${b.label}</option>`))
    .join('');
}
// Gleiches Prinzip, aber ohne "Kein Bild"-Option — der Projekte-Tab
// braucht immer ein Baum-Set zum Rendern (getActiveProjectGraphics()
// fällt ohne gültige Auswahl ohnehin auf Cozy zurück), "keine Grafik"
// ist hier also kein sinnvoller Zustand.
function renderProjectsThemeSelect() {
  const sel = document.getElementById('theme-builder-projects-image');
  if (!sel) return;
  sel.innerHTML = BRANDING_THEMES.filter(b => b.projects).map(b => `<option value="${b.id}">${b.label}</option>`).join('');
}

// override (optional): {theme, useLogo} — siehe applyCalendarImageTheme()
// oben, hier zusätzlich für den Logo-Toggle. Nur von previewGraphicsLive()
// verwendet; ohne override unverändertes bisheriges Verhalten.
function applyBranding(id, override) {
  const ct = getCustomTheme(id);
  const brandingId = override ? override.theme : ((ct && ct.branding && ct.branding.theme) || BRANDING_THEMES[0].id);
  // Default AN gilt nur innerhalb eines tatsächlich eigenen Themes (Punkt
  // 13/14) — eingebaute Themes (kein ct) haben nie ein Logo/Icon-Toggle
  // gehabt und zeigen wie bisher ihr Icon, damit sich für sie durch diese
  // Änderung nichts ändert.
  const useLogo = override ? !!override.useLogo : (ct ? resolveUseLogo(ct.branding) : false);
  const bt = getBrandingTheme(brandingId);
  // "Kein Theme": bt ist der neutrale Registry-Eintrag ohne icon/logo (oder
  // — falls id mal ungültig/entfernt wäre — getBrandingTheme()s Fallback
  // fehlt ebenfalls ein icon). In beiden Fällen NICHT auf Cozy/Sci-Fi/
  // Forest/Royal zurückfallen, sondern das neutrale CORE-Icon verwenden —
  // verhindert einen kaputten Favicon-/Taskbar-Pfad.
  const isNoTheme = brandingId === 'none' || !bt.icon;

  const brandIconEl = document.getElementById('brand-icon');
  const headerEl = document.getElementById('sidebar-header');
  const faviconEl = document.querySelector('link[rel="icon"]');
  const iconSrc = isNoTheme ? NEUTRAL_BRANDING_ICON : bt.icon;
  const iconType = isNoTheme ? 'image/png' : bt.iconType;
  const showLogo = useLogo && !isNoTheme; // kein Theme-Logo ohne Theme

  // Favicon: immer das Icon des Branding-Themes (bzw. neutral bei "Kein
  // Theme"), vom Toggle unberührt.
  if (faviconEl) { faviconEl.href = iconSrc; faviconEl.type = iconType; }

  if (brandIconEl) {
    brandIconEl.src = showLogo ? bt.logo : iconSrc;
    brandIconEl.alt = isNoTheme ? 'CORE Icon' : (bt.label + (showLogo ? ' Logo' : ' Icon'));
  }
  if (headerEl) headerEl.classList.toggle('branding-logo-active', showLogo);
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
    // Roh-/Vollton-Wert VOR der Kartendurchlässigkeit — Pendant zu
    // --surface-solid der eingebauten Themes (main.css). Wird u.a. von der
    // Schnellnotiz (css/today.css: --quicknote-bg) verwendet, die dieselbe
    // Kartenfarbe zeigen, aber nie transparent werden soll.
    '--surface-solid': core.surface,
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

// Migration: vor der Hintergrund-Dropdown-Erweiterung gab es nur eigene,
// hochgeladene Bilder (identifiziert über assetId) — kein "source"-Feld.
// Ein vorhandenes assetId bedeutet also eindeutig source:'custom' (bzw.
// 'none', falls das Bild zuvor über die alte "Bild aktiv"-Checkbox
// deaktiviert war — dieses Feld bleibt dabei erhalten, falls später
// wieder auf "Eigenes Bild" zurückgeschaltet wird). Rein lesende
// Normalisierung, nichts wird zurückgeschrieben — bestehende Themes
// bleiben dadurch unverändert kompatibel, ohne Datenverlust.
function migrateBgMeta(meta) {
  if (!meta) return null;
  if (meta.source) return meta;
  if (meta.assetId) return Object.assign({}, meta, { source: meta.enabled === false ? 'none' : 'custom' });
  return meta;
}

// Eingebaute Themes: Metadaten in themeBackgrounds[id]. Eigene Themes:
// Metadaten direkt am Theme-Objekt (ct.bg) — kein zweiter Speicherort.
function getThemeBgMeta(id) {
  const ct = getCustomTheme(id);
  const raw = ct ? (ct.bg || null) : (themeBackgrounds[id] || null);
  return migrateBgMeta(raw);
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

// Baut den zweilagigen background-image-Stack (Tint-Verlauf + Bild) als
// {backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat}
// — gemeinsam genutzt von applyBgToDom() (echte Seite, Farbe kommt aus der
// aktiven --bg) und der kleinen Live-Vorschau im Theme-Editor (Farbe kommt
// dort aus dem gerade bearbeiteten Farbfeld), damit beide immer exakt
// gleich aussehen. rgb ist das bewusst von außen übergebene {r,g,b} statt
// hier selbst ermittelt — das Overlay nutzt bewusst die Theme-Hintergrund-
// farbe statt eines neutralen Schwarz/Grau, das Bild soll wirken, als
// schiene es durch die gewählte Farbe hindurch, nicht einfach nur dunkler
// werden. url === null → kein Bild (das Overlay entfällt dann komplett,
// nicht nur das Bild — "Kein Bild" darf keinen Grauschleier hinterlassen).
function buildBgLayers(url, meta, rgb) {
  if (!url) return null;
  const dim = ((meta && meta.dim) ?? 40) / 100;
  const { r, g, b } = rgb;
  const size = (meta && meta.size) || 'cover';
  const imgSize = size === 'contain' ? 'contain' : (size === 'center' ? 'auto' : 'cover');
  return {
    backgroundImage: `linear-gradient(rgba(${r},${g},${b},${dim.toFixed(2)}), rgba(${r},${g},${b},${dim.toFixed(2)})), url("${url}")`,
    backgroundSize: `auto, ${imgSize}`,
    backgroundPosition: 'center, center',
    backgroundRepeat: 'no-repeat',
  };
}

// body-Hintergrund wird laut CSS-Spec auf das Canvas propagiert (siehe
// main.css: body hat background, html nicht) und malt daher garantiert
// hinter #app, unabhängig von dessen Stacking-Context — kein eigenes
// Overlay-Element nötig, kein Risiko, versehentlich über der App-UI zu
// landen. url ist bereits eine fertige, direkt nutzbare Bild-URL (Object-
// URL für ein eigenes Bild, oder ein statischer Asset-Pfad für ein Theme-
// Hintergrundbild) — applyThemeBackground() löst das jeweils vorher auf.
function applyBgToDom(url, meta) {
  if (_teCurrentBgObjectUrl) { URL.revokeObjectURL(_teCurrentBgObjectUrl); _teCurrentBgObjectUrl = null; }
  const layers = buildBgLayers(url, meta, getThemeBgOverlayColor());
  if (!layers) {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundRepeat = '';
    document.body.style.backgroundAttachment = '';
    return;
  }
  Object.assign(document.body.style, layers);
  document.body.style.backgroundAttachment = 'fixed';
}

// source: 'none' → kein Bild (Themefarbe bleibt einfach stehen, siehe main.css).
// 'custom' → eigenes, in IndexedDB gespeichertes Bild (assetId).
// alles andere → statischer Hintergrundpfad aus BRANDING_THEMES (Cozy/Sci-
// Fi/künftige Themes) — komplett unabhängig vom aktiven UI-Theme, exakt wie
// Kalender/Start-Header/Logo & Icon. Ein unbekannter/entfernter source-Wert
// fällt bewusst auf "kein Bild" zurück statt auf ein anderes Theme-Bild.
function applyThemeBackground(themeId) {
  const meta = getThemeBgMeta(themeId);
  const source = meta ? meta.source : 'none';
  if (!meta || !source || source === 'none') { applyBgToDom(null, null); return Promise.resolve(); }

  if (source === 'custom') {
    if (!meta.assetId) { applyBgToDom(null, null); return Promise.resolve(); }
    return getBackgroundAsset(meta.assetId)
      .then(blob => {
        if (!blob) { applyBgToDom(null, null); return; }
        const url = URL.createObjectURL(blob);
        applyBgToDom(url, meta);
        _teCurrentBgObjectUrl = url;
      })
      .catch(e => {
        console.warn('Theme-Engine: Hintergrundbild konnte nicht geladen werden (IndexedDB evtl. nicht verfügbar, z.B. unter file://)', e);
        applyBgToDom(null, null);
      });
  }

  const bt = findBrandingTheme(source);
  applyBgToDom(bt && bt.background ? bt.background : null, meta);
  return Promise.resolve();
}

// =========================================================================
// EIGENE THEMES — CRUD + Builder-Modal
// =========================================================================

function deleteCustomTheme(id) {
  // Logikseitige Absicherung (Punkt 4): eingebaute Standardvorlagen dürfen
  // nie gelöscht werden, unabhängig vom aufrufenden UI-Weg.
  if (getBuiltinDesignTheme(id)) return;
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
let _teBuilderExistingBg  = null;   // bg-Metadaten des bearbeiteten Themes beim Öffnen (bereits migriert, s. migrateBgMeta)
let _teBuilderBgCleared   = false;  // Nutzer hat "Entfernen" geklickt
let _teBuilderPreviewObjectUrl = null; // separate Object-URL nur für die kleine Editor-Vorschau (nicht die echte Seite)
let _teBuilderGraphicsMode = 'theme';  // 'theme' | 'custom' — Zustand des "Grafische Elemente"-Umschalters

// ── "Grafische Elemente" — gemeinsamer Modus für Kalender/Start-Header/
// Logo & Icon ─────────────────────────────────────────────────────────────
// Der Hintergrund ist bewusst NICHT Teil dieser Kategorie (eigenständige
// Einstellung, siehe #theme-builder-bg-source weiter oben im Markup) —
// "Theme auswählen" darf ihn nie verändern. Ersetzt keine der drei
// Funktionen, setzt im Modus "theme" nur zentral deren bereits vorhandene
// Controls (siehe applyGraphicsThemeToControls() unten) — die einzige
// Stelle, die das tut (Punkt 21: keine doppelte Zuweisungslogik).

// Ermittelt Modus + Theme für ein bestehendes Theme: nutzt ein bereits
// gespeichertes ct.graphics, falls vorhanden; sonst wird aus den drei
// tatsächlichen Einzelwerten (Kalender/Start-Header/Logo&Icon-Theme —
// der Hintergrund fließt hier NICHT ein) abgeleitet — stimmen alle drei
// bereits mit einem gültigen BRANDING_THEMES-Eintrag überein, war es
// faktisch schon "ein Theme für alles" (→ mode:'theme'), sonst
// "Individuelle Anpassung". Rein lesend, wie migrateBgMeta() — nichts
// wird zurückgeschrieben.
function detectGraphicsMode(explicitGraphics, calendarTheme, startHeaderTheme, brandingTheme) {
  if (explicitGraphics && explicitGraphics.mode) return explicitGraphics;
  const values = [calendarTheme, startHeaderTheme, brandingTheme];
  const allSame = values.every(v => v && v === values[0]) && !!findBrandingTheme(values[0]);
  return allSame ? { mode: 'theme', theme: values[0] } : { mode: 'custom' };
}

// Zentrale Zuweisung: setzt EIN Theme auf die vier Einzel-Controls im
// Builder (Hintergrund bewusst ausgenommen) — Kalender/Start-Header/
// Logo&Icon nutzen bereits exakt dieselben BRANDING_THEMES-IDs
// ("cozy"/"scifi"/…) als Options-Werte, deshalb reicht ein einfaches
// Durchreichen ohne Übersetzungstabelle. Projekte: nur setzen, wenn das
// gewählte Theme tatsächlich ein `projects`-Set besitzt, sonst 'cozy' (Punkt
// 4b) — ein Theme ohne eigene Projektgrafiken darf hier keine kaputte
// Auswahl erzwingen.
function applyGraphicsThemeToControls(themeId) {
  document.getElementById('theme-builder-calendar-image').value = themeId;
  document.getElementById('theme-builder-start-header').value = themeId;
  document.getElementById('theme-builder-branding-theme').value = themeId;
  const projSel = document.getElementById('theme-builder-projects-image');
  if (projSel) { const bt = findBrandingTheme(themeId); projSel.value = (bt && bt.projects) ? themeId : 'cozy'; }
  previewGraphicsLive();
}

// Live-Vorschau der Grafikelemente (Kalender/Start-Header/Logo & Icon +
// Toggle/Projekte) auf der ECHTEN Seite — bewusst NUR, wenn das gerade im
// Editor geöffnete Theme auch das aktuell AKTIVE Theme ist. Sonst würde das
// Bearbeiten eines anderen (inaktiven) Themes fälschlich den gerade
// sichtbaren Kalender/Start-Header/Favicon/Projekte-Tab verändern. Liest
// bewusst die aktuellen, noch NICHT gespeicherten Formularwerte (nicht ct)
// und übergibt sie als override an die bereits vorhandenen Apply-Funktionen
// — keine zweite Preview-Implementierung. Projekte haben kein CSS-Attribut
// wie Kalender/Start-Header, deshalb hier über _projectGraphicsPreviewOverride
// (siehe getActiveProjectGraphics()) statt eines direkten override-Parameters.
// closeThemeBuilder() stellt beim Schließen ohne Speichern den echten
// gespeicherten Zustand wieder her.
function previewGraphicsLive() {
  if (!_teBuilderEditId || _teBuilderEditId !== theme) return;
  const calVal = document.getElementById('theme-builder-calendar-image').value;
  const startVal = document.getElementById('theme-builder-start-header').value;
  const brandVal = document.getElementById('theme-builder-branding-theme').value;
  const useLogoVal = document.getElementById('theme-builder-branding-logo').checked;
  const projVal = document.getElementById('theme-builder-projects-image')?.value;
  applyCalendarImageTheme(theme, calVal);
  applyStartHeaderTheme(theme, startVal);
  applyBranding(theme, { theme: brandVal, useLogo: useLogoVal });
  _projectGraphicsPreviewOverride = projVal || null;
  if (typeof refreshProjectGraphics === 'function') refreshProjectGraphics();
}

// "Logo verwenden": Standard AN, außer ein gespeicherter Wert sagt
// ausdrücklich AUS (Punkt 13/14/21) — nimmt das branding-Teilobjekt eines
// Themes/einer Vorlage entgegen (oder undefined/null, falls noch keins
// existiert bzw. kein eigenes Theme aktiv ist).
function resolveUseLogo(brandingObj) {
  return !brandingObj || brandingObj.useLogo !== false;
}

// Blendet nur um (Punkt 26: keine Werte verändern, keine Controls neu
// erzeugen) — die eigentliche Werte-Zuweisung passiert ausschließlich in
// applyGraphicsThemeToControls(), nicht hier.
function setGraphicsModeUI(mode) {
  _teBuilderGraphicsMode = mode;
  document.getElementById('theme-builder-graphics-mode-theme').classList.toggle('active', mode === 'theme');
  document.getElementById('theme-builder-graphics-mode-custom').classList.toggle('active', mode === 'custom');
  document.getElementById('theme-builder-graphics-theme-row').classList.toggle('hidden', mode !== 'theme');
  document.getElementById('theme-builder-graphics-detail').classList.toggle('hidden', mode !== 'custom');
}

function initThemeBuilderGraphicsControls() {
  const btnTheme = document.getElementById('theme-builder-graphics-mode-theme');
  const btnCustom = document.getElementById('theme-builder-graphics-mode-custom');
  const themeSel = document.getElementById('theme-builder-graphics-theme');
  if (!btnTheme) return;

  btnTheme.addEventListener('click', () => {
    setGraphicsModeUI('theme');
    applyGraphicsThemeToControls(themeSel.value);
  });
  btnCustom.addEventListener('click', () => {
    setGraphicsModeUI('custom'); // Werte bleiben unverändert (Punkt 16)
  });
  themeSel.addEventListener('change', () => applyGraphicsThemeToControls(themeSel.value));

  // Individuelle Anpassung: bislang hatten diese vier Controls (anders als
  // Farbe/Transparenz/Schriftgröße oben, die bereits 'input'-Listener auf
  // updateThemeBuilderPreview() haben) GAR KEINEN Listener — eine Änderung
  // blieb bis zum Speichern unsichtbar. Jetzt konsistent: jede Änderung
  // läuft sofort durch dieselbe previewGraphicsLive() wie der gemeinsame
  // Modus oben.
  document.getElementById('theme-builder-calendar-image').addEventListener('change', previewGraphicsLive);
  document.getElementById('theme-builder-start-header').addEventListener('change', previewGraphicsLive);
  document.getElementById('theme-builder-branding-theme').addEventListener('change', previewGraphicsLive);
  document.getElementById('theme-builder-branding-logo').addEventListener('change', previewGraphicsLive);
  document.getElementById('theme-builder-projects-image').addEventListener('change', previewGraphicsLive);
}

const DEFAULT_BUILDER_CORE = {
  bg: '#1a1815', surface: '#252119', nav: '#20201e', modal: '#252119',
  text: '#ede6d8', border: '#f0dcb4', accent: '#728460', font: DEFAULT_FONT_STACK,
};

function openThemeBuilder(editId) {
  // Eingebaute Standardvorlagen sind nicht bearbeitbar — der Editor öffnet
  // sich für sie gar nicht erst. Dies ist die logikseitige Absicherung
  // (Punkt 4 des Auftrags), unabhängig davon, dass die Oberfläche ohnehin
  // keinen Bearbeiten-Weg zu ihnen mehr anbietet (index.html: die neun
  // Standard-Theme-Buttons besitzen keinen Stift). Vorlagen für neue Themes
  // funktionieren weiterhin über die separate "Vorlage"-Leiste
  // (renderThemeTemplateStrip()/applyThemeTemplate() unten) — die erzeugt
  // eine unabhängige Kopie der Werte in den gerade geöffneten
  // Erstellen-Formular, ohne diese Funktion hier aufzurufen.
  if (editId && getBuiltinDesignTheme(editId)) return;
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
  renderCalendarThemeSelect();
  document.getElementById('theme-builder-calendar-image').value = (existing && existing.calendar && existing.calendar.imageTheme) || 'cozy';
  renderStartHeaderThemeSelect();
  document.getElementById('theme-builder-start-header').value = (existing && existing.startHeader && existing.startHeader.banner) || 'scifi';
  renderBrandingThemeSelect();
  document.getElementById('theme-builder-branding-theme').value = (existing && existing.branding && existing.branding.theme) || BRANDING_THEMES[0].id;
  document.getElementById('theme-builder-branding-logo').checked = resolveUseLogo(existing && existing.branding);
  renderProjectsThemeSelect();
  document.getElementById('theme-builder-projects-image').value = (existing && existing.projects && existing.projects.imageTheme) || 'cozy';
  renderFontSelect(core.font);

  // Hintergrund: eigenständig, NICHT Teil der gemeinsamen Grafik-Kategorie
  // unten — bleibt beim Theme-Wechsel/Moduswechsel dort immer unangetastet.
  renderBackgroundSourceSelect();
  _teBuilderPendingFile = null;
  _teBuilderExistingBg = existing ? migrateBgMeta(existing.bg || null) : null;
  _teBuilderBgCleared = false;
  _projectGraphicsPreviewOverride = null; // defensiv — sollte beim Öffnen ohnehin bereits null sein (siehe closeThemeBuilder())
  document.getElementById('theme-builder-bg-source').value = (_teBuilderExistingBg && _teBuilderExistingBg.source) || 'none';
  syncThemeBuilderBgUI();

  // Grafische Elemente (Kalender/Start-Header/Logo&Icon-Theme): Modus
  // erkennen (gespeichert oder aus den drei Einzelwerten oben abgeleitet
  // — der Hintergrund fließt bewusst NICHT mehr in diese Erkennung ein)
  // und Editor entsprechend zeigen. Ein brandneues Theme (kein "existing")
  // startet bewusst im einfacheren "Theme auswählen"-Modus mit dem ersten
  // Registry-Eintrag.
  renderGraphicsThemeSelect();
  const graphics = existing
    ? detectGraphicsMode(
        existing.graphics || null,
        existing.calendar ? existing.calendar.imageTheme : null,
        existing.startHeader ? existing.startHeader.banner : null,
        existing.branding ? existing.branding.theme : null
      )
    : { mode: 'theme', theme: BRANDING_THEMES[0].id };
  document.getElementById('theme-builder-graphics-theme').value = graphics.theme || BRANDING_THEMES[0].id;
  setGraphicsModeUI(graphics.mode);
  if (graphics.mode === 'theme') applyGraphicsThemeToControls(graphics.theme || BRANDING_THEMES[0].id);

  renderThemeTemplateStrip();
  updateThemeBuilderPreview();
  document.getElementById('theme-builder-modal-overlay').classList.remove('hidden');
  document.getElementById('theme-builder-name').focus();
}

function closeThemeBuilder() {
  // Falls previewGraphicsLive() (s.o.) während der Bearbeitung des
  // AKTIVEN Themes ungespeicherte Formularwerte live auf die echte Seite
  // angewendet hat: beim Schließen ohne Speichern zurück auf den
  // tatsächlich gespeicherten Zustand — sonst bliebe eine nie gespeicherte
  // Vorschau sichtbar. saveThemeBuilder() ruft bei aktivem Theme bereits
  // setTheme() (volle Neuanwendung mit den frisch gespeicherten Werten)
  // VOR closeThemeBuilder() auf — dieser Aufruf hier ist dann ein
  // harmloses, redundantes Re-Apply derselben (jetzt aktuellen) Daten.
  if (_teBuilderEditId && _teBuilderEditId === theme) {
    applyCalendarImageTheme(theme);
    applyStartHeaderTheme(theme);
    applyBranding(theme);
  }
  _projectGraphicsPreviewOverride = null;
  if (typeof refreshProjectGraphics === 'function') refreshProjectGraphics();
  document.getElementById('theme-builder-modal-overlay').classList.add('hidden');
  _teBuilderEditId = null;
  _teBuilderPendingFile = null;
  _teBuilderExistingBg = null;
  _teBuilderBgCleared = false;
  _teBuilderGraphicsMode = 'theme';
  if (_teBuilderPreviewObjectUrl) { URL.revokeObjectURL(_teBuilderPreviewObjectUrl); _teBuilderPreviewObjectUrl = null; }
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
  // backgroundColor statt der background-Kurzform: Letztere würde die von
  // updateThemeBuilderBgPreview() gesetzten background-image-Ebenen
  // (Hintergrundbild-Vorschau) bei jedem Tastendruck wieder auf "none"
  // zurücksetzen, weil die Kurzform alle Teileigenschaften mit übernimmt.
  preview.style.backgroundColor = `color-mix(in srgb, ${surface} ${opacity}%, transparent)`;
  preview.style.color = text;
  preview.style.borderColor = hexToRgba(border, 0.35);
  preview.style.fontSize = (15 * fontSize / 100).toFixed(1) + 'px';
  updateThemeBuilderBgPreview();
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
    .map(reg => {
      // Light/Classic Dark: reine CSS-Themes ohne eigene Grafik-/Font-
      // Einstellungen — unverändertes bisheriges Verhalten (generischer
      // Cozy/Sci-Fi-Platzhalter, wie zuvor).
      const bg = migrateBgMeta(themeBackgrounds[reg.id] || null);
      const calendarImageTheme = 'cozy', startHeaderBanner = 'scifi', brandingTheme = BRANDING_THEMES[0].id, projectsTheme = 'cozy';
      return {
        name: reg.label, core: reg.core, cardOpacity: 100, fontSize: 100, bg,
        calendarImageTheme, startHeaderBanner, brandingTheme, projectsTheme, brandingUseLogo: resolveUseLogo(),
        graphics: detectGraphicsMode(null, calendarImageTheme, startHeaderBanner, brandingTheme),
      };
    })
    // Die sieben eingebauten grafischen Standardvorlagen: vollständige
    // Werte direkt aus BUILTIN_DESIGN_THEMES (dieselbe Quelle, die auch
    // beim tatsächlichen Auswählen dieser Themes verwendet wird) — dadurch
    // übernimmt "Als Vorlage verwenden" wirklich Font/Transparenz/
    // Abdunklung/Hintergrund/Kalender/Start-Header/Branding, nicht nur
    // Farben. Liefert lesend eine Kopie der jeweiligen Vorlage; die
    // Standardvorlage selbst bleibt dabei unangetastet (siehe
    // applyThemeTemplate(): schreibt nur in die Editor-Formularfelder,
    // nicht in BUILTIN_DESIGN_THEMES).
    .concat(BUILTIN_DESIGN_THEMES.map(bt => ({
      name: bt.name,
      core: bt.coreColors,
      cardOpacity: bt.cardOpacity,
      fontSize: bt.fontSize,
      bg: bt.bg,
      calendarImageTheme: bt.calendar.imageTheme,
      startHeaderBanner: bt.startHeader.banner,
      brandingTheme: bt.branding.theme,
      projectsTheme: (bt.projects && bt.projects.imageTheme) || 'cozy',
      brandingUseLogo: resolveUseLogo(bt.branding),
      graphics: bt.graphics,
    })))
    .concat(customThemes.map(ct => {
      const bg = migrateBgMeta(ct.bg || null);
      const calendarImageTheme = (ct.calendar && ct.calendar.imageTheme) || 'cozy';
      const startHeaderBanner = (ct.startHeader && ct.startHeader.banner) || 'scifi';
      const brandingTheme = (ct.branding && ct.branding.theme) || BRANDING_THEMES[0].id;
      const projectsTheme = (ct.projects && ct.projects.imageTheme) || 'cozy';
      return {
        name: ct.name,
        core: Object.assign({}, DEFAULT_BUILDER_CORE, ct.coreColors),
        cardOpacity: ct.cardOpacity ?? 100,
        fontSize: ct.fontSize ?? 100,
        bg, calendarImageTheme, startHeaderBanner, brandingTheme, projectsTheme,
        brandingUseLogo: resolveUseLogo(ct.branding),
        graphics: detectGraphicsMode(ct.graphics || null, calendarImageTheme, startHeaderBanner, brandingTheme),
      };
    }));

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
  renderCalendarThemeSelect();
  document.getElementById('theme-builder-calendar-image').value = t.calendarImageTheme || 'cozy';
  renderStartHeaderThemeSelect();
  document.getElementById('theme-builder-start-header').value = t.startHeaderBanner || 'scifi';
  renderBrandingThemeSelect();
  document.getElementById('theme-builder-branding-theme').value = t.brandingTheme || BRANDING_THEMES[0].id;
  document.getElementById('theme-builder-branding-logo').checked = !!t.brandingUseLogo;
  renderProjectsThemeSelect();
  document.getElementById('theme-builder-projects-image').value = t.projectsTheme || 'cozy';
  renderFontSelect(t.core.font || DEFAULT_FONT_STACK);

  // Hintergrund-Quelle + Größe/Overlay der Vorlage übernehmen. Ein eigenes
  // Bild (source:'custom') läuft dabei über denselben Weg wie eine manuell
  // gewählte Datei (_teBuilderPendingFile), dadurch erzeugt
  // resolveThemeBuilderBg() beim Speichern automatisch einen eigenen,
  // unabhängigen IndexedDB-Eintrag statt eine Referenz zu teilen. Ein
  // Theme-Hintergrund (Cozy/Sci-Fi/…) braucht dafür keinen IndexedDB-
  // Zugriff — nur der Quellenwert selbst wird übernommen.
  renderBackgroundSourceSelect();
  document.getElementById('theme-builder-bg-source').value = (t.bg && t.bg.source) || 'none';
  document.getElementById('theme-builder-bg-size').value = (t.bg && t.bg.size) || 'cover';
  document.getElementById('theme-builder-bg-dim').value = (t.bg && t.bg.dim) ?? 40;
  document.getElementById('theme-builder-bg-dim-label').textContent = ((t.bg && t.bg.dim) ?? 40) + '%';
  _teBuilderPendingFile = null;
  _teBuilderExistingBg = null;
  _teBuilderBgCleared = false;
  if (t.bg && t.bg.source === 'custom' && t.bg.assetId) {
    getBackgroundAsset(t.bg.assetId).then(blob => {
      if (!blob) return;
      _teBuilderPendingFile = new File([blob], t.bg.name || 'hintergrund.jpg', { type: blob.type });
      syncThemeBuilderBgUI();
      updateThemeBuilderBgPreview();
    }).catch(() => {});
  }

  syncThemeBuilderBgUI();

  // Grafische Elemente (Kalender/Start-Header/Logo&Icon-Theme): Modus +
  // gemeinsames Theme der Vorlage übernehmen — der Hintergrund oben ist
  // davon unabhängig und bereits fertig gesetzt. Die drei Einzelwerte
  // wurden gerade bereits gesetzt — im Modus "theme" ruft
  // applyGraphicsThemeToControls() sie hier nur nochmal konsistent auf
  // (harmlos, da sie laut t.graphics ohnehin bereits übereinstimmen), im
  // Modus "custom" bleiben sie unverändert stehen.
  renderGraphicsThemeSelect();
  const graphics = t.graphics || { mode: 'custom' };
  document.getElementById('theme-builder-graphics-theme').value = graphics.theme || BRANDING_THEMES[0].id;
  setGraphicsModeUI(graphics.mode);
  if (graphics.mode === 'theme') applyGraphicsThemeToControls(graphics.theme || BRANDING_THEMES[0].id);

  updateThemeBuilderPreview();
}

// ── Hintergrundbild-Sektion innerhalb des Builders ──────────────────────
// Quelle (Dropdown) bestimmt, welche Teile sichtbar sind: Datei-Zeile nur
// bei "Eigenes Bild", Größe/Overlay bei jeder Quelle außer "Kein Bild"
// (gilt jetzt auch für Cozy/Sci-Fi/künftige Themes, siehe applyThemeBackground()).
function syncThemeBuilderBgUI() {
  const sourceSel = document.getElementById('theme-builder-bg-source');
  const customRow = document.getElementById('theme-builder-bg-custom-row');
  const filenameEl = document.getElementById('theme-builder-bg-filename');
  const optRow = document.getElementById('theme-builder-bg-options');
  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const dimLabel = document.getElementById('theme-builder-bg-dim-label');

  const source = sourceSel.value;
  customRow.classList.toggle('hidden', source !== 'custom');
  optRow.classList.toggle('hidden', source === 'none');

  const pendingName = _teBuilderPendingFile ? _teBuilderPendingFile.name : null;
  const hasCustomFile = !_teBuilderBgCleared && !!(pendingName || (_teBuilderExistingBg && _teBuilderExistingBg.assetId));
  filenameEl.textContent = hasCustomFile ? (pendingName || _teBuilderExistingBg.name || 'Bild geladen') : 'Kein Bild ausgewählt';

  if (_teBuilderExistingBg && !pendingName) {
    sizeSel.value = _teBuilderExistingBg.size || 'cover';
    dimSlider.value = _teBuilderExistingBg.dim ?? 40;
    dimLabel.textContent = (_teBuilderExistingBg.dim ?? 40) + '%';
  }
}

// Kleine Live-Vorschau direkt in #theme-builder-preview (dieselbe Box, die
// auch Farbe/Transparenz/Schriftgröße vorschaut) — zeigt die gewählte
// Hintergrundquelle sofort an, ohne die tatsächliche Seite zu verändern
// (nutzt eine eigene Object-URL, unabhängig von _teCurrentBgObjectUrl der
// echten Seite). Der Tint verwendet die im Editor gerade eingestellte
// Hintergrundfarbe (#theme-builder-bg), nicht die des aktiven UI-Themes.
function updateThemeBuilderBgPreview() {
  const preview = document.getElementById('theme-builder-preview');
  const sourceSel = document.getElementById('theme-builder-bg-source');
  if (!preview || !sourceSel) return;
  if (_teBuilderPreviewObjectUrl) { URL.revokeObjectURL(_teBuilderPreviewObjectUrl); _teBuilderPreviewObjectUrl = null; }

  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const meta = { size: sizeSel.value, dim: parseInt(dimSlider.value, 10) };
  const rgb = parseColorToRgb(document.getElementById('theme-builder-bg').value) || { r: 0, g: 0, b: 0 };

  const setLayers = (url) => {
    const layers = buildBgLayers(url, meta, rgb);
    if (!layers) {
      preview.style.backgroundImage = '';
      preview.style.backgroundSize = '';
      preview.style.backgroundPosition = '';
      preview.style.backgroundRepeat = '';
      return;
    }
    Object.assign(preview.style, layers);
  };

  const source = sourceSel.value;
  if (source === 'none') { setLayers(null); return; }

  if (source === 'custom') {
    if (!_teBuilderBgCleared && _teBuilderPendingFile) {
      const url = URL.createObjectURL(_teBuilderPendingFile);
      _teBuilderPreviewObjectUrl = url;
      setLayers(url);
    } else if (!_teBuilderBgCleared && _teBuilderExistingBg && _teBuilderExistingBg.assetId) {
      getBackgroundAsset(_teBuilderExistingBg.assetId).then(blob => {
        if (!blob) { setLayers(null); return; }
        const url = URL.createObjectURL(blob);
        _teBuilderPreviewObjectUrl = url;
        setLayers(url);
      }).catch(() => setLayers(null));
    } else {
      setLayers(null);
    }
    return;
  }

  const bt = findBrandingTheme(source);
  setLayers(bt && bt.background ? bt.background : null);
}

function initThemeBuilderBgControls() {
  const sourceSel = document.getElementById('theme-builder-bg-source');
  const pickBtn = document.getElementById('theme-builder-bg-pick-btn');
  const clearBtn = document.getElementById('theme-builder-bg-clear-btn');
  const fileInput = document.getElementById('theme-builder-bg-file-input');
  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const dimLabel = document.getElementById('theme-builder-bg-dim-label');

  sourceSel.addEventListener('change', () => {
    syncThemeBuilderBgUI();
    updateThemeBuilderBgPreview();
  });
  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    _teBuilderPendingFile = file;
    _teBuilderBgCleared = false;
    syncThemeBuilderBgUI();
    updateThemeBuilderBgPreview();
  });
  clearBtn.addEventListener('click', () => {
    _teBuilderPendingFile = null;
    _teBuilderBgCleared = true;
    syncThemeBuilderBgUI();
    updateThemeBuilderBgPreview();
  });
  sizeSel.addEventListener('change', updateThemeBuilderBgPreview);
  dimSlider.addEventListener('input', () => {
    dimLabel.textContent = dimSlider.value + '%';
    updateThemeBuilderBgPreview();
  });
}

// Löst die Hintergrundbild-Auswahl des Builders in konkrete bg-Metadaten
// auf und schreibt die Bilddaten (falls neu) erst jetzt nach IndexedDB —
// wird nur beim tatsächlichen Speichern des Themes aufgerufen. assetId/
// name eines bereits vorhandenen eigenen Bildes bleiben auch dann
// erhalten, wenn die Quelle gerade auf "Kein Bild"/ein Theme-Hintergrund
// steht — nur "Entfernen" oder ein neu gewähltes Bild ändern das wirklich
// (siehe Kommentar in syncThemeBuilderBgUI). Dadurch geht ein eigenes
// Bild nicht verloren, nur weil kurz eine andere Quelle ausprobiert wurde.
function resolveThemeBuilderBg() {
  const source = document.getElementById('theme-builder-bg-source').value;
  const sizeSel = document.getElementById('theme-builder-bg-size');
  const dimSlider = document.getElementById('theme-builder-bg-dim');
  const size = sizeSel.value;
  const dim = parseInt(dimSlider.value, 10);

  if (_teBuilderBgCleared) {
    if (_teBuilderExistingBg && _teBuilderExistingBg.assetId) deleteBackgroundAsset(_teBuilderExistingBg.assetId);
    return Promise.resolve({ source, size, dim });
  }
  if (_teBuilderPendingFile) {
    const assetId = 'bg_' + Date.now();
    return putBackgroundAsset(assetId, _teBuilderPendingFile).then(() => {
      if (_teBuilderExistingBg && _teBuilderExistingBg.assetId) deleteBackgroundAsset(_teBuilderExistingBg.assetId);
      return { source, assetId, name: _teBuilderPendingFile.name, size, dim };
    }).catch(e => {
      console.warn('Theme-Engine: Hintergrundbild konnte nicht gespeichert werden', e);
      alert('Hintergrundbild konnte nicht gespeichert werden — dieser Browser unterstützt hier evtl. kein IndexedDB (kommt z.B. vor, wenn Nook als lokale Datei geöffnet wird). Das Theme wird ohne Hintergrundbild gespeichert.');
      return Object.assign({}, _teBuilderExistingBg, { source: 'none', size, dim });
    });
  }
  // Kein neues Bild gewählt, keine Löschung — bestehende Metadaten (falls
  // vorhanden) bleiben für ein mögliches späteres Zurückschalten auf
  // "Eigenes Bild" erhalten; nur Quelle/Größe/Abdunkelung werden aktualisiert.
  return Promise.resolve(Object.assign({}, _teBuilderExistingBg, { source, size, dim }));
}

function saveThemeBuilder() {
  // Logikseitige Absicherung (Punkt 4): eine Standardvorlage darf niemals
  // gespeichert/überschrieben werden, selbst wenn dieser Pfad aus
  // irgendeinem Grund mit ihrer ID erreicht würde — openThemeBuilder()
  // öffnet den Editor für sie zwar bereits gar nicht erst, dieser Guard
  // greift aber unabhängig davon.
  if (_teBuilderEditId && getBuiltinDesignTheme(_teBuilderEditId)) return;

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
  const startHeader = { banner: document.getElementById('theme-builder-start-header').value };
  const branding = {
    theme: document.getElementById('theme-builder-branding-theme').value,
    useLogo: document.getElementById('theme-builder-branding-logo').checked,
  };
  const projects = { imageTheme: document.getElementById('theme-builder-projects-image').value };
  // Grafische Elemente: nur Modus + gewähltes gemeinsames Theme werden
  // gespeichert — die drei tatsächlichen Werte oben (calendar/startHeader/
  // branding.theme) sind im Modus "theme" durch
  // applyGraphicsThemeToControls() bereits live konsistent gehalten
  // worden, hier also keine zusätzliche Zuweisung nötig. bg (Hintergrund)
  // ist bewusst NICHT Teil davon — eigenständig, unten unverändert über
  // resolveThemeBuilderBg() gespeichert.
  const graphics = {
    mode: _teBuilderGraphicsMode,
    theme: document.getElementById('theme-builder-graphics-theme').value,
  };
  const vars = deriveThemeVars(core, cardOpacity, fontSize);
  const family = teLuminance(core.bg) < 128 ? 'dark' : 'light';
  const editId = _teBuilderEditId;

  resolveThemeBuilderBg().then(bg => {
    if (editId) {
      const ct = getCustomTheme(editId);
      if (ct) {
        ct.name = name; ct.coreColors = core; ct.vars = vars; ct.family = family;
        ct.cardOpacity = cardOpacity; ct.fontSize = fontSize; ct.bg = bg; ct.calendar = calendar; ct.startHeader = startHeader; ct.branding = branding; ct.projects = projects; ct.graphics = graphics;
        saveCustomThemes();
        if (theme === ct.id) setTheme(ct.id); // sofort neu anwenden, falls gerade aktiv
      }
    } else {
      const id = 'custom_' + Date.now();
      customThemes.push({ id, name, family, coreColors: core, vars, cardOpacity, fontSize, bg, calendar, startHeader, branding, projects, graphics });
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
  // Aktualisiert u.a. den Vorschau-Punkt der sieben eingebauten
  // Standardvorlagen (js/settings.js: renderThemeSettings()) — nötig,
  // damit eine gerade gespeicherte Anpassung (builtinThemeOverrides) direkt
  // sichtbar wird, nicht erst beim nächsten Tab-Wechsel.
  if (typeof renderThemeSettings === 'function') renderThemeSettings();
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
applyStartHeaderTheme(theme);
applyBranding(theme);

function injectThemeBuilderListeners() {
  document.getElementById('theme-builder-close').addEventListener('click', closeThemeBuilder);
  document.getElementById('theme-builder-cancel').addEventListener('click', closeThemeBuilder);
  document.getElementById('theme-builder-save').addEventListener('click', saveThemeBuilder);
  document.getElementById('theme-builder-delete').addEventListener('click', () => {
    // Zusätzliche Absicherung neben dem bereits versteckten Button (siehe
    // openThemeBuilder()) — eingebaute Standardvorlagen dürfen nie gelöscht
    // werden.
    if (!_teBuilderEditId || getBuiltinDesignTheme(_teBuilderEditId)) return;
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
initThemeBuilderGraphicsControls();
initThemeBgControls();
