// Verifies the Auth0 access token (Authorization: Bearer <token>) of the client requests
// and stores the decoded token in req.user.
// Same checks as express-jwt with jwks-rsa (RS256, audience, issuer, expiry), but loads much
// faster at function startup: the keys of the Auth0 JWKS are imported with Node's crypto.
const crypto = require('crypto');
const jsonwt = require('jsonwebtoken');

// an unknown key id (Auth0 key rotation) fetches the JWKS again, at most once per minute
const JWKS_MIN_REFRESH_INTERVAL = 60 * 1000;

function createJwtCheck(options) {
  const { jwksUri, audience, issuer } = options;
  let keys = {};
  let lastFetch = 0;
  let pending;

  function loadKeys() {
    if (!pending) {
      lastFetch = Date.now();
      pending = (async () => {
        const res = await fetch(jwksUri, { signal: AbortSignal.timeout(10000) });
        if (!res.ok)
          throw new Error('JWKS request failed with ' + res.status);
        const jwks = await res.json();
        const loaded = {};
        for (const jwk of (jwks && jwks.keys) || []) {
          if (jwk && jwk.kid && jwk.kty === 'RSA' && (!jwk.use || jwk.use === 'sig'))
            loaded[jwk.kid] = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        }
        keys = loaded;
      })().finally(() => {
        pending = undefined;
      });
    }
    return pending;
  }

  async function getKey(kid) {
    if (!keys[kid] && Date.now() - lastFetch > JWKS_MIN_REFRESH_INTERVAL)
      await loadKeys();
    return keys[kid];
  }

  return async function jwtCheck(req, res, next) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) {
      res.status(401).send({ error: 'credentials_required' });
      return;
    }
    const decoded = jsonwt.decode(m[1], { complete: true });
    if (!decoded || !decoded.header || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') {
      res.status(401).send({ error: 'invalid_token' });
      return;
    }
    let key;
    try {
      key = await getKey(decoded.header.kid);
    } catch (err) {
      // Auth0 not reachable, the token might be valid
      console.error('Failed to load the Auth0 signing keys', err);
      res.status(503).send({ error: 'jwks_unavailable' });
      return;
    }
    try {
      if (!key)
        throw new Error('unknown signing key');
      req.user = jsonwt.verify(m[1], key, { algorithms: ['RS256'], audience: audience, issuer: issuer });
    } catch (err) {
      res.status(401).send({ error: 'invalid_token' });
      return;
    }
    next();
  };
}

module.exports = {
  createJwtCheck
};
