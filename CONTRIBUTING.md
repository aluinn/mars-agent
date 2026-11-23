# Contributing

Thanks for your interest. This is a small project with a strong rule: **be honest about what is real data and what is approximation.** Read [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and [docs/PERCEPTION.md](docs/PERCEPTION.md) before changing terrain, classes or the detector.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need **Node.js 22.12 or newer** (Vitest requires it) and a browser with WebGL 2.

```bash
git clone https://github.com/aluinn/mars-agent.git
cd mars-agent
npm ci
npm run dev        # http://localhost:5173
```

The repo contains everything the app needs at runtime (`public/data/`). You do **not** need Python or the raw USGS downloads unless you are regenerating data.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build (port 4173 with `-- --port 4173`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest, about 1 second) |
| `npm run test:e2e` | Playwright smoke test against the production build (about 2 minutes on a software renderer) |
| `npm run bench` | Frame, capture, detector and path-finding timings (needs `npm run build` and a preview server first; see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |
| `npm run train` | Retrain the terrain classifier and re-evaluate (needs `npm run dev` running; about 12 minutes on a software renderer) |

Before opening a PR run `npm run lint && npm run typecheck && npm test && npm run build`. Run `npm run test:e2e` if you touched rendering, perception or UI.

## Making a change

**Branches:** `type/short-description`, for example `feat/second-landing-site`, `fix/path-corner-cutting`, `docs/perception-diagram`.

**Commits:** [Conventional Commits](https://www.conventionalcommits.org/). Common types: `feat`, `fix`, `docs`, `test`, `perf`, `refactor`, `chore`, `ci`. Keep commits small and focused, one idea each, with a message that says why.

**Pull requests:**

- Keep them small and focused. Link the issue (`Closes #123`).
- Add or update tests for behaviour you change. Core logic (path-finding, energy, detector, habitability, link) has unit tests; follow their style.
- Any number, benchmark or accuracy claim in the docs must be something you measured or can cite. If you cannot verify it, say so instead of writing it.
- Update `CHANGELOG.md` under **Unreleased**.
- CI must pass (lint, typecheck, tests, build, end-to-end).

**Code style:** match the surrounding code. The project uses strict TypeScript (`noUncheckedIndexedAccess` is on, so `!` after an index is normal here). ESLint is the gate; a `.prettierrc.json` and `.editorconfig` are provided for editors, but the existing code is not mass-reformatted, so format only the lines you touch.

## Working with data

- **Never commit raw downloads.** Raw GeoTIFFs and shapefiles are large and may have licence terms. Commit only small derived products in `public/data/`.
- Record every new source in `docs/DATA_SOURCES.md`: product ID, resolution, projection, URL, licence status, and what is real versus approximated.
- Regeneration scripts (`scripts/prepare_hirise.py`, `prepare_ortho.py`, `prepare_units.py`) need Python with `numpy`, `rasterio`, `pillow`, `fiona` and `shapely`. They are developer tools, not part of the build.
- If a change alters the rendered scene or the detector's features, retrain with `npm run train` and commit the new `public/data/detector_model.json` and `docs/perception_eval.json` together, with the before and after numbers in your PR.

## Why TypeScript is pinned to 6.0

`typescript-eslint` does not yet support TypeScript 6.1 or the native TypeScript 7 (which has no JavaScript compiler API). The project therefore pins `typescript` to `~6.0`, and Dependabot is told to ignore TypeScript minor and major bumps. When `typescript-eslint` supports a newer version, bump both together.

## Good places to start

Issues labelled **good first issue** are small and scoped. Drafts for the planned ones are in [docs/issues/](docs/issues/). If you want to work on one, comment on the matching GitHub issue first so nobody duplicates effort.

## Reporting bugs and security problems

Use the issue forms for bugs and features. Report security problems **privately** as described in [SECURITY.md](SECURITY.md).
