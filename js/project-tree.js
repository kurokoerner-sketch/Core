// =========================
// PROJECT-TREE.JS  (v4 — mehrere Grafik-Sets)
// Verantwortlich NUR für:
//   - PNG-Baumvariante je Projekt zuweisen → getOrAssignTreeVariant(project)
//   - Großen Detailbaum rendern → updateDetailTreeElements(project)
//     (PNG-Baum in #proj-detail-tree, dieselbe Variante wie im Projektwald,
//     plus Haupt-/Extra-Aufgaben-Deko)
//
// Das tatsächliche Grafik-Set (Cozy/Forest/…) kommt aus
// getActiveProjectGraphics() (js/theme-engine.js: BRANDING_THEMES[x].projects)
// — diese Datei kennt keine festen Theme-Namen oder -Pfade mehr, siehe
// Kommentare unten.
//
// Schnittstelle nach außen:
//   getOrAssignTreeVariant(project)    → 1..TREE_PNG_COUNT (Speicherbereich,
//                                         unabhängig vom aktiven Set)
//   updateDetailTreeElements(project)
// =========================

// =========================
// HILFSFUNKTIONEN
// =========================
function seededRand(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function idToSeed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function escapeXml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// =========================
// BAUM-VARIANTE (PNG)
// Jedes Projekt bekommt bei der ersten Anzeige dauerhaft eine von
// TREE_PNG_COUNT Baumvarianten zugewiesen und in project.treeVariant
// gespeichert — einmalig ausgewürfelt, nie neu. TREE_PNG_COUNT (5) ist der
// Speicherbereich für das Set mit den meisten Bäumen (aktuell Cozy) und
// bleibt für Cozy 1:1 die Anzeigenummer — hier wird nichts umgerechnet,
// project.treeVariant IST bereits die Cozy-Baumnummer.
//
// GEFUNDENE URSACHE (Bugfix): Ein Set mit WENIGER Bäumen als Cozy (Forest:
// 3) rechnete die Cozy-Nummer bisher per `((variant-1) % treeCount) + 1`
// um. Das bildet 5 Werte ungleich auf 3 Bäume ab: Baum 1 bekommt die
// Cozy-Varianten {1,4}, Baum 2 die Varianten {2,5}, Baum 3 NUR die
// Variante {3} — Baum 3 kam dadurch rechnerisch nur halb so oft vor wie
// Baum 1/2 (bestätigt per Simulation über 2000 Zufalls-IDs: ~41 % / 38 % /
// 21 %). Separat kam hinzu, dass "forest prj tree_1.png" beim ursprünglich
// gemeldeten Test noch fehlte — jedes Projekt mit Anzeigenummer 1 zeigte
// dadurch einen kaputten/leeren Baum statt eines sichtbaren Ausweichbaums
// (der onerror-Fallback zeigt ebenfalls auf Nummer 1 und bricht bei
// bereits identischem Pfad korrekt ab, ersetzt das Bild aber nicht durch
// einen ANDEREN Baum). In Kombination mit der ohnehin seltenen Baum-3-
// Variante konnte das bei wenigen Testprojekten wie "immer Baum 2" wirken.
// Die fehlende Datei ist inzwischen vorhanden; die Verzerrung bestand aber
// unabhängig davon und wird hier behoben.
//
// FIX: Sets mit abweichender Baumanzahl bekommen eine EIGENE, nicht
// gespeicherte, bei jedem Rendern neu berechnete Verteilung aus Projekt-ID
// + Set-ID (idToSeed() ist bereits vorhanden, hier nur mit einem anderen
// Eingabestring aufgerufen) — pro Projekt stabil, gleichmäßig über
// treeCount verteilt, und unabhängig vom gespeicherten Cozy-Wert (der
// bleibt dadurch beim Hin-/Herwechseln der Sets unverändert erhalten).
// =========================
const TREE_PNG_COUNT = 5;

function getOrAssignTreeVariant(project) {
  if (project.treeVariant >= 1 && project.treeVariant <= TREE_PNG_COUNT) return project.treeVariant;
  const rng = seededRand(idToSeed(project.id) + 911);
  project.treeVariant = Math.floor(rng() * TREE_PNG_COUNT) + 1;
  if (typeof saveProjects === 'function') saveProjects();
  return project.treeVariant;
}

// Liefert die tatsächlich anzuzeigende Baumnummer für das aktive Grafik-Set
// — von forest.js (buildForestTree()) und updateDetailTreeElements() unten
// gemeinsam genutzt, damit beide garantiert denselben Baum zeigen. project
// muss bereits project.treeVariant gesetzt haben (getOrAssignTreeVariant()
// vorher aufgerufen).
function resolveTreeDisplayNumber(project, graphics) {
  if (graphics.treeCount === TREE_PNG_COUNT) return project.treeVariant;
  return (idToSeed(project.id + ':' + graphics.setId) % graphics.treeCount) + 1;
}

// =========================
// HAUPT-/EXTRA-AUFGABEN-DEKO (Detailbaum)
// Positionen (in % der Bildfläche) innerhalb einer Ellipse, an denen die
// Deko-Bilder des aktiven Grafik-Sets für erledigte Kern- bzw.
// Extraaufgaben "sitzen" (Cozy: Äpfel in der Krone / Blüten in der Krone;
// Forest: Feen in der Krone / Pilzwesen am Stammfuß — siehe
// BRANDING_THEMES[x].projects.mainDecor/.extraDecor in js/theme-engine.js,
// jeweils mit eigener Ellipse). Rein dekorativ — die eigentliche
// Aufgabenliste (Klicken, Abhaken, Details) läuft weiterhin über die
// Äste-Kacheln (#proj-detail-tiles, renderDetailTiles() in forest.js).
// Reicht die Anzahl erledigter Aufgaben über die Slotzahl hinaus, wird
// gedeckelt (Deko, kein 1:1-Protokoll).
//
// Positionen werden nicht fest vorgegeben, sondern innerhalb der
// übergebenen Ellipse zufällig gestreut. Seed = Projekt-ID + fester Salt,
// damit die Streuung pro Projekt stabil bleibt (kein Neu-Würfeln bei jedem
// Re-Render) und Haupt- bzw. Extra-Deko jeweils ihr eigenes, unabhängiges
// Muster bekommen.
// =========================
const DECOR_MAX = 8;

function generateCanopySlots(project, saltOffset, count, ellipse) {
  const rng = seededRand(idToSeed(project.id) + saltOffset);
  const { cx, cy, rx, ry } = ellipse;
  const slots = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const r     = Math.sqrt(rng()) * 0.85; // gleichverteilt in der Fläche, mit Rand zur Kronenkante
    slots.push({ x: cx + Math.cos(angle) * rx * r, y: cy + Math.sin(angle) * ry * r });
  }
  return slots;
}

