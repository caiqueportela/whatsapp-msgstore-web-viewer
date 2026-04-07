# AGENTS.md

## Cursor Cloud specific instructions

This is a client-side React + TypeScript SPA built with Vite. There is no backend server or database to manage.

### Services

| Service | Command | Notes |
|---|---|---|
| Vite Dev Server | `npm run dev` | Serves the app at `http://localhost:5173/whatsapp-msgstore-web-viewer/`. Use `--host 0.0.0.0` flag for remote access. |

### Key commands

See `package.json` scripts: `dev`, `build`, `preview`. There is no dedicated lint or test script — TypeScript checking is done via `npx tsc --noEmit`.

### Gotchas

- **`vite.config.ts` base path**: The `base` is set to `/whatsapp-msgstore-web-viewer/` for GitHub Pages deployment. The dev server URL is therefore `http://localhost:5173/whatsapp-msgstore-web-viewer/`, not just `/`.
- **CDN dependencies at runtime**: `sql.js` (WASM), Tailwind CSS, and Google Fonts are loaded from CDNs at runtime in `index.html`. Internet access is required.
- **No lint/test scripts**: The project has no ESLint config or test framework. Use `npx tsc --noEmit` for type checking.
- **Sample database**: A sample `msgstore.db` can be downloaded from the repo's `main` branch on GitHub (see README) for manual testing.
