import type { WebContents } from 'electron';

export interface CapturedNetworkRequest {
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  requestTime: number;
  responseDurationMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  hasBody: boolean;
  bodyPreview?: string;
}

export interface NetworkFilter {
  urlPattern?: string;
  method?: string;
  resourceType?: string; // 'XHR' | 'Fetch' | 'Document' | etc.
  status?: number;
  limit?: number;
}

export class NetworkInterceptor {
  private attachedWebContents: Set<WebContents> = new Set();
  private requests: Map<string, CapturedNetworkRequest> = new Map();
  private payloads: Map<string, { body: string; base64Encoded: boolean }> = new Map();
  private maxStoredRequests: number = 250;

  /**
   * Attaches Chrome DevTools Protocol network listener to the specified WebContents.
   */
  public attach(wc: WebContents): void {
    if (!wc || wc.isDestroyed() || this.attachedWebContents.has(wc)) {
      return;
    }

    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
      }

      wc.debugger.sendCommand('Network.enable', {
        maxPostDataSize: 65536,
        maxResourceBufferSize: 10485760,
      });

      this.attachedWebContents.add(wc);

      wc.debugger.on('message', async (_event, method, params) => {
        try {
          await this.handleCdpMessage(wc, method, params);
        } catch {
          // Ignore transient CDP errors
        }
      });

      wc.debugger.on('detach', () => {
        this.attachedWebContents.delete(wc);
      });

      wc.on('destroyed', () => {
        this.attachedWebContents.delete(wc);
      });
    } catch (err: any) {
      console.warn(`[NetworkInterceptor] Could not attach CDP debugger: ${err?.message || err}`);
    }
  }

  private async handleCdpMessage(wc: WebContents, method: string, params: any) {
    if (method === 'Network.requestWillBeSent') {
      const { requestId, request, type } = params;
      const captured: CapturedNetworkRequest = {
        requestId,
        url: request.url,
        method: request.method,
        resourceType: type || 'Other',
        requestTime: Date.now(),
        requestHeaders: request.headers,
        hasBody: false,
      };

      this.requests.set(requestId, captured);
      this.pruneBuffer();
    } else if (method === 'Network.responseReceived') {
      const { requestId, response } = params;
      const captured = this.requests.get(requestId);
      if (captured) {
        captured.status = response.status;
        captured.statusText = response.statusText;
        captured.mimeType = response.mimeType;
        captured.responseHeaders = response.headers;
        captured.responseDurationMs = Date.now() - captured.requestTime;
      }
    } else if (method === 'Network.loadingFinished') {
      const { requestId } = params;
      const captured = this.requests.get(requestId);
      if (!captured) return;

      // Only attempt to retrieve body for text/JSON or XHR/Fetch to save memory
      const isXhrOrFetch = captured.resourceType === 'XHR' || captured.resourceType === 'Fetch';
      const isJsonOrText =
        captured.mimeType?.includes('json') ||
        captured.mimeType?.includes('text') ||
        captured.mimeType?.includes('javascript') ||
        captured.mimeType?.includes('xml');

      if (isXhrOrFetch || isJsonOrText) {
        try {
          if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) {
            const bodyRes = await wc.debugger.sendCommand('Network.getResponseBody', { requestId });
            if (bodyRes && bodyRes.body) {
              captured.hasBody = true;
              this.payloads.set(requestId, {
                body: bodyRes.body,
                base64Encoded: bodyRes.base64Encoded || false,
              });

              // Create preview snippet
              const preview = bodyRes.body.slice(0, 300).trim();
              captured.bodyPreview = preview.length === 300 ? preview + '...' : preview;
            }
          }
        } catch {
          // Some responses (redirects, 304s, CORS preflights) don't have bodies
        }
      }
    }
  }

  /**
   * Filters and returns captured network requests.
   */
  public getTraffic(filter?: NetworkFilter): CapturedNetworkRequest[] {
    let all = Array.from(this.requests.values()).sort((a, b) => b.requestTime - a.requestTime);

    if (!filter) {
      return all.slice(0, 50);
    }

    if (filter.urlPattern) {
      const pattern = filter.urlPattern.toLowerCase();
      all = all.filter((r) => r.url.toLowerCase().includes(pattern));
    }

    if (filter.method) {
      const method = filter.method.toUpperCase();
      all = all.filter((r) => r.method === method);
    }

    if (filter.resourceType) {
      const type = filter.resourceType.toLowerCase();
      all = all.filter((r) => r.resourceType.toLowerCase() === type);
    }

    if (filter.status !== undefined) {
      all = all.filter((r) => r.status === filter.status);
    }

    const limit = filter.limit && filter.limit > 0 ? filter.limit : 50;
    return all.slice(0, limit);
  }

  /**
   * Retrieves the full response body for a given requestId.
   */
  public getPayload(requestId: string): {
    requestId: string;
    url?: string;
    status?: number;
    mimeType?: string;
    isJson: boolean;
    data: any;
  } {
    const meta = this.requests.get(requestId);
    const payload = this.payloads.get(requestId);

    if (!payload) {
      throw new Error(`No payload buffered for request ID "${requestId}". (Has body: ${meta?.hasBody})`);
    }

    let parsedData: any = payload.body;
    let isJson = false;

    if (meta?.mimeType?.includes('json') || payload.body.trim().startsWith('{') || payload.body.trim().startsWith('[')) {
      try {
        parsedData = JSON.parse(payload.body);
        isJson = true;
      } catch {
        parsedData = payload.body;
      }
    }

    return {
      requestId,
      url: meta?.url,
      status: meta?.status,
      mimeType: meta?.mimeType,
      isJson,
      data: parsedData,
    };
  }

  /**
   * Clears in-memory request and payload buffers.
   */
  public clear(): void {
    this.requests.clear();
    this.payloads.clear();
  }

  private pruneBuffer(): void {
    if (this.requests.size > this.maxStoredRequests) {
      const sortedKeys = Array.from(this.requests.keys());
      const toRemove = sortedKeys.slice(0, this.requests.size - this.maxStoredRequests);
      for (const k of toRemove) {
        this.requests.delete(k);
        this.payloads.delete(k);
      }
    }
  }
}
