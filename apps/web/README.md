# WatchTube Viewer

The Viewer is the React application in this workspace. It uses the existing API
for public video discovery, search, trending, channel pages, playback metadata,
subscriptions, and comments. The frontend does not substitute sample content
when an API request fails.

## Routes

- `/` — latest public videos
- `/search?q=...` — video search results
- `/feed/trending` — trending videos
- `/feed/subscriptions` — authenticated subscription feed
- `/watch/:id` — video playback, channel subscription, and comments
- `/channel/:handle` — public channel profile and videos

Viewer routes are mounted in `src/App.tsx`. Their API requests use
`src/api/apiClient.ts` and the existing `/api/v1` endpoints.

## Themes and responsive navigation

The Viewer follows the v2.1 design references in `../../docs/design-assets/v2.1`.
Light mode retains the existing porcelain palette; dark mode uses a black canvas
with blue and cyan accents. The header toggle persists the selection in
`localStorage`, and the default follows the system preference. The sidebar,
mobile/tablet navigation, and search layout adapt at the configured responsive
breakpoints.

## Development and checks

Run the Viewer and API together from the monorepo root:

```sh
pnpm dev:app
```

Turbo manages both processes and stops them together. The API reads
`apps/api/.env` and accepts only loopback PostgreSQL and Redis endpoints in this
local-only command. The Vite `/api` proxy uses `API_PORT` from the shell or
`apps/api/.env`, defaulting to 3001; it never uses the web server's generic
`PORT`. The root `.env` is not used by this command. Local development proxies
use IPv4 loopback (`127.0.0.1`) so Windows `localhost` resolution cannot route
to IPv6 while the API is bound to IPv4.

The applications can also be started independently:

```sh
pnpm --filter @watchtube/web dev
pnpm --filter @watchtube/api dev
pnpm --filter @watchtube/web build
pnpm --filter @watchtube/web lint
pnpm --filter @watchtube/web test
```
