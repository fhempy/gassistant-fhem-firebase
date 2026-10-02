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
