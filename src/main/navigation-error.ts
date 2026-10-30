/**
 * Turn Electron `loadURL` failures into stable, user-facing navigation errors.
 * The bridge maps the `code` to HTTP 400 so a bad host is not reported as a
 * browser-server crash.
 */
export interface NavigationFailure {
  url: string;
  code: string;
  message: string;
  cause: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function classifyNavigationFailure(url: string, error: any): NavigationFailure {
  const cause = String(error?.code || error?.message || error || 'unknown error');
  const host = hostOf(url);
  let code = 'NAVIGATION_FAILED';
  let detail = `Could not load ${host}`;

  if (cause.includes('ERR_NAME_NOT_RESOLVED')) {
    code = 'NAVIGATION_HOST_NOT_FOUND';
    detail = `Host not found: ${host}`;
  } else if (cause.includes('ERR_CONNECTION_REFUSED')) {
    code = 'NAVIGATION_CONNECTION_REFUSED';
    detail = `Connection refused: ${host}`;
  } else if (cause.includes('ERR_CONNECTION_TIMED_OUT') || cause.includes('ERR_TIMED_OUT')) {
    code = 'NAVIGATION_TIMEOUT';
    detail = `Connection timed out: ${host}`;
  } else if (cause.includes('ERR_INTERNET_DISCONNECTED')) {
    code = 'NAVIGATION_OFFLINE';
    detail = 'The machine appears to be offline';
  } else if (cause.includes('ERR_ADDRESS_UNREACHABLE')) {
    code = 'NAVIGATION_UNREACHABLE';
    detail = `Host unreachable: ${host}`;
  } else if (cause.includes('ERR_TOO_MANY_REDIRECTS')) {
    code = 'NAVIGATION_TOO_MANY_REDIRECTS';
    detail = `Too many redirects: ${host}`;
  } else if (cause.includes('ERR_CERT_')) {
    code = 'NAVIGATION_CERTIFICATE';
    detail = `TLS certificate rejected: ${host}`;
  } else if (cause.includes('ERR_ABORTED')) {
    code = 'NAVIGATION_ABORTED';
    detail = `Navigation was aborted: ${host}`;
  }

  return {
    url,
    code,
    message: `${detail} (${cause}). Check the URL, DNS/network access, and whether the host is reachable.`,
    cause,
  };
}
