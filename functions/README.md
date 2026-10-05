# Cloud Functions for FHEM Connect

## Requirements

- Node.js 22 (runtime of the functions, `engines.node` in `package.json`)
- Firebase CLI 15 or newer: `npm install -g firebase-tools`
- Firebase project on the Blaze plan

## Configuration

`settings.json` in the repository is a template. Before deploying, fill in the values
(Auth0, service account for HomeGraph, ...). `HOMEGRAPH_APIKEY` is no longer used,
Request Sync uses the service account (`SERVICEACCOUNT`, `PRIVATE_KEY`).

## Development

```
npm install
npm test
```

## Deployment

```
firebase deploy --only functions
```

All functions are 1st gen functions (`firebase-functions/v1`), the URLs used by the
clients don't change:

| Function | Region |
|---|---|
| api, dynamicfunctionsv1, codelanding, firebase | europe-west1 |
| reportstate, admin | us-central1 |

## Upgrade to Cloud Run functions (2nd gen)

`functions/generations.json` configures how each function is deployed:

| Value | Meaning | Deployed with |
|---|---|---|
| `1` | 1st gen Cloud Function | `firebase deploy` |
| `2` | 2nd gen, created by Firebase | `firebase deploy` |
| `"run"` | upgraded with `gcloud functions upgrade` (Cloud Run service) | `gcloud run deploy` |

`gcloud functions upgrade` switches a function without downtime: a 2nd gen copy is created and
can be tested, traffic is redirected (rollback possible) and only then the 1st gen version is
deleted. The URLs don't change. Afterwards the function is a Cloud Run service which the
Firebase CLI can't manage, so it is exported as plain HTTP handler (not deployed by
`firebase deploy`) and deployed with `gcloud run deploy --function <name>`.

Before upgrading, the current code has to be deployed as 1st gen: the upgrade copies the
deployed code, and only the current code accepts the full path that Cloud Run receives
(`/api/...` instead of `/...`).

- `scripts/migrate-functions.sh` guides through the migration step by step (logins, backup,
  Node 22 deployment, upgrade of each function). Every step is confirmed before it runs and
  tested afterwards; the progress is saved, so the script can be restarted at any time.
- `scripts/deploy.sh [function ...]` deploys the functions afterwards (firebase deploy for
  `1`/`2`, gcloud run deploy for `"run"`).
