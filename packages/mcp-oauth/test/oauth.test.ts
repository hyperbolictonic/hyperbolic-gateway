import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { McpOAuthServer } from '../src/index.ts';

const CLIENT_ID = 'hg_test_client';
const CLIENT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const RESOURCE = '/mcp/browser';
const VERIFIER = 'a'.repeat(64);

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

async function withOAuth(handler: (base: string, oauth: McpOAuthServer) => Promise<void>): Promise<void> {
  const oauth = new McpOAuthServer({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    resourcePath: RESOURCE,
    allowedRedirectHosts: ['oauth-redirect.googleusercontent.com'],
  });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/mcp/browser') {
      const auth = oauth.authorize(request);
      response.writeHead(auth ? 200 : 401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ auth }));
      return;
    }
    void oauth.handleRequest(request, response, url).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    }).catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  const port = await listen(server);
  try {
    await handler(`http://127.0.0.1:${port}`, oauth);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    oauth.stop();
  }
}

test('publishes protected-resource and authorization-server metadata', async () => {
  await withOAuth(async (base) => {
    const resource = await fetch(`${base}/.well-known/oauth-protected-resource${RESOURCE}`);
    assert.equal(resource.status, 200);
    const resourceJson = await resource.json() as any;
    assert.equal(resourceJson.resource, `${base}${RESOURCE}`);
    assert.deepEqual(resourceJson.authorization_servers, [base]);

    const metadata = await fetch(`${base}/.well-known/oauth-authorization-server`);
    assert.equal(metadata.status, 200);
    const metadataJson = await metadata.json() as any;
    assert.equal(metadataJson.issuer, base);
    assert.equal(metadataJson.authorization_endpoint, `${base}/oauth/authorize`);
    assert.equal(metadataJson.token_endpoint, `${base}/oauth/token`);
    assert.deepEqual(metadataJson.code_challenge_methods_supported, ['S256']);
    assert.equal(metadataJson.registration_endpoint, undefined);
  });
});

test('uses the forwarded HTTPS origin for tunneled metadata', async () => {
  await withOAuth(async (base) => {
    const response = await fetch(`${base}/.well-known/oauth-authorization-server`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const metadata = await response.json() as any;
    assert.ok(metadata.issuer.startsWith('https://127.0.0.1:'));
    assert.ok(metadata.authorization_endpoint.startsWith('https://'));
  });
});

test('completes authorization code + PKCE, accepts the token, and refreshes', async () => {
  await withOAuth(async (base) => {
    const redirect = `${base}/callback`;
    const state = 'state-123';
    const challenge = challengeFor(VERIFIER);
    const authorizeUrl = new URL(`${base}/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', CLIENT_ID);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirect);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'mcp');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    const page = await fetch(authorizeUrl);
    assert.equal(page.status, 200);
    const html = await page.text();
    const requestToken = html.match(/name="request" value="([^"]+)"/)?.[1];
    assert.ok(requestToken);

    const approval = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request: requestToken, decision: 'approve' }),
      redirect: 'manual',
    });
    assert.equal(approval.status, 302);
    const location = approval.headers.get('location');
    assert.ok(location);
    const callback = new URL(location);
    assert.equal(callback.origin + callback.pathname, redirect);
    assert.equal(callback.searchParams.get('state'), state);
    const code = callback.searchParams.get('code');
    assert.ok(code);

    const tokenResponse = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
        code_verifier: VERIFIER,
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json() as any;
    assert.match(tokens.access_token, /^[a-f0-9]{64}$/);
    assert.ok(tokens.refresh_token);

    const protectedResponse = await fetch(`${base}${RESOURCE}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(protectedResponse.status, 200);
    const protectedJson = await protectedResponse.json() as any;
    assert.equal(protectedJson.auth.subject, `oauth:${CLIENT_ID}`);

    const refreshResponse = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json() as any;
    assert.notEqual(refreshed.access_token, tokens.access_token);
  });
});

test('rejects a bad PKCE verifier and disallowed redirect hosts', async () => {
  await withOAuth(async (base) => {
    const badRedirect = new URL(`${base}/oauth/authorize`);
    badRedirect.searchParams.set('client_id', CLIENT_ID);
    badRedirect.searchParams.set('response_type', 'code');
    badRedirect.searchParams.set('redirect_uri', 'https://evil.example/callback');
    badRedirect.searchParams.set('code_challenge', challengeFor(VERIFIER));
    badRedirect.searchParams.set('code_challenge_method', 'S256');
    const rejected = await fetch(badRedirect);
    assert.equal(rejected.status, 400);
  });
});
