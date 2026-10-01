# AllSquare

Personal expense splitting for one person who logs the group. This repo has the shared money math, the `allsquare` Postgres schema, the Vercel API, and the Android app shell.

Money is integer paise. Splits, balances, and settle-up live in `shared/` and are the only copy of that logic.

## Layout

- `app/` — Expo app (Android). Brand images are in `app/assets/`
- `api/` — Vercel functions. Helpers are in `api/_lib/` so Vercel does not deploy them as routes
- `shared/` — split, balance, simplify, `formatINR` / `parseINR`, and the colour theme
- `db/migrations/` — schema `allsquare` only
- `docs/PRD.md` — product spec

## Local setup

Node 22 or newer.

```powershell
copy .env.example .env
npm install
npm test
npm run migrate
```

Fill in `.env`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string. Migrations and queries stay inside schema `allsquare`. |
| `JWT_SECRET` | Secret for the app JWT (`jose`, HS256, about 90 days). |
| `GOOGLE_CLIENT_ID` | Web OAuth client id. Required for `POST /api/auth/google`. Sync curl tests do not need it. |

`npm run migrate` applies any new files in `db/migrations/` and skips ones already recorded in `allsquare.schema_migrations`. Running it twice is safe.

## API with `vercel dev`

Install the Vercel CLI once (`npm install -g vercel` or use `npx`), then from this directory:

```powershell
npx vercel dev
```

The first run links the directory to a Vercel project. Choose Other as the framework. The CLI loads `.env` and serves the functions, usually at `http://localhost:3000`.

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/auth/google` | Google ID token `{ "idToken" }` → `{ jwt, user }` |
| GET, PATCH | `/api/me` | Bearer JWT. PATCH accepts `{ "name"?, "upi_vpa"? }` |
| POST | `/api/sync` | Bearer JWT. Body `{ since, push }` → `{ cursor, pull }` |
| GET | `/s/:token` | Public. Rewritten to `/api/share`. Placeholder HTML until sharing is built |

## Test sync with curl

`npm run dev-token` inserts a local user (`google_sub` `dev-local`) if needed and prints a JWT. It does not go through Google.

In a second terminal, with `vercel dev` already running:

```powershell
$jwt = (npm run --silent dev-token).Trim()

curl.exe -s -X POST http://localhost:3000/api/sync `
  -H "Authorization: Bearer $jwt" `
  -H "Content-Type: application/json" `
  --data-binary "@sync-push.json"
```

`sync-push.json`:

```json
{
  "since": 0,
  "push": {
    "members": [{
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Sanjay",
      "kind": "person",
      "weight": 1,
      "is_self": false,
      "updated_at": "2026-09-23T12:00:00.000Z"
    }],
    "groups": [{
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Coorg Trip",
      "default_split": "per_head",
      "currency": "INR",
      "archived": false,
      "updated_at": "2026-09-23T12:00:00.000Z"
    }],
    "group_members": [{
      "group_id": "22222222-2222-4222-8222-222222222222",
      "member_id": "11111111-1111-4111-8111-111111111111",
      "weight": 1,
      "sort_order": 0,
      "updated_at": "2026-09-23T12:00:00.000Z"
    }],
    "expenses": [{
      "id": "33333333-3333-4333-8333-333333333333",
      "group_id": "22222222-2222-4222-8222-222222222222",
      "paid_by": "11111111-1111-4111-8111-111111111111",
      "amount_paise": 2100000,
      "split_type": "per_head",
      "spent_on": "2026-10-12",
      "created_at": "2026-09-23T12:00:00.000Z",
      "updated_at": "2026-09-23T12:00:00.000Z",
      "splits": [{
        "member_id": "11111111-1111-4111-8111-111111111111",
        "weight": 1,
        "owed_paise": 2100000
      }]
    }]
  }
}
```

The response `pull` contains that group and expense (₹21,000, whole rupees), and `cursor` is the new high-water mark. `since: 0` also returns the Dev member that `dev-token` created.

Pull the same rows again with an empty push. PowerShell rewrites a JSON argument passed to `curl.exe`, so put the body in a file:

```powershell
Set-Content -Path sync-pull.json -Value '{"since":0,"push":{}}' -Encoding ascii
curl.exe -s -X POST http://localhost:3000/api/sync `
  -H "Authorization: Bearer $jwt" `
  -H "Content-Type: application/json" `
  --data-binary "@sync-pull.json"
```

To confirm you are caught up, set `since` in that file to the `cursor` from the push response. `pull` should then be empty and `cursor` should stay the same.

A share token can be pushed in `share_links` (`token` is 16–128 url-safe characters, and `group_id` or `member_id` is required). `GET /s/<token>` returns the placeholder page. A missing or revoked token returns “Link no longer active”.

## Android app

The Expo project is in `app/`. It is Android only (`com.sanjay.allsquare`). The API base URL and Google web client id come from `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (`app/.env` locally, `app/eas.json` on EAS). Copy `app/.env.example` to `app/.env` if that file is missing.

From `app/`:

```powershell
npx eas-cli login
npx eas-cli init
npx eas-cli build --profile development --platform android
```

`eas init` creates the Expo project and prints a project id. If it cannot edit `app.config.ts`, add this under `extra`:

```ts
eas: { projectId: "the-id-from-eas-init" },
```

When the build finishes, install the APK from the link EAS prints. Then, with the phone on the same Wi-Fi:

```powershell
npx expo start
```

Open AllSquare on the phone and connect to that dev server. The development APK is a dev client, not a standalone app.

After the first build, the signing key exists. Read its SHA-1:

```powershell
npx eas-cli credentials --platform android
```

Create a Google **Android** OAuth client (in addition to the web client already used by the API):

| Field | Value |
| --- | --- |
| Package name | `com.sanjay.allsquare` |
| SHA-1 | The fingerprint `eas credentials` prints for this project |

Use that SHA-1, not a sample fingerprint. Development and preview builds share one EAS keystore unless you created a second one. If the two profiles show different SHA-1 values, create one Android client per fingerprint, both with the same package name. Sign-in starts working after Google has the fingerprint; you do not rebuild the APK for that.

A preview APK is standalone and does not use `expo start`:

```powershell
npx eas-cli build --profile preview --platform android
```

It uses the same package name, so installing it replaces the dev client.

After Google sign-in works on the phone, delete the local test user:

```powershell
npm run delete-dev-user
```

Run that from the repo root, not from `app/`.

## Dependencies

- `typescript`, `vitest` — build and test `shared/`
- `zod` — validate auth, profile, and sync bodies
- `jose` — sign and verify the app JWT
- `google-auth-library` — verify the Google ID token
- `@neondatabase/serverless` and `ws` — Neon Postgres, including a real transaction on Node

The Android app (`app/package.json`) adds:

- `expo`, `expo-router`, `expo-dev-client` — SDK 57 app, file-based screens, and a dev build (not Expo Go)
- `expo-sqlite` — on-phone database
- `expo-secure-store` — the app JWT
- `expo-font` and `@expo-google-fonts/poppins` — Poppins 800, 600, and 400
- `expo-splash-screen`, `expo-status-bar`, `expo-linking`, `expo-constants` — splash, status bar, and app config
- `react-native-safe-area-context`, `react-native-screens` — required by expo-router
- `@react-native-google-signin/google-signin` — Google sign-in, which sends the ID token to the API
