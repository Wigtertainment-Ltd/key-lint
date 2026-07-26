# KeyLint — Projektzusammenfassung (Briefing für Landing Page)

> Produktname: **KeyLint** (Repository/Arbeitstitel bisher: `Check-i18n`)

> Diese Datei ist als Kontext-Vorlage gedacht: Einfach komplett in einen neuen Chat einfügen mit dem Auftrag
> „Erstelle mir auf Basis dieses Briefings eine Landing Page".

---

## 1. Kurzbeschreibung (Elevator Pitch)

**KeyLint** ist ein Desktop-Tool (Angular + Electron), das lokale Frontend-Projekte auf
Übersetzungs-Konsistenz prüft. Es scannt Quellcode und Übersetzungsdateien, findet fehlende,
ungenutzte und dynamisch aufgelöste i18n-Keys und macht das Ergebnis in einem
Dashboard mit KPI-Karten, Trend-Chart und durchsuchbaren Ergebnistabellen sichtbar.
Gefundene Lücken lassen sich direkt in der App befüllen — ohne Editor-Wechsel.

**One-Liner:** „Der Linter für deine Übersetzungen."

**Name-Rationale (für Logo & Tonalität):** *Key* = Übersetzungs-Key, *Lint* = die vertraute
Developer-Metapher für automatisierte Qualitätsprüfung. Wichtig: KeyLint prüft nicht nur,
es repariert auch — die Auto-Fix-Fähigkeit sollte bewusst als „Lint **and** Fix" positioniert werden.
Logo-Richtung: Schlüssel kombiniert mit Häkchen oder Prüfmarke.

---

## 2. Zielgruppe

- Frontend-Entwickler:innen und Teams mit mehrsprachigen Angular-Anwendungen
- Tech Leads, die i18n-Qualität vor Releases absichern wollen
- Übersetzungs-/Lokalisierungs-Verantwortliche in Produktteams
- Agenturen mit vielen parallelen Kundenprojekten (Recent-Projects-Workflow)

---

## 3. Problem, das gelöst wird

- Übersetzungs-Keys werden im Code verwendet, existieren aber in keiner Sprachdatei → leere UI-Texte oder rohe Key-Strings in Produktion
- Alte Keys bleiben in `en.json` & Co. liegen und blähen Sprachdateien auf
- Sprachen laufen auseinander: `de.json` hat 340 Keys, `fr.json` nur 280
- Dynamisch zusammengesetzte Keys (`'prefix.' + type`) sind statisch nicht prüfbar und werden schlicht übersehen
- Manuelle Kontrolle über mehrere Sprachdateien hinweg ist fehleranfällig und zeitraubend

---

## 4. Kernfunktionen (aktuell implementiert)

| Feature | Beschreibung |
| --- | --- |
| **Projektauswahl** | Auswahl eines lokalen Projektordners über den nativen Electron-Dialog, inkl. Liste zuletzt genutzter Projekte |
| **Automatische Framework-Erkennung** | Adapter-Registry erkennt den Projekttyp und wählt den passenden Scan-Adapter (aktuell: Angular / ngx-translate, Transloco-ähnliche Patterns) |
| **Scan mit Live-Fortschritt** | Eigene Progress-Seite zeigt die aktuelle Scan-Stufe an |
| **Dashboard** | KPI-Karten (Gesamt-Keys, verwendet, ungenutzt, fehlend, dynamisch) plus Trend-Balken über bisherige Scans mit Tages-Drilldown |
| **Ergebnisübersicht** | Filterbare und durchsuchbare Findings-Liste (alle / fehlend / ungenutzt / dynamisch / verwendet) mit Detail-Panel, Code-Snippet, Datei-Pfad, Zeile und Copy-Funktion |
| **Translation-Key-Matrix** | Tabelle aller Keys über alle erkannten Sprachen hinweg, inkl. Anzeige fehlender Werte pro Locale |
| **Direktes Nachpflegen** | Fehlende Übersetzungen können im Modal eingetragen und direkt in die JSON-Sprachdatei geschrieben werden (verschachtelte Keys werden korrekt angelegt) |
| **Historie** | Persistierte Projekt-Historie: Scan gestartet, Scan abgeschlossen, Übersetzungs-Key hinzugefügt — als Basis für Trends |
| **Dokumentation** | In-App-Seite, die Scan-Regeln und Vorgehen erklärt |
| **Dark/Light Mode** | Theme-Service mit Persistenz und Respektierung von `prefers-color-scheme` |

