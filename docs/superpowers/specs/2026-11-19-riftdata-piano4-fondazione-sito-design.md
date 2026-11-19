# RiftData — Piano 4: fondazione del sito e home provvisoria — Design

- **Data**: 2026-11-19
- **Stato**: bozza, in attesa di approvazione
- **Spec generale**: [RiftData — Design doc](2026-11-18-riftdata-design.md). Questo documento lo integra solo per il Piano 4. Conflitto: vale lo spec generale, salvo le decisioni marcate qui.
- **Etichette**: come nello spec generale — **[Utente]**, **[Claude]**, **[Costruttore]**.
- **Mockup di riferimento**: `G:\HOME\Repos\RiftData\.superpowers\brainstorm\853-1795041992\content\visual-style-v2.html`.
  - Fuori da git: passarne il percorso a chi lavora in un worktree o come subagent.
  - Etichette in italiano: segnaposto. Il sito è in inglese.

## 1. Intento

- Costruire la base di tutte le pagine: progetto Astro, design system Broadcast, layout, footer, transizioni, animazioni. [Claude, roadmap accettata]
- Chiudere il piano con una **home provvisoria che mostra i dati veri del Worlds 2026**, non con una vetrina su dati finti. [Utente]
- Motivi: [Utente, su proposta di Claude]
  - vedere presto lo stile vero;
  - scoprire i casi reali dei dati (nomi lunghi, squadre da decidere, statistiche mancanti);
  - verificare la fluidità su telefono, requisito dello spec (§4, §11.4).
- Home provvisoria = punto di partenza. Il Piano 5 la sostituisce con la home stagionale e ne riusa i componenti. [Utente]

## 2. Obiettivi

1. Progetto Astro statico nello stesso repo e nello stesso `package.json` della pipeline.
2. Design system Broadcast (spec §11.2): token di colore, font, forme, motivo di fondo.
3. Layout comune: intestazione con logo e menu, footer con disclaimer Riot e attribuzione Leaguepedia.
4. Home provvisoria costruita dai JSON di `data/`, validati con gli schemi esistenti.
5. Animazioni GSAP + Lenis e View Transitions di Astro, attenuate con `prefers-reduced-motion`.
6. Pagina 404 nello stesso stile.
7. Sito apribile dal telefono sulla rete di casa.

## 3. Non-obiettivi

- Logica stagionale della home (Piano 5).
- Tabellone grafico delle fasi, pagina partita, grafici D3 (Piano 6).
- Pagine Leagues, Teams, Worlds History (Piano 7).
- Badge live e uso del turchese `#0ac8b9` (Piano 8).
- Deploy, workflow di build automatica, CI dei test (Piano 9).
- Loghi delle squadre e icone dei campioni.

## 4. Anti-obiettivi

- Home simile a una tabella di statistiche generica (spec §4).
- Animazioni a scatti o pagina lenta su telefono.
- Valori di colore, font o dimensioni sparsi nei componenti invece che nei token.
- Anno, edizione o squadre cablati nel codice.
- Logica di calcolo nei file `.astro`.

## 5. Vincoli

| Vincolo | Origine |
|---|---|
| Interfaccia in inglese; nomi di squadre e campioni in originale | Spec §2.8 |
| Disclaimer Riot completo nel footer; nessuna imitazione del branding ufficiale | Spec §5 |
| Attribuzione Leaguepedia CC BY-SA visibile sul sito | Spec §5 |
| Rispetto di `prefers-reduced-motion` | Spec §5 |
| Turchese `#0ac8b9` riservato al live: non usarlo in questo piano | Spec §11.3 |
| Astro 7 richiede Node ≥ 22.23.4. `.nvmrc` resta `22` | Verifica [Claude] |
| TypeScript 7 resta nel repo. `@astrojs/check` supporta solo TypeScript ≤ 6: non si installa | Verifica [Claude] |
| Branch `develop`; il push lo fa l'utente con GitHub Desktop | Prassi del progetto |

