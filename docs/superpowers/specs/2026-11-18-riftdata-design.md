# RiftData — Design doc

- **Data**: 2026-11-18
- **Stato**: approvato dall'utente il 2026-11-19
- **Lettore**: sviluppatore web che pianifica la costruzione senza poter consultare l'utente

## Legenda delle decisioni

Ogni decisione è etichettata con la sua origine:

| Etichetta | Significato |
|---|---|
| **[Utente]** | Deciso dall'utente. Non modificare senza un motivo forte. |
| **[Claude]** | Scelta o proposta di Claude, accettata o non contestata dall'utente. Modificabile se emergono ragioni tecniche. |
| **[Costruttore]** | Lasciato esplicitamente a chi costruisce. |

---

## 1. Intento e perché

- **RiftData** è un sito fan sull'esports di League of Legends. [Utente]
- Pubblico: chi vuole consultare squadre, risultati delle partite e statistiche. [Utente]
- Cuore del progetto: **stile visivo + animazioni curate** e **dati**. Il "live" è marginale: solo segnali "partita in corso" e "torneo in svolgimento". [Utente]
- Il **Worlds dell'anno corrente** è sempre al centro. La home cambia da sola lungo la stagione e di anno in anno, includendo durante l'anno le classifiche delle leghe e i seed per il Worlds (corsa al Worlds). [Utente]

## 2. Obiettivi

1. **Worlds corrente al massimo dettaglio** per partita: roster, draft (pick & ban), campioni, oggetti acquistati, oro di squadra e di giocatore anche nel tempo, draghi per squadra, baroni, ecc. Il dettaglio per giocatore esiste solo qui. [Utente]
2. **Leghe durante l'anno**: risultati delle partite e seed per il Worlds occupati dalle squadre. Nessuna profondità ulteriore. [Utente]
3. **Worlds passati** consultabili con focus minore: medie e statistiche di **squadra** (gold diff tra i match, KDA, draghi e baroni). Scopo: leggere l'andamento di una squadra negli anni. [Utente]
4. **Tabelloni di tutte le fasi**: Play-In, fase svizzera, eliminazione diretta; per le edizioni passate anche formati storici (es. gironi). [Utente]
5. **Home stagionale automatica** (vedi §9). [Utente]
6. **Aggiornamento automatico**, senza ripubblicazione manuale. [Utente]
7. **Ottima esperienza da telefono**. [Utente]
8. **Interfaccia in inglese**; nomi di squadre, giocatori e campioni in originale. [Utente]

## 3. Non-obiettivi (v1)

- Analisi per giocatore e draft per i Worlds passati.
- Play-by-play in tempo reale.
- Account utente, commenti.
- Scommesse.
- Altri tornei internazionali (es. MSI): non richiesti.
- Pubblicazione manuale.

## 4. Anti-obiettivi

Esiti da evitare attivamente:

- Sembrare una generica tabella di statistiche: lo stile è il cuore del prodotto.
- Rompersi quando una fonte non ufficiale cambia formato o sparisce.
- Pagine lente o animazioni a scatti su telefono.
- Dover intervenire a mano per aggiornare i dati.

## 5. Vincoli

| Vincolo | Origine |
|---|---|
| Nome: RiftData | [Utente] |
| Codice su GitHub | [Utente] |
| Repository **pubblico** → minuti GitHub Actions illimitati. Se privato (~2000 min/mese gratuiti), ridurre la frequenza degli aggiornamenti (§8.4). | Assunzione [Claude] |
| Costo di hosting zero, nessun server da gestire | [Claude], implicito nell'approccio scelto |
| Policy Riot per contenuti fan: disclaimer nel footer — *"RiftData isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties…"* (testo completo dalla policy Riot) — e nessuna imitazione del branding ufficiale | Obbligo esterno |
| Attribuzione Leaguepedia (licenza CC BY-SA), visibile sul sito | Obbligo esterno |
| Rispetto dei limiti di richieste delle fonti; User-Agent generico | Obbligo esterno |
| `.superpowers/` nel `.gitignore` alla creazione del repo | [Claude] |
| Rispetto di `prefers-reduced-motion` | [Claude] |

## 6. Fonti dati

Riot **non** offre un'API pubblica ufficiale per l'esports: la Riot Developer API copre solo le partite normali. Le fonti sono quindi community o non documentate. Ricerca e scelte: [Claude].

### 6.1 Panoramica

