import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpOAuthAuth, McpOAuthServerOptions } from './types.ts';

interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  state?: string;
  scope: string[];
  codeChallenge: string;
  expiresAt: number;
}

interface AuthorizationRecord extends PendingAuthorization {
  code: string;
  expiresAt: number;
}

interface TokenRecord {
  token: string;
  clientId: string;
  scope: string[];
  expiresAt: number;
}

const DEFAULT_SCOPES = ['mcp'];
const DEFAULT_REDIRECT_HOSTS = ['oauth-redirect.googleusercontent.com', 'gemini.google.com'];
const AUTH_CODE_TTL_MS = 10 * 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const PKCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizePath(value: string): string {
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function originOf(request: IncomingMessage): string {
  const host = headerValue(request.headers.host);
  if (!host || /[\r\n]/.test(host)) throw new Error('Missing or invalid Host header');
  const forwarded = headerValue(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim();
  const cfVisitor = headerValue(request.headers['cf-visitor']);
  let cfScheme: string | undefined;
  if (cfVisitor) {
    try {
      cfScheme = String((JSON.parse(cfVisitor) as { scheme?: unknown }).scheme || '').toLowerCase();
    } catch {
      cfScheme = undefined;
    }
  }
  const socket = request.socket as { encrypted?: boolean };
  const protocol =
    forwarded === 'https' || forwarded === 'http'
      ? forwarded
      : cfScheme === 'https' || request.headers['cf-ray']
        ? 'https'
        : socket.encrypted
          ? 'https'
          : 'http';
  return `${protocol}://${host}`;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(html);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  response.end();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let done = false;
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        reject(new Error('Request body too large'));
        request.resume();
        return;
      }
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (done) return;
      done = true;
      resolve(body);
    });
    request.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

async function readFields(request: IncomingMessage): Promise<Record<string, string>> {
  const body = await readBody(request);
  if (!body) return {};
  const contentType = String(request.headers['content-type'] || '');
  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') fields[key] = value;
    }
    return fields;
  }
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

/**
 * A small OAuth 2.1 authorization server for one MCP resource and one static
 * client. It intentionally has no dynamic registration endpoint: Gemini falls
 * back to the client credentials entered under Advanced features.
 */
export class McpOAuthServer {
  private readonly options: McpOAuthServerOptions;
  private readonly resourcePath: string;
  private readonly scopes: string[];
  private readonly allowedRedirectHosts: Set<string>;
  private readonly accessTokenTtlMs: number;
  private readonly refreshTokenTtlMs: number;
  private readonly codes = new Map<string, AuthorizationRecord>();
  private readonly access = new Map<string, TokenRecord>();
  private readonly refresh = new Map<string, TokenRecord>();
  private timer: NodeJS.Timeout | null = null;

  constructor(options: McpOAuthServerOptions) {
    this.options = options;
    this.resourcePath = normalizePath(options.resourcePath);
    this.scopes = options.scopes?.length ? [...options.scopes] : DEFAULT_SCOPES;
    this.allowedRedirectHosts = new Set(options.allowedRedirectHosts || DEFAULT_REDIRECT_HOSTS);
    this.accessTokenTtlMs = options.accessTokenTtlMs ?? ACCESS_TTL_MS;
    this.refreshTokenTtlMs = options.refreshTokenTtlMs ?? REFRESH_TTL_MS;
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.codes.clear();
    this.access.clear();
    this.refresh.clear();
  }

  authorize(request: IncomingMessage): McpOAuthAuth | null {
    const header = headerValue(request.headers.authorization);
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    this.prune();
    const record = this.access.get(match[1]);
    if (!record) return null;
    return { subject: `oauth:${record.clientId}` };
  }

