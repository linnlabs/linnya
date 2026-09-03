export type ConversationPerfKind =
  | 'history-load'
  | 'virtual-layout'
  | 'virtual-scroll'
  | 'virtual-item'
  | 'window-prepend'
  | 'image-load'
  | 'long-task';

export type ConversationPerfMetricValue = string | number | boolean | null;

export interface ConversationPerfSample {
  kind: ConversationPerfKind;
  phase: string;
  timestamp: number;
  durationMs?: number;
  conversationId?: string;
  details?: Record<string, ConversationPerfMetricValue>;
}

export interface ConversationPerfPhaseSummary {
  kind: ConversationPerfKind;
  phase: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number | null;
  lastTimestamp: number;
  lastConversationId?: string;
  lastDetails?: Record<string, ConversationPerfMetricValue>;
}

export interface ConversationPerfApi {
  getLast: (kind?: ConversationPerfKind) => ConversationPerfSample | null;
  getHistory: (kind?: ConversationPerfKind) => ConversationPerfSample[];
  getRecentSummary: (limit?: number, kind?: ConversationPerfKind) => ConversationPerfSample[];
  getPhaseSummary: (kind?: ConversationPerfKind) => ConversationPerfPhaseSummary[];
  clear: () => void;
}

declare global {
  interface Window {
    __CONVERSATION_PERF__?: ConversationPerfApi;
  }
}

const CONVERSATION_PERF_HISTORY_LIMIT = 1500;
const conversationPerfHistory: ConversationPerfSample[] = [];

export function isConversationPerfEnabled(): boolean {
  return import.meta.env.DEV === true;
}

export function readConversationPerfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function installConversationPerfApi(): void {
  if (typeof window === 'undefined') return;

  window.__CONVERSATION_PERF__ ??= {
    getLast: (kind) => {
      for (let i = conversationPerfHistory.length - 1; i >= 0; i -= 1) {
        const sample = conversationPerfHistory[i];
        if (sample && (!kind || sample.kind === kind)) return sample;
      }
      return null;
    },
    getHistory: (kind) => (
      kind
        ? conversationPerfHistory.filter((sample) => sample.kind === kind)
        : [...conversationPerfHistory]
    ),
    getRecentSummary: (limit = 30, kind) => {
      const normalizedLimit = Math.max(1, Math.floor(limit));
      const samples = kind
        ? conversationPerfHistory.filter((sample) => sample.kind === kind)
        : conversationPerfHistory;
      return samples.slice(-normalizedLimit);
    },
    getPhaseSummary: (kind) => summarizeConversationPerfPhases(kind),
    clear: () => {
      conversationPerfHistory.length = 0;
    },
  };
}

function summarizeConversationPerfPhases(
  kind?: ConversationPerfKind,
): ConversationPerfPhaseSummary[] {
  const summaryByKey = new Map<string, ConversationPerfPhaseSummary>();
  const samples = kind
    ? conversationPerfHistory.filter((sample) => sample.kind === kind)
    : conversationPerfHistory;

  for (const sample of samples) {
    const key = `${sample.kind}:${sample.phase}`;
    const durationMs = typeof sample.durationMs === 'number' ? sample.durationMs : 0;
    const existing = summaryByKey.get(key);

    if (!existing) {
      summaryByKey.set(key, {
        kind: sample.kind,
        phase: sample.phase,
        count: 1,
        totalDurationMs: durationMs,
        avgDurationMs: durationMs,
        maxDurationMs: durationMs,
        lastDurationMs: typeof sample.durationMs === 'number' ? sample.durationMs : null,
        lastTimestamp: sample.timestamp,
        lastConversationId: sample.conversationId,
        lastDetails: sample.details,
      });
      continue;
    }

    existing.count += 1;
    existing.totalDurationMs += durationMs;
    existing.avgDurationMs = existing.totalDurationMs / existing.count;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
    existing.lastDurationMs = typeof sample.durationMs === 'number' ? sample.durationMs : null;
    existing.lastTimestamp = sample.timestamp;
    existing.lastConversationId = sample.conversationId;
    existing.lastDetails = sample.details;
  }

  return [...summaryByKey.values()].sort((a, b) => (
    b.totalDurationMs - a.totalDurationMs
  ));
}

export function publishConversationPerf(
  sample: Omit<ConversationPerfSample, 'timestamp'> & { timestamp?: number },
): void {
  if (!isConversationPerfEnabled()) return;

  conversationPerfHistory.push({
    ...sample,
    timestamp: sample.timestamp ?? readConversationPerfNowMs(),
  });
  if (conversationPerfHistory.length > CONVERSATION_PERF_HISTORY_LIMIT) {
    conversationPerfHistory.splice(0, conversationPerfHistory.length - CONVERSATION_PERF_HISTORY_LIMIT);
  }

  installConversationPerfApi();
}