| Fonte | Uso | Copertura | Note |
|---|---|---|---|
| **Leaguepedia** (lol.fandom.com, API Cargo) | Fonte principale | Tornei, squadre, roster, partite e risultati, classifiche, seed e qualificazioni; tabellini finali per game (campioni, ban, oggetti finali, oro, KDA, draghi/baroni per squadra) | CC BY-SA, attribuzione obbligatoria; limiti di richieste |
| **API non ufficiale lolesports.com** | Calendario/eventi; badge live | Partite in programma e in corso | Non documentata |
| **feed.lolesports.com/livestats** (endpoint `window` e `details`) | Dettaglio partite del **solo Worlds corrente** | Fotogrammi ogni 10 s (vedi 6.2) | Non documentato |
| **Data Dragon** (CDN ufficiale Riot) | Icone e nomi di campioni, oggetti, rune | Versionato per patch | — |

### 6.2 Contenuto del feed livestats

- **`window`**
  - Per squadra: `totalGold`, `towers`, `inhibitors`, `barons`, `totalKills`, `dragons` (lista di tipi: ocean, mountain, infernal, cloud, elder…).
  - Per giocatore: `totalGold`, KDA, `creepScore`, `level`.
  - Metadati: `championId`, ruolo.
- **`details`**
  - Per giocatore: `items`, rune (`perkMetadata`), `killParticipation`, `championDamageShare`, `wardsPlaced` / `wardsDestroyed`, altre statistiche.

### 6.3 Regole d'uso del feed (non ufficiale)

1. Usarlo **solo** per le partite del Worlds corrente e per il badge live.
2. Scaricare i dati di ogni partita **una sola volta**, a partita conclusa.
3. Salvarli nel repo: sopravvivono a cambi o chiusura dell'API.

### 6.4 Non ancora verificato

| # | Punto aperto | Impatto se negativo |
|---|---|---|
| 1 | **Accesso a Leaguepedia dalla pipeline.** Un fetch automatico ha ricevuto HTTP 402: forse un blocco dello strumento usato, non dell'API. Verificare se serve un account bot / login. | Manca la fonte principale → valutare il fallback (riga 4). |
| 2 | **Profondità storica del feed livestats**: fino a quanti anni indietro esistono i fotogrammi. In particolare: il **Worlds 2026** (concluso prima del lancio) è recuperabile a posteriori? | **[Utente]** Se no, il Worlds 2026 parte con i tabellini finali di Leaguepedia (campioni, ban, oggetti finali, oro finale, KDA, draghi, baroni) **senza grafici nel tempo**. La pagina partita deve quindi funzionare in due livelli: "tabellino finale" e "tabellino + timeline". Le pagine complete debuttano col Worlds 2027. |
| 3 | **Calendario lolesports leggibile dal browser** (header `x-api-key` pubblico, CORS). | Se no, serve un piccolo proxy (es. funzione serverless) per il badge live. |
| 4 | **Fallback CSV Oracle's Elixir** (statistiche per game; uso non commerciale con attribuzione). | Da valutare solo se Leaguepedia non è accessibile. |

## 7. Approcci considerati

| Approccio | Pro | Contro | Esito |
|---|---|---|---|
| **A. Astro statico + GSAP** | Pagine pre-generate dai dati nel repo; JS solo dove serve (isole: grafici, tabelloni, badge live); velocissimo; animazioni che non aspettano i dati; costo zero; nessun server; dati versionati | Ogni aggiornamento dati = rebuild + deploy (automatico, pochi minuti) | **Scelto** [Utente, su proposta di Claude] |
| B. Next.js con ISR su Vercel | Navigazione da app; aggiornamento continuo | Più JS, più complessità, lock-in sull'hosting; il vantaggio principale qui serve poco | Scartato |
| C. SvelteKit statico | Simile ad A; buone transizioni integrate | Ecosistema più piccolo; A ottiene lo stesso con meno JS | Scartato |
| Flutter Web | — | Primo caricamento pesante, testo poco indicizzabile, poco controllo da "sito web" | Scartato |

## 8. Architettura scelta

L'utente ha accettato l'approccio A e delegato a Claude tecnologie e librerie. Tutto in questa sezione è **[Claude]** salvo diversa indicazione.

### 8.1 Stack

| Area | Scelta |
|---|---|
| Framework | Astro, output statico |
| Linguaggio | TypeScript (sito e script della pipeline) |
| Animazioni | GSAP (oggi gratuito con tutti i plugin: ScrollTrigger, SplitText) |
| Scroll fluido | Lenis |
| Transizioni tra pagine | View Transitions di Astro |
| Grafici | D3, su misura: andamento oro / gold diff, linea temporale draghi, tabelloni se utile |
| Hosting | Statico gratuito: Cloudflare Pages (preferito) o Netlify — **[Costruttore]** |
| CSS | **[Costruttore]** |

### 8.2 Pipeline dati