## 6. Approcci considerati

### 6.1 Cosa mostra la fine del piano

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| A. Base + pagina vetrina su dati finti | Stile rifinito senza distrazioni | Ripete il mockup; i problemi dei dati veri emergono tardi | Scartata |
| B. Base + home provvisoria su dati veri del Worlds 2026 | Collaudo reale di dati, componenti e prestazioni | Una pagina da sostituire nel Piano 5 | **Scelta** [Utente] |

### 6.2 CSS

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| CSS nativo: token in custom properties + stili scoped di Astro | Adatto a uno stile su misura (clip-path, bagliori, gradienti); token leggibili anche da D3 e GSAP; zero dipendenze | Nessuna utility pronta | **Scelta** [Claude] |
| Tailwind | Prototipazione veloce | Quasi ogni valore sarebbe arbitrario: vantaggio perso | Scartata |
| Sass / CSS Modules | — | Nulla che il CSS nativo non copra già | Scartata |

### 6.3 Controllo dei tipi

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| TypeScript 7; logica in moduli `.ts` controllati da `tsc` e testati; `.astro` solo struttura | Nessun cambio al codice esistente; logica testabile | I file `.astro` non hanno controllo dei tipi finché `@astrojs/check` non supporta TS 7 | **Scelta** [Claude] |
| Scendere a TypeScript 6 nel repo | `astro check` disponibile | Tocca codice funzionante per un solo controllo | Scartata |

### 6.4 Prova su telefono

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| Server di sviluppo esposto sulla rete locale | Nessun account, nessuna pubblicazione | Solo sulla rete di casa; Windows può chiedere il permesso del firewall | **Scelta** [Claude] |
| Deploy anticipato su Cloudflare Pages | URL raggiungibile ovunque | Richiede account e secrets ora; anticipa il Piano 9 | Scartata |

## 7. Design

### 7.1 Struttura del codice [Claude]

Radice Astro: `src/`. `src/data/schema/` esiste già e resta dov'è.

| Percorso | Responsabilità |
|---|---|
| `src/pages/index.astro` | Home provvisoria: compone i componenti, nessuna logica |
| `src/pages/404.astro` | Pagina non trovata |
| `src/layouts/BaseLayout.astro` | `<head>`, font, intestazione, footer, View Transitions, avvio animazioni |
| `src/components/layout/` | `SiteHeader`, `SiteFooter`, `Logo` |
| `src/components/broadcast/` | Componenti di stile riusabili (§7.4) |
| `src/components/home/` | Sezioni della home provvisoria |
| `src/styles/tokens.css` | Token di design (§7.3) |
| `src/styles/global.css` | Reset, tipografia di base, motivo di fondo, focus visibile |
| `src/lib/data/` | Lettura e validazione dei JSON di `data/`; scelta dell'edizione |
| `src/lib/home/` | Costruzione del modello della home a partire da un'edizione |
| `src/lib/format/` | Formattazione: nomi squadra, date, numeri, punteggi |
| `src/scripts/motion/` | Lenis, rivelazioni GSAP, contatori, gestione reduced-motion |

- Moduli piccoli, una responsabilità ciascuno.
- `src/lib/`: TypeScript puro, senza dipendenze da Astro, testato con Vitest.
- File `.astro`: ricevono dati già pronti e li mostrano.

### 7.2 Dati [Claude]

1. Alla build si leggono `data/worlds/*.json` e `data/teams.json`.
2. Ogni file passa da `EditionSchema` / `TeamsFileSchema`. Dato non valido → build fallita, con messaggio che indica file e campo.
3. Edizione mostrata: **la più recente con stato `completed`**.
   - Nessuna `completed`: la più recente in assoluto.
   - Nessun anno cablato.
   - Risultato attuale: Worlds 2026.
