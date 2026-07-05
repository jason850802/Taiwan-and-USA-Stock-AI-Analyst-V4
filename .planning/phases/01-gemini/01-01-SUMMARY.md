---
phase: 01-gemini
plan: 01
subsystem: api
tags: [vercel-functions, gemini, security, vite, abort-controller]

requires: []
provides:
  - Server-side Gemini proxy with backend-only API key access
  - Classified Traditional Chinese API errors with secret redaction
  - Frontend Gemini calls routed through same-origin /api/gemini
affects: [02-yahoo, 03-finmind, 04-guard]

tech-stack:
  added: []
  patterns: [thin-serverless-proxy, backend-model-mapping, abortable-upstream-call]

key-files:
  created: [api/_lib/config.ts, api/_lib/http.ts, api/_lib/guard.ts, api/gemini.ts, .env.example]
  modified: [services/gemini.ts, vite.config.ts, App.tsx, index.html]

key-decisions:
  - "Gemini requests use AbortController with a 100-second timeout inside a 120-second Vercel function limit."
  - "The Vercel handler uses minimal local request/response interfaces; @vercel/node is not a runtime dependency."
  - "Local development uses Vite on port 3000 with /api proxied to vercel dev on port 3001."
  - "Model IDs remain backend environment configuration and never enter the frontend bundle."

patterns-established:
  - "Thin proxy: prompts remain assembled in the frontend while credentials, model mapping, timeout, and error classification live in /api."
  - "Safe errors: responses contain only fixed { code, message } payloads and logs redact API keys and Google API URLs."

requirements-completed: [CORE-01, CORE-02, CORE-03, KEY-01, KEY-02, KEY-03, KEY-04, PROXY-01, PROXY-02, FE-01]

duration: 2h 6m
completed: 2026-07-05
---

# Phase 1 Plan 1: Gemini Proxy and Key Isolation Summary

**Backend-only Gemini credentials with an abortable Vercel proxy, classified Chinese errors, and frontend calls routed through `/api/gemini`**

## Performance

- **Duration:** 2h 6m
- **Started:** 2026-07-05T15:08:00+08:00
- **Completed:** 2026-07-05T17:14:29+08:00
- **Tasks:** 4
- **Files modified:** 9

## Accomplishments

- Moved all four Gemini analysis paths behind one server-side endpoint without changing their public signatures or prompt-building logic.
- Removed API key injection and the browser-side Gemini SDK, then verified the production bundle contains no key, SDK, or Google API URL markers.
- Added request validation, Origin/Referer guard scaffolding, model mapping, abortable timeout handling, five fixed error classes, and log redaction.
- Established the local dual-process flow: Vite on port 3000 and `vercel dev` on port 3001 through a Vite `/api` proxy.

## Task Commits

Each implementation task was committed atomically:

1. **Task 1: Build the shared `api/_lib` layer** - `fda2063`
2. **Task 2: Add the `/api/gemini` proxy endpoint** - `6b13f22`
3. **Task 3: Route frontend Gemini calls through the proxy** - `0d2800e`
4. **Task 4: Human verification checkpoint** - user approved; no code commit

## Files Created/Modified

- `api/_lib/config.ts` - Reads the backend key, maps modes to models, and parses allowed origins.
- `api/_lib/http.ts` - Validates requests, calls Gemini with `AbortController`, classifies errors, and redacts sensitive log fragments.
- `api/_lib/guard.ts` - Provides the Phase 1 Origin/Referer guard scaffold.
- `api/gemini.ts` - Implements the single POST proxy with local request/response types and `maxDuration = 120`.
- `.env.example` - Documents Gemini models, the key placeholder, and local origins.
- `services/gemini.ts` - Preserves four public analysis APIs while replacing direct SDK calls with `/api/gemini` fetches.
- `vite.config.ts` - Removes secret injection and proxies `/api` to local Vercel port 3001.
- `App.tsx` - Displays the backend's user-friendly error message without the obsolete English key check.
- `index.html` - Removes the browser import map entry for `@google/genai`.

## Verification

- `npx.cmd tsc --noEmit`: passed with 0 errors after every implementation task and at final verification.
- `npm.cmd run build`: passed with Vite 6.4.1; only pre-existing missing `index.css` and bundle-size warnings remain.
- `dist` scans: 0 matches for `AIza`, `GEMINI_API_KEY`, `GoogleGenAI`, `generativelanguage.googleapis.com`, and `process.env.API_KEY`.
- Task 4 human verification checkpoint: approved by the user.

## Decisions Made

- Used `AbortController` rather than `Promise.race` so an application timeout cancels the SDK request.
- Used minimal local handler interfaces because `@vercel/node` is type-only and its installation was unreliable in this environment.
- Used `export const maxDuration = 120`; no `vercel.json` was necessary.
- Adopted the plan's resolved two-port local flow instead of relying on ambiguous Vite/Vercel single-port behavior.

## Deviations from Plan

None - implementation followed the final `preflight_resolutions`, including resolution 8.

## Issues Encountered

- Attempted `@vercel/node` installation repeatedly stalled and partially modified `node_modules`; resolution 8 removed the dependency. The residual process and directory were removed, and the affected existing `recharts` package was restored from the exact lockfile tarball. No tracked dependency files changed.
- Stale zero-byte Git index locks appeared twice; active processes were checked before removing only the stale lock files.

## User Setup Required

- Configure `GEMINI_API_KEY`, `GEMINI_MODEL_FAST`, `GEMINI_MODEL_THINKING`, and `ALLOWED_ORIGIN` in local/Vercel environments using `.env.example`.
- Local flow: run Vite on 3000 and `npx.cmd vercel dev --listen 3001`; first use may require Vercel login/link.

## Next Phase Readiness

- The proxy foundation is ready for Phase 2 Yahoo endpoints.
- Keep the remaining concern to measure real thinking-model latency against the 120-second limit in the deployed environment.

---
*Phase: 01-gemini*
*Completed: 2026-07-05*