1. Un workflow **GitHub Actions** programmato si avvia.
2. Script TypeScript scaricano da Leaguepedia e lolesports (e livestats per le partite concluse del Worlds corrente).
3. I dati vengono normalizzati in **file JSON salvati nel repo**.
4. Si applicano i **file di override** manuali (correzioni quando una fonte sbaglia o cambia formato).
5. Se i JSON sono cambiati: commit, build Astro, deploy sull'hosting statico.
6. Se nulla è cambiato: il workflow si ferma.

### 8.3 Badge live

- `LIVE · GAME N` e "torneo in corso" sono letti **dal browser del visitatore** in tempo reale, indipendenti dal rebuild.
- Se la fonte fallisce, il badge **sparisce in silenzio**; il resto del sito non ne risente.
- Eventuale proxy: dipende dal punto aperto §6.4-3.
- Perimetro del live nel browser [Claude]: badge + punteggio della serie in corso (es. 2–1). Tutto il resto (grafici, tabellini, game appena concluso) arriva dal rebuild: un ritardo fino a 30 minuti è accettabile.
- Il badge compare sulle partite in corso di **qualsiasi** competizione mostrata (Worlds e leghe) [Claude]: stessa fonte calendario, costo marginale.

### 8.4 Frequenza di aggiornamento

| Periodo | Frequenza | Origine |
|---|---|---|
| Fuori dal Worlds | Ogni 6 ore | [Claude], accettata |
| Worlds, giorni di partita | Ogni 15–30 minuti | [Claude], accettata |
| Su richiesta | Pulsante "aggiorna ora" nell'interfaccia di GitHub Actions (`workflow_dispatch`). **Nessun** pulsante sul sito pubblico, quindi nessun backend. | [Claude], accettata |

Con repository privato, ridurre la frequenza per restare nei minuti gratuiti (§5).

## 9. Logica stagionale della home

Fasi proposte da Claude; confine tra Worlds precedente e successivo deciso dall'utente. La home attraversa quattro fasi:

| # | Fase | Contenuto della home |
|---|---|---|
| 1 | Da ~6 mesi prima dell'inizio del prossimo Worlds → qualificazioni chiuse | Corsa al Worlds: classifiche delle leghe e posti già assegnati |
| 2 | Qualificazioni chiuse → inizio Worlds | Squadre qualificate per seed e regione |
| 3 | Durante il Worlds | Tabelloni delle fasi + partite di oggi |
| 4 | Dalla finale → ~6 mesi prima dell'inizio del Worlds successivo | Focus sul Worlds **appena concluso**: campione, racconto del torneo, tabelloni e partite |

Regole:

- **[Utente]** Il focus passa al Worlds in arrivo circa **6 mesi prima della sua data di inizio**. Fino ad allora la home resta sul Worlds precedente (fase 4), anche se le leghe sono già iniziate.
- **[Claude]** Se la data d'inizio del prossimo Worlds non è ancora nota nei dati, la home resta in fase 4. La soglia di 6 mesi è un parametro di configurazione.
- **[Claude]** Le pagine **Leagues** restano sempre aggiornate tutto l'anno, a prescindere dalla fase della home.
- La fase è **derivata dai dati** (date dei tornei, stato delle qualificazioni), mai da date fisse.
- Il passaggio d'anno è automatico.
- Le leghe che qualificano al Worlds e il numero di seed si leggono dai dati, **non sono cablati nel codice**.

## 10. Sezioni del sito

Proposta di Claude, accettata. Etichette in inglese.

| Sezione | Contenuto |
|---|---|
| **Worlds {anno}** (home) | Home stagionale (§9). Da qui si apre ogni partita del Worlds corrente con il dettaglio completo: draft, oggetti e build nel tempo, rune, oro nel tempo per giocatore e squadra, gold diff, draghi per tipo e ordine, baroni, torri, KDA, CS, danni, ward. |
| **Leagues** | Per ogni lega: risultati, classifica, seed occupati. |
| **Teams** | Scheda squadra: roster attuale e andamento ai Worlds negli anni (medie di squadra: gold diff, KDA, draghi, baroni). |
| **Worlds History** | Edizioni passate: vincitori, tabelloni, statistiche di squadra. |

Regole aggiuntive [Claude]:

- **Dettaglio di un Worlds che smette di essere corrente**: le pagine partita per-giocatore già salvate restano online in modo permanente per quell'anno (i dati sono nel repo, costo zero). Il vincolo "dettaglio solo per il corrente" riguarda cosa si **raccoglie**, non cosa si cancella. Le edizioni senza dati di dettaglio mostrano solo le statistiche di squadra.
- **Identità delle squadre nel tempo**: una squadra è la stessa organizzazione attraverso i cambi di nome, seguendo la catena di rinomine di Leaguepedia (es. SK Telecom T1 → T1). Uno slot venduto a un'altra organizzazione è una squadra diversa. Eccezioni gestibili con i file di override.