  challenge(request: IncomingMessage): string | undefined {
    try {
      return `Bearer resource_metadata="${originOf(request)}/.well-known/oauth-protected-resource${this.resourcePath}"`;
    } catch {
      return undefined;
    }
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      this.handleResourceMetadata(request, response);
      return true;
    }
    if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') {
      this.handleAuthorizationServerMetadata(request, response);
      return true;
    }
    if (url.pathname === '/oauth/authorize') {
      await this.handleAuthorize(request, response, url);
      return true;
    }
    if (url.pathname === '/oauth/token') {
      await this.handleToken(request, response);
      return true;
    }
    if (url.pathname === '/oauth/revoke') {
      await this.handleRevoke(request, response);
      return true;
    }
    return false;
  }

  private log(event: string, detail?: Record<string, unknown>): void {
    try {
      this.options.logger?.(event, detail);
    } catch {
      // OAuth logging must never break the flow.
    }
  }

  private origin(request: IncomingMessage): string {
    return originOf(request);
  }

  private handleResourceMetadata(request: IncomingMessage, response: ServerResponse): void {
    const origin = this.origin(request);
    sendJson(response, 200, {
      resource: `${origin}${this.resourcePath}`,
      authorization_servers: [origin],
      scopes_supported: this.scopes,
      bearer_methods_supported: ['header'],
      resource_name: 'Hyperbolic Gateway Remote Browser',
    });
  }

  private handleAuthorizationServerMetadata(request: IncomingMessage, response: ServerResponse): void {
    const origin = this.origin(request);
    sendJson(response, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: this.scopes,
      resource: `${origin}${this.resourcePath}`,
    });
  }

  private async handleAuthorize(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method === 'GET') {
      const params = url.searchParams;
      const error = this.validateAuthorize(params);
      if (error) {
        this.log('oauth_authorize_rejected', {
          error,
          clientId: params.get('client_id'),
          redirectUri: params.get('redirect_uri'),
        });
        sendHtml(response, 400, this.errorPage(error));
        return;
      }
      const pending: PendingAuthorization = {
        clientId: params.get('client_id') || '',
        redirectUri: params.get('redirect_uri') || '',
        state: params.get('state') || undefined,
        scope: this.parseScope(params.get('scope')),
        codeChallenge: params.get('code_challenge') || '',
        expiresAt: Date.now() + AUTH_CODE_TTL_MS,
      };
      const requestToken = this.encodePending(pending);
      sendHtml(response, 200, this.consentPage(requestToken, pending));
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    const fields = await readFields(request);
    const pending = this.decodePending(fields.request || '');
    if (!pending || pending.expiresAt < Date.now()) {
      this.log('oauth_authorize_state_invalid', {
        requestLength: (fields.request || '').length,
        expired: Boolean(pending && pending.expiresAt < Date.now()),
      });
      sendHtml(response, 400, this.errorPage('This authorization request expired. Start again from Gemini.'));
      return;
    }
    const redirectUrl = new URL(pending.redirectUri);
    if (pending.state) redirectUrl.searchParams.set('state', pending.state);

    if (fields.decision !== 'approve') {
      redirectUrl.searchParams.set('error', 'access_denied');
      this.log('oauth_access_denied', { clientId: pending.clientId });
      redirect(response, redirectUrl.toString());
      return;
    }

    const code = randomToken(24);
    this.codes.set(code, { ...pending, code, expiresAt: Date.now() + AUTH_CODE_TTL_MS });
    redirectUrl.searchParams.set('code', code);
    this.log('oauth_code_issued', { clientId: pending.clientId });
    redirect(response, redirectUrl.toString());
  }

  private encodePending(pending: PendingAuthorization): string {
    const payload = Buffer.from(JSON.stringify(pending), 'utf8').toString('base64url');
    const signature = crypto.createHmac('sha256', this.options.clientSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  private decodePending(token: string): PendingAuthorization | null {
    const separator = token.lastIndexOf('.');
    if (separator < 1) return null;
    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = crypto.createHmac('sha256', this.options.clientSecret).update(payload).digest('base64url');
    if (!constantTimeEquals(signature, expected)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PendingAuthorization;
      if (!parsed.clientId || !parsed.redirectUri || !parsed.codeChallenge) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private validateAuthorize(params: URLSearchParams): string | null {
    if (params.get('client_id') !== this.options.clientId) return 'Unknown OAuth client.';
    if (params.get('response_type') !== 'code') return 'Only authorization code responses are supported.';
    const redirectUri = params.get('redirect_uri');
    if (!redirectUri || !this.allowedRedirect(redirectUri)) return 'The redirect URI is not allowed.';
    const challenge = params.get('code_challenge');
    if (!challenge || !PKCE_PATTERN.test(challenge)) return 'PKCE S256 is required.';
    if ((params.get('code_challenge_method') || 'S256') !== 'S256') return 'Only PKCE S256 is supported.';
    const requested = this.parseScope(params.get('scope'));
    if (requested.some((scope) => !this.scopes.includes(scope))) return 'The requested scope is not allowed.';
    return null;
  }

  private parseScope(raw: string | null): string[] {
    const requested = (raw || '').split(/\s+/).filter(Boolean);
    return requested.length ? requested : [...this.scopes];
  }

  private allowedRedirect(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (local) return url.protocol === 'http:' || url.protocol === 'https:';
    return url.protocol === 'https:' && this.allowedRedirectHosts.has(url.hostname);
  }

  private async handleToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    let fields: Record<string, string>;
    try {
      fields = await readFields(request);
    } catch {
      sendJson(response, 400, { error: 'invalid_request' });
      return;
    }
    const client = this.authenticateClient(request, fields);
    if (!client) {
      sendJson(response, 401, { error: 'invalid_client' });
      return;
    }

    if (fields.grant_type === 'authorization_code') {
      const record = this.codes.get(fields.code || '');
      if (!record || record.expiresAt < Date.now()) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      if (record.clientId !== client || record.redirectUri !== fields.redirect_uri) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      const verifier = fields.code_verifier || '';
      const expected = base64Url(crypto.createHash('sha256').update(verifier).digest());
      if (!constantTimeEquals(expected, record.codeChallenge)) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      this.codes.delete(record.code);
      this.log('oauth_token_issued', { clientId: client, grant: 'authorization_code' });
      sendJson(response, 200, this.issueTokens(client, record.scope));
      return;
    }

    if (fields.grant_type === 'refresh_token') {
      const record = this.refresh.get(fields.refresh_token || '');
      if (!record || record.expiresAt < Date.now() || record.clientId !== client) {
        sendJson(response, 400, { error: 'invalid_grant' });
        return;
      }
      this.refresh.delete(record.token);
      this.log('oauth_token_issued', { clientId: client, grant: 'refresh_token' });
      sendJson(response, 200, this.issueTokens(client, record.scope));
      return;
    }

    sendJson(response, 400, { error: 'unsupported_grant_type' });
  }

  private async handleRevoke(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    const fields: Record<string, string> = await readFields(request).catch(() => ({}));
    if (!this.authenticateClient(request, fields)) {
      sendJson(response, 401, { error: 'invalid_client' });
      return;
    }
    const token = fields.token || '';
    this.access.delete(token);
    this.refresh.delete(token);
    response.writeHead(200, { 'Cache-Control': 'no-store' });
    response.end();
  }

  private authenticateClient(request: IncomingMessage, fields: Record<string, string>): string | null {
    let clientId = fields.client_id || '';
    let clientSecret = fields.client_secret || '';
    const header = headerValue(request.headers.authorization);
    const basic = header?.match(/^Basic\s+(.+)$/i);
    if (basic) {
      try {
        const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator >= 0) {
          clientId = decodeURIComponent(decoded.slice(0, separator));
          clientSecret = decodeURIComponent(decoded.slice(separator + 1));
        }
      } catch {
        return null;
      }
    }
    if (!constantTimeEquals(clientId, this.options.clientId)) return null;
    if (!constantTimeEquals(clientSecret, this.options.clientSecret)) return null;
    return clientId;
  }

  private issueTokens(clientId: string, scope: string[]): Record<string, unknown> {
    const access = randomToken();
    const refresh = randomToken();
    const now = Date.now();
    this.access.set(access, {
      token: access,
      clientId,
      scope,
      expiresAt: now + this.accessTokenTtlMs,
    });
    this.refresh.set(refresh, {
      token: refresh,
      clientId,
      scope,
      expiresAt: now + this.refreshTokenTtlMs,
    });
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTokenTtlMs / 1000),
      refresh_token: refresh,
      scope: scope.join(' '),
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of this.codes) if (value.expiresAt < now) this.codes.delete(key);
    for (const [key, value] of this.access) if (value.expiresAt < now) this.access.delete(key);
    for (const [key, value] of this.refresh) if (value.expiresAt < now) this.refresh.delete(key);
  }

  private consentPage(requestToken: string, pending: PendingAuthorization): string {
    const redirectHost = (() => {
      try {
        return new URL(pending.redirectUri).hostname;
      } catch {
        return 'unknown client';
      }
    })();
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Hyperbolic Gateway</title>
<style>body{font:15px system-ui,sans-serif;background:#0b1220;color:#e6edf7;max-width:640px;margin:8vh auto;padding:0 20px}h1{font-size:1.5rem;margin-bottom:.4rem}.card{border:1px solid #243653;border-radius:14px;padding:22px;background:#111a2b}.warn{border-left:3px solid #f59e0b;background:#1f1a12;padding:10px 14px;border-radius:6px;margin:18px 0}.actions{display:flex;gap:10px;margin-top:20px}button{padding:10px 16px;border-radius:8px;border:1px solid #243653;background:#16233a;color:#e6edf7;font-weight:600;cursor:pointer}button.primary{background:#22d3ee;color:#07111d;border-color:transparent}code{color:#a3e635}</style>
</head><body><div class="card">
<h1>Authorize Hyperbolic Gateway</h1>
<p>A remote OAuth client wants to control this Chromium browser and its logged-in sessions.</p>
<div class="warn">Only approve if you started this connection yourself. Client: <code>${escapeHtml(pending.clientId)}</code><br>Redirect host: <code>${escapeHtml(redirectHost)}</code></div>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="request" value="${escapeHtml(requestToken)}">
<div class="actions"><button class="primary" name="decision" value="approve" type="submit">Allow access</button><button name="decision" value="deny" type="submit">Cancel</button></div>
</form></div></body></html>`;
  }

  private errorPage(message: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>OAuth error</title><style>body{font:15px system-ui,sans-serif;background:#0b1220;color:#e6edf7;max-width:640px;margin:8vh auto;padding:0 20px}</style></head><body><h1>OAuth error</h1><p>${escapeHtml(message)}</p></body></html>`;
  }
}
