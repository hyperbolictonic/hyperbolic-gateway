export type CollaborationTargetKind =
  | 'element'
  | 'text'
  | 'frame'
  | 'console'
  | 'network'
  | 'region'
  | 'style'
  | 'page';

export interface CollaborationTarget {
  kind: CollaborationTargetKind;
  url: string;
  tabId?: string;
  frameId?: string;
  revision?: number;
  markId?: number;
  selector?: string;
  role?: string;
  name?: string;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number };
  reference?: string;
}

export type CollaborationMessageKind = 'comment' | 'question' | 'choice' | 'answer' | 'status';

export interface CollaborationMessage {
  id: string;
  author: 'human' | 'agent';
  kind: CollaborationMessageKind;
  text: string;
  choices?: string[];
  answer?: string;
  createdAt: number;
}

export type CollaborationThreadStatus = 'open' | 'answered' | 'resolved' | 'stale';

export interface CollaborationThread {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: CollaborationThreadStatus;
  target: CollaborationTarget;
  intent?: string;
  tags: string[];
  messages: CollaborationMessage[];
  resolution?: string;
}

export interface CollaborationFilter {
  url?: string;
  status?: CollaborationThreadStatus;
  tabId?: string;
  limit?: number;
}

export interface CollaborationResult {
  ok: boolean;
  thread?: CollaborationThread;
  threads?: CollaborationThread[];
  error?: string;
}
