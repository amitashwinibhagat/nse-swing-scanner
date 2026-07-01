# Owner-Only On-Demand Scan Trigger Plan

## Goal

Add an owner-only control to the deployed NSE Swing Scanner dashboard that can trigger the existing GitHub Actions scan workflow from the app, without exposing GitHub credentials or allowing public visitors to burn Actions minutes.

## Current Context

- Deployed site: `https://nse-swing-scanner.netlify.app`
- GitHub repo: `amitashwinibhagat/nse-swing-scanner`
- Existing scan workflow: `.github/workflows/scan.yml`
- Existing workflow already supports manual triggering via `workflow_dispatch`.
- Current workflow concurrency uses `cancel-in-progress: true`; this must change because an in-app trigger should not kill a long-running scan.
- Netlify config uses `base = "frontend"`, so Netlify Function paths should be relative to that base.

## Resolved Decisions

- Admin trigger is owner-only.
- Admin controls are hidden unless the URL includes `?admin=1`.
- Browser calls a same-origin Netlify Function, not GitHub directly.
- Function lives at `frontend/netlify/functions/trigger-scan.js`.
- `netlify.toml` gets `[functions] directory = "netlify/functions"` because Netlify build base is `frontend`.
- Function validates `Authorization: Bearer <SCAN_TRIGGER_SECRET>`.
- Function uses `GITHUB_DISPATCH_TOKEN` from Netlify env vars to trigger GitHub Actions workflow dispatch.
- GitHub token should be a fine-grained PAT limited to `amitashwinibhagat/nse-swing-scanner` with Actions read/write.
- Admin trigger secret is remembered in `localStorage` under a key such as `nseSwingAdminSecret`.
- UI includes a "Forget admin secret" action.
- Client-side cooldown only: store `lastScanTriggerAt` in `localStorage` and disable the button for 10 minutes after successful trigger.
- After trigger, show queued/running status plus a GitHub Actions link. No polling.
- Workflow concurrency changes to `cancel-in-progress: false` so duplicate/admin triggers queue instead of canceling active scans.
- Implementation agent may generate `SCAN_TRIGGER_SECRET`, set it in Netlify env, and print it once in the final response as sensitive.

## Required Environment Variables

Set these in Netlify project env vars for `nse-swing-scanner`:

- `GITHUB_DISPATCH_TOKEN`
  - Fine-grained GitHub PAT.
  - Repository access: `amitashwinibhagat/nse-swing-scanner` only.
  - Permission: Actions read/write.
- `SCAN_TRIGGER_SECRET`
  - Random generated secret, e.g. `openssl rand -hex 32`.
  - Used by browser as owner passphrase.
  - Do not commit it.

## Implementation Steps

1. Update `netlify.toml`:

```toml
[functions]
  directory = "netlify/functions"
```

Keep existing build settings:

```toml
[build]
  base = "frontend"
  command = "npm run build"
  publish = "dist"
```

Rationale: with `base = "frontend"`, `directory = "netlify/functions"` resolves to `frontend/netlify/functions`.

2. Add Netlify Function at `frontend/netlify/functions/trigger-scan.js`.

Behavior:

- Accept only `POST`.
- Read `Authorization` header.
- Require exact bearer token match against `process.env.SCAN_TRIGGER_SECRET`.
- Return `401` when missing/wrong secret.
- Require `process.env.GITHUB_DISPATCH_TOKEN`; return `500` with safe error if missing.
- Call GitHub REST endpoint:

```http
POST https://api.github.com/repos/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml/dispatches
```

Request body:

```json
{
  "ref": "main"
}
```

Headers:

```http
Authorization: Bearer <GITHUB_DISPATCH_TOKEN>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

Success response:

- GitHub returns `204 No Content` for successful workflow dispatch.
- Function should return `202` with JSON:

```json
{
  "ok": true,
  "message": "Scan queued",
  "actionsUrl": "https://github.com/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml"
}
```

Failure behavior:

- GitHub 401/403: return `502` with `github_dispatch_failed` and no token details.
- GitHub 404: return `502` with message that workflow/repo/token permission is wrong.
- Other errors: return `502` with safe generic message.

3. Change workflow concurrency in `.github/workflows/scan.yml`:

```yaml
concurrency:
  group: nse-swing-scan
  cancel-in-progress: false