4. Nome squadra:
   - Forma estesa: `name` senza la disambiguazione Leaguepedia tra parentesi finale (`LYON (2024 American Team)` → `LYON`).
   - Forma compatta: `short`; se manca, la forma estesa.
   - Id assente da `teams.json`: si mostra l'id. Caso improbabile per i test di integrità del Piano 2.
   - Squadra `null`: `TBD`.
5. Date: solo giorno, calcolato in UTC, formato inglese (`Nov 14`).
   - Orari esclusi: inutili per partite concluse.
   - Fuso del visitatore: arriva con il Piano 8.
6. Punteggio `null`: si mostra `–`, nessun vincitore evidenziato.

### 7.3 Token di design [Claude, valori dallo spec §11.2]

| Gruppo | Contenuto |
|---|---|
| Colori | Fondo `#07070a`; testo primario bianco; testo secondario grigio (dal mockup `#9a9aab`, `#8a8a9a`); bordi scuri (`#1c1c24`, `#23232e`); accento dati `#00e5ff`; accento fasi `#ff2e63`; lato squadra 1 `#1b2cff`; lato squadra 2 `#ff2e63` |
| Effetti | Bagliore dell'accento dati; motivo a linee diagonali del fondo |
| Tipografia | Display: Barlow Condensed 800 corsivo maiuscolo (anche 700 per menu ed etichette); testo: Inter 400/600; scala delle dimensioni fluida con `clamp()` |
| Forme | Tagli diagonali come valori `clip-path` riusabili |
| Spaziature e larghezze | Scala di spaziatura; larghezza massima del contenuto; breakpoint |
| Movimento | Durate ed easing condivisi tra CSS e GSAP |

- Nessun valore di colore, font o durata fuori da `tokens.css`.
- Font **self-hosted** (pacchetti Fontsource o API font di Astro, **[Costruttore]**). [Claude]
  - Nessuna richiesta a Google Fonts: prestazioni e privacy.
  - Solo i pesi usati.

### 7.4 Componenti Broadcast [Claude]

| Componente | Cosa fa |
|---|---|
| `PhaseTag` | Etichetta rosa-rossa con taglio diagonale (fase, stato). Testo scuro `#07070a` sul rosa: il bianco del mockup ha contrasto 3,6:1, sotto AA a quella dimensione; il nero arriva a circa 5,7:1. Colore `#ff2e63` invariato [Claude] |
| `ScoreBox` | Punteggio su riquadro bianco inclinato |
| `MatchupBar` | Squadra 1 · punteggio · squadra 2, con gradienti laterali blu e rosa-rosso; vincitore evidenziato |
| `StatCounter` | Numero grande + etichetta; il numero scorre fino al valore |
| `SectionTitle` | Titolo display con parte in accento azzurro |
| `Panel` | Riquadro scuro con bordo, base delle card |

Ogni componente funziona senza JavaScript: contenuto già nell'HTML, animazione solo come miglioramento.

### 7.5 Home provvisoria [Claude, contenuto da opzione B]

