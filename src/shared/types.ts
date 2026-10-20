export type AgentStatus = 'IDLE' | 'TRAVERSING' | 'SIMULATING_INPUT' | 'HARVESTING' | 'ERROR' | 'AWAITING_INPUT';

export interface CursorPosition {
  x: number;
  y: number;
  timestamp: number;
}

export interface TelemetryEvent {
  type: 'mouse_move' | 'click' | 'keystroke' | 'scroll' | 'navigation' | 'harvest';
  x?: number;
  y?: number;
  key?: string;
  url?: string;
  durationMs?: number;
  timestamp: number;
  details?: string;
}

export interface HarvestedConstruct {
  url: string;
  title: string;
  timestamp: string;
  rawHtmlLength: number;
  markdownLength: number;
  estimatedTokens: number;
  /** Characters of page text inside the extracted region (same unit as pageChars). */
  extractedChars?: number;
  /** Characters of text in the page body — the denominator for coverage. */
  pageChars?: number;
  /** Which extraction path produced the body. */
  reader?: 'readability' | 'full-body';
  /** Open shadow roots inlined during serialisation. */
  shadowRoots?: number;
  content: string;
}

export interface TabSummary {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  isActive: boolean;
}

export interface ChassisState {
  currentUrl: string;
  pageTitle: string;
  isLoading: boolean;
  agentStatus: AgentStatus;
  activeAction: string;
  cursor: { x: number; y: number };
  activeTabId?: string;
  tabs?: TabSummary[];
  stats: {
    totalInteractions: number;
    tokensHarvested: number;
    avgLatencyMs: number;
    uptimeSeconds: number;
  };
}