// =========================
// DETAILBAUM (PNG + Deko) AKTUALISIEREN
// =========================
function updateDetailTreeElements(p) {
  const treeContainer = document.getElementById('proj-detail-tree');
  if (!treeContainer) return;

  const graphics    = getActiveProjectGraphics();
  getOrAssignTreeVariant(p);
  const displayNum  = resolveTreeDisplayNumber(p, graphics);
  const season      = p.archived ? graphics.doneSuffix : '';
  const primarySrc  = `${graphics.treePrefix}${displayNum}${season}.png`;
  const fallbackSrc = `${graphics.treePrefix}1${season}.png`;

  const allTasks  = [...(p.tasks || []), ...(p.subprojects || []).flatMap(sp => sp.tasks || [])];
  const coreDone   = Math.min(allTasks.filter(t => t.done && !t.isExtra).length, DECOR_MAX);
  const extraDone  = Math.min(allTasks.filter(t => t.done &&  t.isExtra).length, DECOR_MAX);

  const decor = [
    ...generateCanopySlots(p, 401, coreDone, graphics.mainDecor.ellipse).map(s => ({ ...s, cls: graphics.mainDecor.cls, src: graphics.mainDecor.src, alt: graphics.mainDecor.alt })),
    ...generateCanopySlots(p, 907, extraDone, graphics.extraDecor.ellipse).map(s => ({ ...s, cls: graphics.extraDecor.cls, src: graphics.extraDecor.src, alt: graphics.extraDecor.alt })),
  ].map((s, i) => `<img class="pdt-tree-decor-item ${s.cls}" src="${s.src}" alt="${s.alt}" draggable="false" style="left:${s.x}%;top:${s.y}%;animation-delay:${(i % 5) * 0.4}s;" />`).join('');

  treeContainer.innerHTML = `
    <div class="pdt-tree-wrap">
      <img class="pdt-tree-img" src="${primarySrc}" alt="${escapeXml(p.name)}" draggable="false"
           onerror="if(!this.src.endsWith('${fallbackSrc}')) this.src='${fallbackSrc}';" />
      <div class="pdt-tree-decor">${decor}</div>
    </div>
  `;
  // Fortschritt (Prozent/Balken/Zähler) wird NICHT hier geschrieben — alleinige
  // Quelle ist renderProjectDetail() in forest.js via getProjectStats(), damit es
  // nur einen Berechnungsweg gibt und Zahlen nie auseinanderlaufen können.
}
