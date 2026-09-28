# Repertoire — openingen bouwen, controleren en trainen

Een webapp in de geest van Chessbook, maar **zonder zettenlimiet**, met **meerdere spelers** (bv. ouder en kind) en
met alles lokaal in je browser. Je bouwt per profiel openingsrepertoires op, ziet in één oogopslag welke takken je
hebt, snoeit wat je niet nodig hebt, controleert met een engine en met de Lichess-database wat er op jouw
ratingniveau echt gespeeld wordt, en traint met spaced repetition (FSRS).

## Wat zit erin

| Scherm | Wat je er doet |
| --- | --- |
| **Overzicht** | Repertoires van het actieve profiel, met aantallen zetten/lijnen en wat er vandaag te herhalen is. |
| **Bouwen** | Bord + huidige lijn. Zetten die je speelt zijn eerst een *voorstel* (blauw gestippeld); met **Opslaan** (Enter) komen ze in je repertoire, met **Verwerpen** (Esc) niet. Daarnaast: je voorbereide zetten in deze stelling (met aantal vervolgzetten, commentaar, ★ hoofdzet, verwijderen), een notitie per stelling, en tabbladen **Lichess-partijen**, **Meesters** en **Engine**. |
| **Boom** | De hele repertoireboom als diagram. Groen = jouw zet, omlijnd = zet van de tegenstander met percentage hoe vaak die gespeeld wordt; lijndikte = populariteit; rode stippel-knopen = **gaten** (vaak gespeeld, niet voorbereid). In- en uitklappen per tak of tot een diepte, markeren van “te herhalen”, “engine-twijfels” en “zeldzame zetten”. Selecteer een knoop en **Snoei tak** (of Delete) — je ziet vooraf hoeveel zetten en trainingskaarten verdwijnen, en alles is ongedaan te maken (Ctrl+Z). |
| **Trainen** | Herhaling met FSRS: elke zet die jíj speelt is een kaartje. Nieuwe zetten worden eerst getoond en later in de sessie overhoord. Daarnaast **Vrij oefenen**: willekeurige lijnen uitspelen zonder dat het meetelt. |
| **Controle** | **Gaten zoeken**: loopt je repertoire af tegen de Lichess-database (ratinggroepen/tempo’s van het profiel) en sorteert ontbrekende antwoorden op hoe vaak je ze gaat tegenkomen, plus een dekkingspercentage. **Engine-controle**: beoordeelt elke eigen zet (?!, ?, ??) met de Lichess cloud-evaluatie of lokaal Stockfish 19. |
| **Instellingen** | Profielen (naam, kleur, ratinggroepen, tempo’s), Lichess-koppeling, PGN-export/-import per repertoire, back-up van alles als JSON. |

Transposities worden herkend: het repertoire is intern een graaf van *stellingen*, dus 1.d4 Pf6 2.c4 e6 en
1.c4 e6 2.d4 Pf6 delen hun vervolg.

## De Lichess-database: hoe de koppeling werkt

Lichess heeft een gratis **Opening Explorer API** (`https://explorer.lichess.org`), dezelfde database als het
“openingsboek” op lichess.org:

```
GET https://explorer.lichess.org/lichess?fen=<FEN>&ratings=1600,1800&speeds=blitz,rapid,classical&moves=20
GET https://explorer.lichess.org/masters?fen=<FEN>
Authorization: Bearer <token>
```

- `ratings` zijn groepen: `0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500`; elke waarde betekent “van hier tot de
  volgende” (1600 = 1600–1799), op basis van de gemiddelde rating van beide spelers. Zo kies je per profiel het
  niveau van je tegenstanders — jouw niveau en dat van je dochter krijgen hun eigen filters.
- `speeds`: `ultraBullet, bullet, blitz, rapid, classical, correspondence`.
- Antwoord: per zet `san`, `uci`, en aantallen `white`/`draws`/`black`, plus de openingsnaam (ECO).
- **Sinds 2026 vraagt Lichess een login** voor de explorer. Deze app doet dat met “Inloggen met Lichess” (OAuth 2
  met PKCE: je logt in op lichess.org zelf, de app krijgt alleen een token zonder extra rechten). Alternatief: maak een
  persoonlijk token zonder rechten op <https://lichess.org/account/oauth/token> en plak het in Instellingen. Het token
  blijft in je browser.
- Lichess vraagt API-gebruikers om één verzoek tegelijk te doen en na een `429` een minuut te wachten; de app doet
  dat en bewaart antwoorden 30 dagen in een cache (IndexedDB), zodat terugbladeren en de boom niets opnieuw ophalen.

