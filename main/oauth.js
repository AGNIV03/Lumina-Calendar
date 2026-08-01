'use strict';
// Google OAuth 2.0 for installed apps: loopback redirect + PKCE.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Lumina Calendar</title>
<body style="font-family:Segoe UI,sans-serif;background:#12141c;color:#e8eaf2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:44px">✅</div>
<h2 style="font-weight:600;margin:12px 0 4px">You're signed in</h2>
<p style="color:#9aa0b4;margin:0">You can close this tab and return to Lumina Calendar.</p></div></body>`;

function decodeIdToken(idToken) {
  try {
    const payload = idToken.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google token error: ${data.error || res.status} ${data.error_description || ''}`.trim());
  }
  return data;
}

// Opens the system browser, waits for the loopback redirect, exchanges the code.
// Resolves { email, name, picture, refresh_token, access_token, expires_at }.
function authorize(clientId, clientSecret, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const stateParam = b64url(crypto.randomBytes(16));

    const server = http.createServer();
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch {}
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('Sign-in timed out. Please try again.')),
      timeoutMs
    );

    server.on('request', async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DONE_PAGE);

      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      if (err) return finish(reject, new Error(`Google sign-in failed: ${err}`));
      if (!code || url.searchParams.get('state') !== stateParam) {
        return finish(reject, new Error('Google sign-in failed: invalid response.'));
      }
      try {
        const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
        const tok = await tokenRequest({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        });
        const claims = decodeIdToken(tok.id_token || '');
        if (!claims.email) return finish(reject, new Error('Could not determine account email.'));
        if (!tok.refresh_token) {
          return finish(reject, new Error(
            'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and sign in again.'
          ));
        }
        finish(resolve, {
          email: claims.email,
          name: claims.name || claims.email,
          picture: claims.picture || '',
          refresh_token: tok.refresh_token,
          access_token: tok.access_token,
          expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
        });
      } catch (e) {
        finish(reject, e);
      }
    });

    server.on('error', (e) => finish(reject, e));
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent select_account',
        state: stateParam,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      shell.openExternal(`${AUTH_URL}?${params}`);
    });
  });
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const tok = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return {
    access_token: tok.access_token,
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
  };
}

module.exports = { authorize, refreshAccessToken, SCOPES };
