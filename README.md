# RiftData

Fan site about League of Legends esports, centered on Worlds. Static Astro site; data versioned in the repo.

## Requirements

- Node 22 (see `.nvmrc`). Astro 7 requires Node >= 22.23.4.
- Run `npm install`.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run dev:lan` | Dev server exposed on the local network, to test from a phone. Windows may ask for firewall permission. |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm test` | Run tests (Vitest) |
| `npm run typecheck` | Type check (`tsc --noEmit`) |
| `npm run ingest` | Update data from Leaguepedia. Options: see [data/README.md](data/README.md) |

## Structure

- `src/pages`: routes
- `src/components`: Astro components
- `src/lib`: pure, tested logic
- `src/scripts/motion`: motion (GSAP, Lenis)
- `src/styles/tokens.css`: single source of colors, fonts, durations
- `data/`: versioned data
- `scripts/pipeline`: ingest pipeline
- `docs/superpowers`: specs and plans

Data schema and pipeline: [data/README.md](data/README.md).

## Legal

RiftData isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

Data from [Leaguepedia](https://lol.fandom.com), licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
