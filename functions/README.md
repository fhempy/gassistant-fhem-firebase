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

`functions/generations.json` selects the generation of each function (`1` or `2`) and the
number of concurrent requests per instance for 2nd gen functions. The upgrade itself is done
with `gcloud functions upgrade`, which keeps the cloudfunctions.net URLs.

`scripts/migrate-functions.sh` guides through the whole process step by step (logins, backup,
Node 22 deployment, upgrade of each function, switching the code to 2nd gen). Every step is
confirmed before it runs and tested afterwards; the progress is saved, so the script can be
restarted at any time.