Struttura URL e layout delle pagine diverse dalla home: **[Costruttore]** (con pagine per anno, coerenti con la regola sul dettaglio permanente).

## 11. Stile visivo e animazioni

Bozza di riferimento: `G:\HOME\Repos\lol-esports-fansite\.superpowers\brainstorm\853-1795041992\content\visual-style-v2.html`

### 11.1 Direzione

**[Utente]**: direzione **"B · Broadcast"** (grafica da diretta TV esports) per tutto il sito, più il **badge live** della direzione "A · Hextech".

### 11.2 Elementi Broadcast

| Elemento | Specifica |
|---|---|
| Fondo | Quasi nero `#07070a` con sottile motivo a linee diagonali |
| Accento dati | Azzurro neon `#00e5ff` con bagliore: titoli e dati |
| Accento fasi | Rosa-rosso `#ff2e63`: fasi ed etichette |
| Colori squadre | Gradienti laterali blu `#1b2cff` e rosa-rosso `#ff2e63` nei punteggi |
| Display | Barlow Condensed 800, corsivo, maiuscolo |
| Testo | Inter |
| Forme | Tagli diagonali (`clip-path`); punteggio su riquadro bianco inclinato |
| Logo | Testuale: "RIFT" bianco + "DATA" azzurro, condensato corsivo |

### 11.3 Badge live (da Hextech)

- Bordo turchese `#0ac8b9`, bagliore pulsante, pallino lampeggiante.
- Carattere condensato (coerente con Broadcast).
- Il turchese è **riservato esclusivamente al live**: non usarlo altrove.

### 11.4 Animazioni

Proposta di Claude, non contestata.

- Carattere: veloci e decise.
- Grafici che si disegnano.
- Numeri che scorrono fino al valore.
- Transizioni tra pagine con tagli diagonali.
- Con `prefers-reduced-motion`: animazioni attenuate.
- Fluidità su telefono come requisito, non come rifinitura (§4).

## 12. Cosa resta al costruttore

- Approccio CSS.
- Schema JSON dei dati normalizzati e degli override.
- Struttura degli URL.
- Layout delle pagine oltre alla home.
- Design visivo dei tabelloni, dentro lo stile Broadcast.
- Hosting: Cloudflare Pages (preferito) o Netlify.
- Provenienza dei loghi delle squadre.
- Numero di edizioni passate incluse: idealmente tutte dal 2011, profondità limitata dai dati disponibili.
- Se mostrare i playoff delle leghe come tabellone, riutilizzando il componente dei tabelloni.

## 13. Rischi e primi passi consigliati

### 13.1 Rischi

| Rischio | Mitigazione |
|---|---|
| Leaguepedia non accessibile dalla pipeline (HTTP 402) | Spike iniziale; se serve, account bot Fandom **creato dall'utente**, che inserisce lui stesso le credenziali nei secrets di GitHub [Utente]. Se resta inaccessibile: ridurre il numero di edizioni passate piuttosto che aggiungere fonti più fragili [Claude]; fallback Oracle's Elixir per le statistiche per game (§6.4-4) |
| Cambio o chiusura delle API non ufficiali lolesports | Dati di partita salvati una volta nel repo; badge che sparisce in silenzio; file di override |
| Calendario non leggibile dal browser (CORS / chiave) | Piccolo proxy serverless |
| Formati di torneo che cambiano negli anni (gironi, svizzera, Play-In) | Modello dei tabelloni generico per tipo di fase, non legato a un solo formato |
| Limiti di richieste delle fonti | Download incrementali; nessun nuovo download di partite già salvate |
| Repository privato → minuti Actions limitati | Ridurre la frequenza (§8.4) |
| Animazioni pesanti su telefono | Test su dispositivi reali fin dai primi componenti; JS limitato alle isole |

### 13.2 Lancio e account

- Nessuna data di lancio fissata [Utente]. Al lancio la home sarà quasi certamente in fase 4 sul Worlds 2026.
- Account e credenziali (repository GitHub, Cloudflare/Netlify, eventuale bot Fandom) li fornisce l'utente, solo se strettamente necessari [Utente]. Le inserisce lui stesso nei secrets di GitHub con la guida di Claude, senza passarle in chat [Claude].

### 13.3 Primi passi

1. **Spike di verifica** dei tre punti aperti principali (§6.4):
   1. accesso a Leaguepedia dalla pipeline (GitHub Actions);
   2. profondità storica del feed livestats;
   3. lettura del calendario lolesports dal browser.
2. In base all'esito, confermare le fonti o attivare il fallback.
3. **Solo dopo**, fissare lo schema dati.
4. Creare il repo con `.superpowers/` nel `.gitignore`.
