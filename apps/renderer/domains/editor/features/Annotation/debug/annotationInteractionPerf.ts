export interface AnnotationInteractionPerfSample {
  kind: 'annotation-click';
  blockId: string;
  hadExistingAnnotations: boolean;
  triggerMs?: number;
  totalMs: number;
  timestamp: number;
}

export interface AnnotationInteractionPerfApi {
  getLast: () => AnnotationInteractionPerfSample | null;
  getHistory: () => AnnotationInteractionPerfSample[];
  clear: () => void;
}

declare global {
  interface Window {
    __ANNOTATION_INTERACTION_PERF__?: AnnotationInteractionPerfApi;
  }
}

const ANNOTATION_INTERACTION_HISTORY_LIMIT = 60;
const annotationInteractionHistory: AnnotationInteractionPerfSample[] = [];

export function readAnnotationPerfNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function publishAnnotationInteractionPerf(
  sample: Omit<AnnotationInteractionPerfSample, 'timestamp'>
): void {
  annotationInteractionHistory.push({
    ...sample,
    timestamp: readAnnotationPerfNowMs(),
  });
  if (annotationInteractionHistory.length > ANNOTATION_INTERACTION_HISTORY_LIMIT) {
    annotationInteractionHistory.splice(
      0,
      annotationInteractionHistory.length - ANNOTATION_INTERACTION_HISTORY_LIMIT
    );
  }

  if (typeof window === 'undefined') return;

  window.__ANNOTATION_INTERACTION_PERF__ ??= {
    getLast: () => annotationInteractionHistory[annotationInteractionHistory.length - 1] ?? null,
    getHistory: () => [...annotationInteractionHistory],
    clear: () => {
      annotationInteractionHistory.length = 0;
    },
  };
}
