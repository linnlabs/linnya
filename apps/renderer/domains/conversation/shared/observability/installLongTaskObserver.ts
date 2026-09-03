import { publishConversationPerf } from './conversationPerf';

export interface InstallLongTaskObserverOptions {
  readConversationId?: () => string | null;
}

let installed = false;
let observer: PerformanceObserver | null = null;

export function installLongTaskObserver(options: InstallLongTaskObserverOptions = {}): void {
  if (installed) return;
  if (observer !== null) return;
  installed = true;

  if (import.meta.env.DEV !== true) return;
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  const supportedEntryTypes = PerformanceObserver.supportedEntryTypes;
  if (!supportedEntryTypes.includes('longtask')) return;

  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const conversationId = options.readConversationId?.() ?? undefined;
      publishConversationPerf({
        kind: 'long-task',
        phase: 'main-thread',
        durationMs: entry.duration,
        conversationId,
        details: {
          name: entry.name,
        },
      });
    }
  });
  observer.observe({ entryTypes: ['longtask'] });
}