---

## 5. Was genau geprüft wird (Finding-Typen)

| Status | Bedeutung |
| --- | --- |
| `used` | Key ist definiert und wird im Code verwendet |
| `unused` | Key existiert in der Sprachdatei, wird aber nirgends verwendet |
| `missing-in-language` | Key wird verwendet bzw. in anderen Sprachen gepflegt, fehlt aber in dieser Sprache |
| `extra-in-language` | Key existiert nur in einer Sprache, nicht in der Referenzsprache |
| `dynamic-uncertain` | Key wird dynamisch zusammengesetzt → statisch nicht eindeutig auflösbar, manuelle Prüfung nötig |

Severity-Stufen: `info`, `warning`, `error`. Jedes Finding trägt Evidence-Daten
(Dateipfad, Zeile, Spalte, Snippet, Match-Typ).

---

## 6. Wie es funktioniert (3 Schritte für die Landing Page)

1. **Projekt auswählen** — lokalen Ordner per nativem Dialog wählen, KeyLint erkennt das Framework automatisch.
2. **Scannen lassen** — Quellcode (`*.ts`, `*.html`) und Sprachdateien (`**/i18n/**/*.json`, `locales/**`) werden geparst und abgeglichen.
3. **Ergebnisse beheben** — Dashboard, Findings und Key-Matrix prüfen, fehlende Übersetzungen direkt in der App ergänzen.

---

## 7. Alleinstellungsmerkmale / Verkaufsargumente

- **100 % lokal & offline** — kein Upload, kein Cloud-Dienst; Quellcode verlässt den Rechner nicht (starkes Argument für Enterprise & DSGVO)
- **Kein Setup im Zielprojekt** — keine Config-Datei, kein CLI-Flag, keine Dependency im geprüften Repo
- **Erkennt auch dynamische Keys** — statt sie stillschweigend zu ignorieren, werden sie als „prüfenswert" ausgewiesen
- **Fixen statt nur Melden** — fehlende Werte direkt aus dem Tool heraus in die JSON-Datei schreiben
- **Adapter-Architektur** — Angular ist der erste Adapter, weitere Frameworks sind über ein klares Interface erweiterbar
- **Historie & Trend** — Fortschritt der i18n-Qualität über die Zeit sichtbar
- **Performance-Guardrails** — Limits für Dateianzahl (25.000) und Dateigröße (2 MB), sinnvolle Exclude-Defaults (`node_modules`, `dist`, `coverage`, …)

---

## 8. Technologie-Stack

- Angular 18 (Standalone Components, Router mit Layout-Child-Routes)
- Electron 31 (Desktop-Shell, Dateisystem-Zugriff über `@electron/remote`)
- TypeScript 5.5, SCSS
- PrimeNG + PrimeFlex, `@wigtertainment-ltd/comp-lib`
- `@ngx-translate/core` für die App-eigene Lokalisierung
- Jasmine + Karma für Unit-Tests
- Architektur: `core/` (Modelle, Adapter-Interfaces, Config) · `adapters/` (Framework-Adapter) · `shared/services/` (Orchestrierung, Historie, Electron-Bridge) · `pages/` (Routen-Seiten)

---

## 9. Roadmap / „Coming soon"-Sektion für die Landing Page

