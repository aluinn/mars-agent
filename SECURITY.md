# Security policy

## Reporting a vulnerability

Please report security problems **privately** through GitHub, not in a public issue:

1. Go to <https://github.com/aluinn/mars-agent/security/advisories/new>.
2. Describe what you found, how to reproduce it, and what you think the impact is.

Reports are visible only to the maintainers. This is a small hobby project, so replies are best-effort and there is no guaranteed response time. Credit is given in the advisory if you want it.

## Supported versions

Only the latest commit on `main` is supported. There are no maintained release branches.

## Scope and design notes

What the project is, so you can judge what counts as a vulnerability:

- **Static site, no backend.** The app is HTML, JavaScript and static data files (`public/data/`). It runs entirely in the visitor's browser. There are no accounts, cookies, user input stored on a server, databases or API keys.
- **Network use.** At runtime the page only fetches its own static files from the same origin (the height map, orthoimage, unit map, detector model and evaluation JSON). It makes no third-party requests.
- **No secrets in the repo.** There are no environment variables today and no `.env` file. If you find a credential in the history, please report it.
- **Dev tooling reads remote data.** `scripts/prepare_*.py` and `scripts/train_detector.mjs` are developer tools run by hand. The data scripts download public USGS data over HTTPS. They are not part of the shipped site.
- **Future LLM planner.** The planner interface (`src/agent/planner.ts`) is written so an LLM planner could run behind a serverless function. If that is added, API keys must stay on the server, never in the browser bundle. Treat any change that puts a key in client code as a vulnerability.

In scope: cross-site scripting through data rendered into the page, a dependency with a known exploitable vulnerability, a leaked credential, a malicious or unexpected network request from the shipped site.

Out of scope: denial of service by loading a very large simulation on your own machine, issues that need the attacker to already control your browser or the files on your disk, and findings in third-party sites (Vercel, GitHub, USGS).
