/**
 * Translate a package run outcome into the wrapper surface's `WrapRunResult`.
 *
 * The package owns transport, paging cursors and the envelope; the wrapper
 * surface owns rendering (the recipe renderer) and its published error code
 * names. This module is the join: it keeps `WrapRunResult`'s shape, keeps the
 * existing codes for situations that already had one, and gives the situations
 * the package can express but the old executor could not a stable, explicit
 * code rather than leaking a snake_case token to an agent.
 *
 * It never sees a secret value: request headers arrive already redacted, and
 * an error carries only a message and an optional hint.
 */

import type { DryRunPlan, RuntimeError } from 'anyapi-to-mcp/runtime';

import type { RenderedDocument, RenderMeta } from '../../../../packages/recipe/src/index.ts';
import { isPrivateHostname } from '../security.ts';
import { previewUrl } from '../render.ts';
import type { WrapErrorInfo, WrapIndexed, WrapMethod, WrapPreview, WrapRunResult } from '../types.ts';

export type WrapIdentity = { readonly id: string; readonly name: string };

/**
 * Core code -> wrapper code. Codes on the right are already published; the one
 * exception is documented per line.
 */
const CORE_TO_WRAP = {
  missing_argument: 'INVALID_ARGS',
  unknown_argument: 'INVALID_ARGS',
  invalid_argument: 'INVALID_ARGS',
  unknown_view: 'INVALID_ARGS',
  unknown_operation: 'WRAPPER_NOT_FOUND',
  secret_unbound: 'AUTH_REQUIRED',
  secret_missing: 'AUTH_REQUIRED',
  too_many_redirects: 'TOO_MANY_REDIRECTS',
  timeout: 'TIMEOUT',
  network: 'NETWORK_ERROR',
  http_error: 'HTTP_ERROR',
  /** Not expressible before: a response over the byte cap. New, explicit code. */
  response_too_large: 'RESPONSE_TOO_LARGE',
  /** The view did not fit the response; the payload is stored behind a handle. */
  bad_response: 'INVALID_RESPONSE',
  /** A write the workspace refused. New, explicit codes; both are refusals. */
  write_denied: 'WRITE_DENIED',
  write_not_confirmed: 'WRITE_NOT_CONFIRMED',
  /** A write's 5xx, where the server may have committed before failing. */
  outcome_unknown: 'OUTCOME_UNKNOWN',
  /** Cursor failures replace the old `cursor` result with one code. */
  cursor_invalid: 'INVALID_CURSOR',
  unknown_cursor: 'INVALID_CURSOR',
  cursor_mismatch: 'INVALID_CURSOR',
  blocked_scheme: 'BLOCKED_PROTOCOL',
  /** Split by the wrapper's own rule below; a bare default for safety. */
  blocked_host: 'BLOCKED_HOST',
  bad_url: 'INVALID_URL',
  url_has_credentials: 'BLOCKED_URL_CREDENTIALS',
} satisfies Record<RuntimeError['code'], string>;

/** A core code this build does not know is reported as a request failure. */
const UNKNOWN_CODE = 'INVALID_REQUEST';

/**
 * The core has one refusal code for three situations the wrapper surface
 * publishes separately. `host` is the name from the core's own plan, so the
 * split is decided by the same data the policy used, not by parsing a message
 * beyond the resolve-failure case.
 */
export function splitBlockedHost(
  error: Pick<RuntimeError, 'code'> & { readonly message?: string },
  host: string | undefined,
): string | undefined {
  if (error.code !== 'blocked_host' || host === undefined) return undefined;
  if (error.message?.startsWith('cannot resolve') === true) return 'DNS_LOOKUP_FAILED';
  return isPrivateHostname(host) ? 'BLOCKED_HOST' : 'BLOCKED_ADDRESS';
}

/** 401/403 means the credential is the actionable problem, not the transport. */
export function wrapErrorCode(
  error: Pick<RuntimeError, 'code' | 'status'> & { readonly message?: string },
  host?: string,
): string {
  const split = splitBlockedHost(error, host);
  if (split !== undefined) return split;
  if (error.code === 'http_error' && (error.status === 401 || error.status === 403)) return 'AUTH_REQUIRED';
  return CORE_TO_WRAP[error.code as RuntimeError['code']] ?? UNKNOWN_CODE;
}