```

4. Add admin UI in `frontend/src/App.jsx`.

Use admin flag:

```js
const isAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
```

Add state:

- `scanTriggerStatus`
- `scanTriggerError`
- `scanTriggerBusy`

Use localStorage keys:

- `nseSwingAdminSecret`
- `nseSwingLastTriggerAt`

Admin controls behavior:

- Only render if `isAdmin` is true.
- Add button: `Run scan now`.
- Add secondary button/link: `Forget admin secret` when a secret exists.
- On click:
  - If cooldown is active, show message and do not call function.
  - Load secret from localStorage.
  - If missing, prompt user once via `window.prompt("Admin scan secret")`.
  - If provided, store it in localStorage.
  - POST to `/.netlify/functions/trigger-scan` with `Authorization: Bearer <secret>`.
  - On `202`, store `lastScanTriggerAt = Date.now()`, show queued/running message.
  - On `401`, clear stored secret and show invalid-secret message.
  - On other error, show safe error message.

Success copy:

> Scan queued/running. Typical runtime is 20-35 minutes. Watch progress on GitHub Actions.

Include link:

`https://github.com/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml`

No polling.

5. Add UI styling in `frontend/src/styles.css`.

Add compact styles for:

- `.admin-controls`
- `.admin-button`
- `.admin-status`
- `.admin-error`
- disabled button state matching existing UI.

Keep admin controls visually subordinate to scan/filter controls.

6. Update README minimally.

Add a short section "Owner-only on-demand scans" covering:

- `?admin=1` URL reveals admin controls.
- Required Netlify env vars: `GITHUB_DISPATCH_TOKEN`, `SCAN_TRIGGER_SECRET`.
- Refreshing the app does not scan; the button queues GitHub Actions workflow.

Do not print secrets in docs.

## Validation Plan

### Local Build

```bash
cd frontend
npm run build
```

### Function Validation

Use Netlify CLI if available:

```bash
netlify dev
```

Test unauthorized:

```bash
curl -i -X POST http://localhost:8888/.netlify/functions/trigger-scan
```

Expected: `401`.

Test authorized after env vars are configured locally or on Netlify:

```bash
curl -i -X POST \
  -H "Authorization: Bearer $SCAN_TRIGGER_SECRET" \
  http://localhost:8888/.netlify/functions/trigger-scan
```

Expected: `202` and a new GitHub Actions workflow run appears.

### Deployed Validation

- Visit `https://nse-swing-scanner.netlify.app/`; admin controls are not visible.
- Visit `https://nse-swing-scanner.netlify.app/?admin=1`; admin controls are visible.
- Click `Run scan now`; prompt appears if no localStorage secret.
- Wrong secret returns invalid-secret UI and clears stored secret.
- Correct secret queues workflow and shows Actions link.
- Button is disabled for 10 minutes after success.
- `Forget admin secret` clears localStorage secret.
- GitHub Actions run appears in workflow run list.
- Existing scheduled scan behavior remains unchanged except queued concurrency.

## Risks And Mitigations

- **Secret in browser localStorage can be copied from the owner's machine.** Acceptable for owner-only trigger passphrase; GitHub PAT remains server-side.
- **Public visitors can discover `?admin=1`.** They still need the secret; without it the function returns `401`.
- **Duplicate triggers can queue multiple scans.** Client cooldown reduces accidental duplicates; workflow queues instead of canceling.
- **Netlify env vars missing.** Function returns safe `500`; UI shows error. Add env var setup before testing production trigger.
- **GitHub PAT permissions wrong.** Function returns dispatch failure; verify fine-grained PAT has Actions read/write on the repo.

## Out Of Scope

- Polling GitHub Actions status from the UI.
- Real-time scan execution in the browser.
- Public trigger button.
- Multi-user accounts or admin login system.
- Server-side durable rate limiting.
- Scan cancellation/restart button.