Bozza (telefono, dall'alto):

```
RIFTDATA            ☰ / menu
─────────────────────────────
WORLDS
2026                 ← accento azzurro
[ COMPLETED ]        ← PhaseTag

 19        6        98         ← StatCounter
TEAMS   REGIONS   GAMES

┌ CHAMPION ─────────────────┐
│ BILIBILI GAMING           │
│ BLG ▌ 3–1 ▐ GEN   Finals  │ ← MatchupBar
└───────────────────────────┘

PLAY-IN STAGE      [ PLAY-IN ]
 Oct 15  TEAM A  2–1  TEAM B
 ...
SWISS STAGE        [ SWISS ]
 Round 1
 Oct 18  TEAM C  1–0  TEAM D
 ...
KNOCKOUT STAGE     [ KNOCKOUT ]
 Quarterfinals / Semifinals / Finals
 ...
─────────────────────────────
footer: disclaimer Riot · dati Leaguepedia CC BY-SA
```

- **Hero**:
  - nome dell'edizione;
  - `PhaseTag` con lo stato (`Completed` / `Ongoing` / `Upcoming`);
  - tre `StatCounter`: squadre partecipanti, regioni, game giocati. Valori calcolati dai dati (Worlds 2026: 19, 6, 98);
  - regioni: contano solo le squadre con `region` valorizzato (nel 2026 manca a LYON).
- **Card del campione**: solo se l'edizione è `completed` e ha un campione. Contenuto: squadra e finale (ultima partita datata con vincitore).
- **Fasi**: in ordine di `order`.
  - Per fase: nome, tipo, partite raggruppate per `round` nell'ordine dei dati.
  - Ogni partita: `MatchupBar` compatto con data.
- **Tabellone grafico**: no (Piano 6). Eliminazione diretta come elenco per round.
- **Casi vuoti**:
  - fase senza partite: non mostrata;
  - edizione senza partite: hero e messaggio `No matches yet`.
- **Desktop**: stessa sequenza. Hero su due colonne (titolo + card campione) come nel mockup. Partite su più colonne dove lo spazio lo consente.

### 7.6 Layout comune [Claude]

- **Intestazione**:
  - logo testuale "RIFT" bianco + "DATA" azzurro, condensato corsivo;
  - menu: `Worlds {anno}`, `Leagues`, `Teams`, `Worlds History`;
  - voci senza pagina: visibili, attenuate, non cliccabili, con indicazione accessibile `Coming soon`;
  - su telefono il menu non deve causare scroll orizzontale.
- **Footer**:
  - testo completo del disclaimer della policy Riot per i contenuti fan ("Legal Jibber Jabber"), preso dalla pagina pubblica della policy;
  - attribuzione "Data from Leaguepedia, licensed CC BY-SA 3.0" con link.
- **404**: titolo display, messaggio breve, link alla home. Collauda anche le transizioni tra pagine.

### 7.7 Movimento [Claude, carattere dallo spec §11.4]

- Carattere: veloce e deciso.
- Entrata della home:
  - titolo rivelato con SplitText;
  - contatori che scorrono;
  - righe delle partite in entrata a scaglioni durante lo scroll (ScrollTrigger).
- Scroll fluido con Lenis.
- Transizioni tra pagine: View Transitions di Astro con taglio diagonale.
- Animazioni solo su `transform` e `opacity`. Nessuna animazione sposta il layout.
- **Reduced motion**:
  - Lenis disattivato;
  - nessuno SplitText;
  - contatori al valore finale;
  - entrate sostituite da dissolvenze brevi o assenti;
  - transizione tra pagine senza taglio.
- JavaScript solo dove serve: script di movimento caricati dal layout, nessun framework UI client.

### 7.8 Qualità e verifica [Claude]

| Area | Criterio |
|---|---|
| Test | Vitest su `src/lib/` (scelta edizione, modello home, formattazione, casi `TBD` / punteggio `null` / `short` mancante / disambiguazione) |
| Tipi | `npm run typecheck` copre i nuovi moduli `.ts` |
| Build | `npm run build` produce il sito statico senza errori; fallisce se i dati non sono validi |
| Telefono | Script `dev:lan` (server esposto sulla rete locale); prova manuale dell'utente su telefono reale |
| Prestazioni | Lighthouse mobile sulla build: Performance ≥ 90, Accessibility ≥ 90, CLS < 0,1 |
| Accessibilità | Contrasto AA del testo, focus visibile, struttura dei titoli corretta, menu usabile da tastiera |
| Reduced motion | Verifica con l'emulazione del browser |

## 8. Lasciato al costruttore

- Versioni esatte delle dipendenze.
- Fontsource o API font di Astro, purché self-hosted.
- Valori precisi di spaziature, breakpoint, durate ed easing, coerenti con il mockup e lo spec §11.
- Dettaglio visivo dei componenti dentro lo stile Broadcast.
- Disposizione delle partite su desktop.
- Configurazione di `tsconfig.json` per Astro, purché `npm run typecheck` e `npm test` restino verdi.