Engine: eerst `https://lichess.org/api/cloud-eval?fen=…&multiPv=3` (vooraf berekende, diepe Stockfish-evaluaties van
populaire stellingen, geen login nodig). Staat de stelling daar niet in, dan rekent **Stockfish 19 (WASM)** lokaal in
een Web Worker.

## Lokaal draaien

Vereist [Node.js](https://nodejs.org) 22 of nieuwer.

```bash
npm install     # installeert ook Stockfish en kopieert het naar public/stockfish
npm run dev     # open de getoonde URL (http://localhost:5173)
npm test        # unit-tests (repertoiregraaf, PGN, SRS)
npm run build   # productiebuild in dist/
```

## Online zetten (GitHub Pages)

De workflow in `.github/workflows/deploy.yml` test en bouwt bij elke push en publiceert `main` naar GitHub Pages.
Eenmalig aanzetten: **Settings → Pages → Source: GitHub Actions**. De app staat dan op
`https://<gebruiker>.github.io/<repo>/`. (Op een gratis GitHub-account kan Pages alleen voor publieke repo’s; je
gegevens staan niet in de repo maar in je browser, dus dat is geen privacyprobleem. Netlify of Cloudflare Pages
werken ook: build-commando `npm run build`, map `dist`.)

## Je gegevens

Alles staat in de browser (IndexedDB) van het apparaat waarop je de app gebruikt: geen account, geen server, geen
limiet. Daardoor:

- Maak af en toe een **back-up** (Instellingen → Back-up downloaden) en bewaar die bijvoorbeeld in je cloudmap.
- Wil je dochter op haar eigen tablet trainen? Zet de back-up daar terug, of exporteer alleen haar repertoire als PGN
  en importeer dat op haar apparaat. (Automatische synchronisatie tussen apparaten staat hieronder bij de ideeën.)
- **Van Chessbook overstappen**: exporteer je repertoire in Chessbook als PGN en kies bij *Nieuw repertoire* het
  PGN-bestand. Varianten, commentaar en meerdere hoofdstukken worden samengevoegd.

## Hoe het in elkaar zit

```
src/lib/chess.ts        chessops-helpers: FEN-sleutels (zonder zetentellers → transposities), SAN/UCI, rokade
src/lib/repertoire.ts   datamodel en pure bewerkingen: toevoegen, verwijderen + opruimen, boom, pad, statistieken
src/lib/srs.ts          FSRS-kaarten (ts-fsrs), trainingswachtrij in boomvolgorde
src/lib/pgn.ts          PGN-import met varianten, export als één partij met varianten
src/lib/lichess.ts      Opening Explorer, cloud-eval, OAuth PKCE, wachtrij + cache
src/lib/engine.ts       Stockfish-worker (UCI), MultiPV
src/lib/evaluate.ts     cloud eerst, lokaal als terugval
src/lib/audit.ts        gatenanalyse (dekking) en engine-controle
src/lib/store.ts        app-state (zustand), undo/redo, opslag in IndexedDB, back-up
src/components/         React-schermen: BuildView, TreeView, TrainView, AuditView, HomeView, SettingsView
```

Keuzes die de rest bepalen:

- **Eén kaart per eigen zet** (stelling waarin jij aan zet bent → jouw zet). Zetten van de tegenstander zijn geen
  kaarten maar de context waarin je overhoord wordt. Heb je in een stelling meer dan één eigen zet, dan waarschuwt
  de app; bij trainen is elk ervan goed.
- **Dekking** = 1 − (kans dat een partij een onvoorbereide zet van de tegenstander tegenkomt vóór je lijn eindigt),
  waarbij de kans per zet uit de Lichess-database komt. Een lijn die gewoon ophoudt telt niet als gat maar staat apart
  onder “lijnen die vroeg eindigen”.
- **FSRS** in plaats van SM-2: modernere planning (ook in Anki), ~90% gewenste onthoudkans.

## Ideeën voor later

- Synchronisatie tussen apparaten (bijv. via een eigen kleine backend of een gedeelde map), zodat ouder en kind elk
  op hun eigen apparaat werken.
- Installeerbaar als app en offline te gebruiken (PWA).
- “Train alleen deze tak” vanuit de boom; importeren direct via een Lichess-studie-URL.
- Eigen partijen (van Lichess) naast je repertoire leggen: waar week je af, waar week de tegenstander af?

## Licentie

De app gebruikt [chessground](https://github.com/lichess-org/chessground), [chessops](https://github.com/niklasf/chessops)
en [Stockfish.js](https://github.com/nmrugg/stockfish.js), alle drie GPL-3.0. Voor eigen gebruik maakt dat niets uit;
wie de app publiceert of verspreidt, verspreidt dat onder GPL-3.0.