- Weitere Framework-Adapter (React/i18next, Vue/vue-i18n, Svelte)
- Weitere Übersetzungsformate: YAML, XLIFF, PO (Interface ist bereits vorbereitet)
- Report-Export (JSON / Markdown / CSV) für CI- und Doku-Workflows
- CI-Integration mit Schwellenwerten (Build bricht bei zu vielen fehlenden Keys)
- Machine-Translation-Vorschläge beim Nachpflegen fehlender Werte

---

## 10. Design-System (bereits definiert in `DESIGN.md`)

**Theme-Name:** „Technical Precision" — Developer-First, minimalistisch, datendicht, wirkt wie eine Erweiterung der IDE.

- **Primärfarbe:** Deep Indigo `#2A14B4` (Container `#4338CA`)
- **Sekundär:** Emerald `#006C4A` · **Tertiär:** Amber/Orange `#5C2F00` · **Error:** `#BA1A1A`
- **Hintergrund/Surface:** `#FCF8FF` hell, `#1B1B23` als On-Surface-Text
- **Typografie:** *Inter* für UI (Body 14 px, Display 32 px/700), *JetBrains Mono* für technische Inhalte wie Keys, Pfade und Code (13 px)
- **Radien:** 4 px Standard (soft/boxy), Badges 8 px, Pills `full`
- **Elevation:** flach — Tonwerte und 1-px-Outlines statt starker Schatten; aktiver Zustand über 2 px farbige Kante links
- **Layout:** Desktop-first, max. Container 1440 px, Sidebar 280 px, 4-px-Baseline-Grid
- **Komponenten-Signature:** Data-Table mit Sticky Header und Status-Badges, KPI-Karten mit großer Zahl und 1-px-Rahmen, Inline-Code auf hellgrauem Hintergrund

---

## 11. Vorschlag für die Landing-Page-Struktur

1. **Hero** — Headline + Sub-Headline, Screenshot/Mockup des Dashboards, CTA „Download für Windows/macOS/Linux"
2. **Problem-Sektion** — 3–4 Pain Points aus Abschnitt 3, visuell als Karten
3. **So funktioniert's** — 3 Schritte aus Abschnitt 6
4. **Feature-Grid** — 6–8 Kacheln aus Abschnitt 4, jeweils Icon + Kurztext
5. **Finding-Typen** — kompakte Tabelle/Badge-Reihe aus Abschnitt 5, mit den semantischen Statusfarben
6. **Warum KeyLint** — USP-Liste aus Abschnitt 7, mit „100 % lokal, kein Upload" als Hero-Argument
7. **Screenshots / Produkt-Tour** — Dashboard, Ergebnisübersicht mit Detail-Panel, Key-Matrix, Historie
8. **Tech- & Kompatibilitäts-Sektion** — unterstützte Frameworks/Formate heute vs. Roadmap
9. **FAQ** — Datenschutz, unterstützte Projekte, Konfigurierbarkeit, Performance bei großen Repos
10. **Footer-CTA** — Download + Link zu GitHub/Doku

**Tonalität:** sachlich, präzise, entwicklernah — keine Marketing-Superlative, dafür konkrete Zahlen und echte Code-/Key-Beispiele.

---

## 12. Verwendbare Beispiel-Texte

- Hero-Headline: **„Deine Übersetzungen. Endlich lückenlos."**
- Alternativ: **„Fehlende i18n-Keys finden, bevor sie in Produktion gehen."**
- Namensnah: **„KeyLint. Lintet deine Keys, nicht deine Nerven."**
- Sub-Headline: „KeyLint scannt dein Angular-Projekt lokal, gleicht Code und Sprachdateien ab und zeigt dir in Sekunden, welche Übersetzungs-Keys fehlen, tot sind oder sich nicht statisch auflösen lassen."
- Auto-Fix-Claim: „Nicht nur meckern. Reparieren."
- Datenschutz-Claim: „Läuft vollständig auf deinem Rechner. Kein Upload, kein Account, kein Cloud-Dienst."