export type WrapFailureOptions = {
  readonly request?: WrapPreview;
  readonly field?: string;
  /** Overrides the default retryability (timeouts and network failures are). */
  readonly retryable?: boolean;
  /** The request host, so a policy refusal keeps its published code. */
  readonly host?: string;
};

export function wrapFailure(
  wrapper: WrapIdentity,
  error: Pick<RuntimeError, 'code' | 'message' | 'hint' | 'status'>,
  options: WrapFailureOptions = {},
): WrapRunResult {
  const code = wrapErrorCode(error, options.host);
  const message = error.hint === undefined ? error.message : `${error.message} (${error.hint})`;
  const retryable = options.retryable ?? (code === 'TIMEOUT' || code === 'NETWORK_ERROR');
  const info: WrapErrorInfo = {
    code,
    message,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(options.field === undefined ? {} : { field: options.field }),
    ...(retryable ? { retryable: true } : {}),
  };

  return {
    ok: false,
    wrapper,
    ...(options.request === undefined ? {} : { request: options.request }),
    ...(error.status === undefined ? {} : { status: error.status }),
    markdown: `**${code}:** ${message}`,
    records: [],
    error: info,
  };
}

/** What the wrapper renderer produced for this run; the package never renders. */
export type WrapRendered = {
  readonly markdown: string;
  readonly records: Record<string, unknown>[];
  readonly documents?: RenderedDocument[];
  readonly meta?: RenderMeta;
};

export type WrapSuccessInput = {
  readonly wrapper: WrapIdentity;
  /** The core's status is all this adapter needs from its result. */
  readonly result: { readonly status: number };
  readonly request: WrapPreview;
  readonly rendered: WrapRendered;
  readonly durationMs: number;
  /** UTF-8 bytes read from the upstream response(s). */
  readonly bytes: number;
  readonly contentType?: string;
  readonly truncated?: boolean;
  readonly paging?: { pages: number; cap: number; more: boolean };
  readonly indexed?: WrapIndexed;
};

/** A successful (or failed-upstream, non-2xx already being an error) run. */
export function wrapSuccess(input: WrapSuccessInput): WrapRunResult {
  return {
    ok: true,
    status: input.result.status,
    durationMs: input.durationMs,
    wrapper: input.wrapper,
    request: input.request,
    response: {
      ...(input.contentType === undefined || input.contentType === '' ? {} : { contentType: input.contentType }),
      bytes: input.bytes,
      ...(input.truncated === true ? { truncated: true } : {}),
    },
    markdown: input.rendered.markdown,
    records: input.rendered.records,
    ...(input.rendered.documents === undefined ? {} : { documents: input.rendered.documents }),
    ...(input.rendered.meta === undefined ? {} : { meta: input.rendered.meta }),
    ...(input.paging === undefined ? {} : { paging: input.paging }),
    ...(input.indexed === undefined ? {} : { indexed: input.indexed }),
  };
}

/**
 * A dry run.
 *
 * The core's plan carries header *names* only, by design: a plan never holds a
 * credential. Every header value in the preview is therefore `<redacted>`, which
 * is stricter than the old executor (it showed non-sensitive values).
 */
export function wrapDryRun(wrapper: WrapIdentity, plan: DryRunPlan): WrapRunResult {
  const headers: Record<string, string> = {};
  for (const name of plan.headers) headers[name] = '<redacted>';

  return {
    ok: true,
    dryRun: true,
    wrapper,
    request: {
      // The core's HttpMethod is the same closed set as WrapMethod.
      method: plan.method as WrapMethod,
      // A plan keeps the query out of `url`; a preview must show it.
      url: previewUrl(plan.url, plan.query),
      headers,
      ...(plan.body === undefined ? {} : { body: plan.body }),
    },
    markdown: '_Dry run — request not sent._',
    records: [],
  };
}
