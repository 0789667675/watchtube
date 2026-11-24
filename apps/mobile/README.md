# WatchTube Mobile

The Expo viewer and creator application uses the existing `/api/v1` feed,
trending, For You, Shorts, search, channel, video, comment, subscription,
interaction, and creator upload endpoints. Discovery remains server-filtered to
public videos; an unlisted video can only be opened by its direct video ID, as
allowed by the public watch API. The app does not create synthetic views,
engagement, or fabricated earnings.

## Configuration

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to the API
origin, without an `/api/v1` suffix. The app has no localhost or production
URL fallback. Use an API host reachable from the target simulator or device:
`localhost` on a physical phone refers to the phone itself (use `http://10.0.2.2:3001`
for local Android emulator development, or an HTTPS tunnel/host for physical
devices). iOS App Transport Security and Android cleartext traffic restrictions
may block HTTP, and this app does not add broad cleartext exceptions. Non-HTTPS
API URLs are rejected in production builds.

## Run and validate

From the monorepo root:

```sh
pnpm --filter @watchtube/mobile start
pnpm --filter @watchtube/mobile typecheck
pnpm --filter @watchtube/mobile lint
pnpm --filter @watchtube/mobile test
pnpm --filter @watchtube/mobile test:integration
```

`test` runs unit/contract checks for feed/search/channel/upload parsers, Shorts
portrait/duration validation, URL configuration, and upload stage guarantees.
`test:integration` runs live HTTP integration tests against the WatchTube API
(`WATCHTUBE_API_BASE_URL`, defaulting to `http://127.0.0.1:3001`).

## Authentication and sessions

The existing API login endpoint issues an HTTP-only cookie rather than returning
a bearer token: `POST /auth/login` responds with `{ "success": true }` and sets
the `token` cookie; `GET /auth/me` returns the session user and channels; and
`POST /auth/logout` clears the cookie and responds with `{ "success": true }`.
The app sends requests with Axios `withCredentials`, verifies login by calling
`/auth/me`, and never reads or copies the HTTP-only cookie/JWT into JavaScript
storage.

React Native delegates cookie storage to its native networking stack, but
cookie persistence across app restarts has not been verified on physical iOS or
Android devices. Until that device check is complete, cookie-backed sign-in is
locally integration-checked against the API but not device-certified. Do not
add a JavaScript token store.

Expired sessions return to the signed-out state; restricted sessions show the
API error; transient session-check failures preserve an already loaded user
while displaying a retryable error. The session is checked again when the app
returns from the background.

## Viewer playback and Creator Studio upload

- **Viewer & Shorts**: Home (`For You`, `Latest`, `Subscriptions`), Trending,
  Search, Channel profiles, and Watch screen support cursor-paginated comments,
  authenticated like/dislike (`GET /videos/:id/like-status`), subscriptions,
  play/pause, mute/unmute, quality selection when multiple HLS variants exist,
  landscape fullscreen playback, and playback error recovery. Because
  `/feed/shorts` uses the compact public projection without `variants`, the
  Shorts player fetches `/videos/:id` for active/adjacent items to resolve
  playable streams and pauses automatically on tab blur or backgrounding.
- **Creator upload**: Mobile Creator Studio supports selecting a real video
  file via `expo-file-system` (`File.pickFileAsync` on native / file input on
  web), validating size/MIME type (and portrait 9:16 dimensions + `<= 180s`
  duration for Shorts), completing the copyright declaration, saving drafts,
  requesting presigned upload targets (`/videos/upload-intent` and
  `/videos/:id/upload-url`), transferring raw binary bytes via HTTP `PUT`,
  verifying the uploaded object (`/videos/:id/verify-upload`), polling
  processing status (`/videos/:id/upload-status`), and confirming publication
  (`/videos/:id/publish`). Binary transfer failures halt before verification
  and never mark an upload complete when only the intent succeeded.

Android keyboard resizing is configured, app orientation follows the device,
and fullscreen playback requests landscape. No native device/emulator run is
implied by local type/lint/bundle/API-integration checks.
