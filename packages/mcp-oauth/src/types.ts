export interface McpOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface McpOAuthServerOptions {
  clientId: string;
  clientSecret: string;
  resourcePath: string;
  scopes?: string[];
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  allowedRedirectHosts?: string[];
  logger?: (event: string, detail?: Record<string, unknown>) => void;
}

export interface McpOAuthAuth {
  subject: string;
}
