# assets/fonts/

Ablageort für eigene Schriftdateien, die im Theme-Editor unter „Schriftart →
Eigene Fonts" auswählbar sein sollen.

Unterstützte Formate (in Bevorzugungsreihenfolge): `.woff2`, `.woff`, `.ttf`, `.otf`.

## Eine Datei hinzufügen

1. Datei hierher legen (z. B. `MeineSchrift-Regular.woff2`).
2. Eintrag in `CUSTOM_FONT_FILES` (`js/theme-engine.js`) ergänzen:

   ```js
   { family: 'Meine Schrift', source: 'assets/fonts/MeineSchrift-Regular.woff2', weight: '400', style: 'normal' },
   ```

3. Bei mehreren Schnitten derselben Familie (z. B. Regular + Italic) denselben
   `family`-Wert verwenden, mit passendem `weight`/`style` pro Zeile.

Es gibt bewusst keine automatische Erkennung beliebiger Dateien in diesem
Ordner — jede Schrift wird einmal manuell registriert. `js/theme-engine.js`
erzeugt daraus beim Laden automatisch die passenden `@font-face`-Regeln.

## Lizenz

Nur Schriften ablegen, deren Lizenz die Verwendung/Weitergabe in diesem
Projekt erlaubt (z. B. SIL Open Font License). Reine Demo-/Testversionen mit
„Alle Rechte vorbehalten" sind für den produktiven Einsatz nicht geeignet.
