import { ref, type InjectionKey, type Ref } from 'vue';
import { getFlag } from '../services/editorFeatureFlags';

const VISIBILITY_BAND_CONFIG = {
  inViewport: { rootMargin: '80px 0px' },
  nearViewport: { rootMargin: '420px 0px' },
  historyViewport: { rootMargin: '140px 0px' },
} as const;

export interface BlockVisibilityState {
  isInViewport: Ref<boolean>;
  isNearViewport: Ref<boolean>;
  isInHistoryViewport: Ref<boolean>;
}

type VisibilityEntry = {
  el: HTMLElement;
};

type VisibilityBand = keyof typeof VISIBILITY_BAND_CONFIG;

export interface BlockVisibilityChange {
  blockId: string;
  band: VisibilityBand;
  isVisible: boolean;
  el: HTMLElement;
}

function isDomElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function logVisibilityManagerStage(stage: string, buildMetrics: () => readonly string[]): void {
  if (!getFlag('renderVirtualizationDebugLogging')) return;
  console.info(`[BlockVisibilityManager] ${stage} ${buildMetrics().join(' ')}`);
}

export interface BlockVisibilityManager {
  getBlockVisibilityState: (blockId: string) => BlockVisibilityState;
  getBlockVisibilityRef: (blockId: string) => Ref<boolean>;
  registerBlockVisibility: (blockId: string, el: HTMLElement) => void;
  unregisterBlockVisibility: (blockId: string, el?: HTMLElement | null) => void;
  subscribe: (listener: (change: BlockVisibilityChange) => void) => () => void;
  resetObserver: () => void;
  cleanup: () => void;
}

export const OBSERVE_BLOCK_KEY: InjectionKey<(el: HTMLElement) => void> =
  Symbol('OBSERVE_BLOCK_KEY');

export const UNOBSERVE_BLOCK_KEY: InjectionKey<(el: HTMLElement) => void> =
  Symbol('UNOBSERVE_BLOCK_KEY');

export const GET_BLOCK_VISIBILITY_STATE_KEY: InjectionKey<
  (blockId: string) => BlockVisibilityState
> = Symbol('GET_BLOCK_VISIBILITY_STATE_KEY');

export const GET_BLOCK_VISIBILITY_REF_KEY: InjectionKey<(blockId: string) => Ref<boolean>> =
  Symbol('GET_BLOCK_VISIBILITY_REF_KEY');

export const REGISTER_BLOCK_VISIBILITY_KEY: InjectionKey<
  (blockId: string, el: HTMLElement) => void
> = Symbol('REGISTER_BLOCK_VISIBILITY_KEY');

export const UNREGISTER_BLOCK_VISIBILITY_KEY: InjectionKey<
  (blockId: string, el?: HTMLElement | null) => void
> = Symbol('UNREGISTER_BLOCK_VISIBILITY_KEY');

export function createDefaultBlockVisibilityState(): BlockVisibilityState {
  return {
    isInViewport: ref(true),
    isNearViewport: ref(true),
    isInHistoryViewport: ref(true),
  };
}

export function createBlockVisibilityManager(options: {
  getRoot: () => HTMLElement | null;
}): BlockVisibilityManager {
  const { getRoot } = options;
  const visibleBlockEntries = new Map<string, VisibilityEntry>();
  const visibilityStates = new Map<string, BlockVisibilityState>();
  const observers = new Map<VisibilityBand, IntersectionObserver>();
  const listeners = new Set<(change: BlockVisibilityChange) => void>();

  const getBandRef = (state: BlockVisibilityState, band: VisibilityBand): Ref<boolean> => {
    if (band === 'inViewport') return state.isInViewport;
    if (band === 'historyViewport') return state.isInHistoryViewport;
    return state.isNearViewport;
  };

  const ensureObserver = (band: VisibilityBand): IntersectionObserver | null => {
    const existing = observers.get(band);
    if (existing || typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
      return existing ?? null;
    }

    const root = getRoot();
    const observer = new window.IntersectionObserver(
      (entries) => {
        const startedAt = nowMs();
        let changedCount = 0;
        let visibleCount = 0;
        entries.forEach((entry) => {
          const target = entry.target;
          if (!isDomElement(target)) return;
          const blockId = target.dataset.id;
          if (!blockId) return;
          const state = visibilityStates.get(blockId);
          if (!state) return;
          getBandRef(state, band).value = entry.isIntersecting;
          changedCount += 1;
          if (entry.isIntersecting) visibleCount += 1;
          listeners.forEach((listener) => {
            listener({
              blockId,
              band,
              isVisible: entry.isIntersecting,
              el: target,
            });
          });
        });
        logVisibilityManagerStage('observer-callback', () => [
          `band=${band}`,
          `entries=${entries.length}`,
          `changed=${changedCount}`,
          `visible=${visibleCount}`,
          `listeners=${listeners.size}`,
          `tracked=${visibleBlockEntries.size}`,
          `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
        ]);
      },
      {
        root: isDomElement(root) ? root : null,
        rootMargin: VISIBILITY_BAND_CONFIG[band].rootMargin,
        threshold: 0,
      }
    );

    visibleBlockEntries.forEach((entry) => {
      observer.observe(entry.el);
    });

    observers.set(band, observer);
    return observer;
  };

  const getBlockVisibilityState = (blockId: string): BlockVisibilityState => {
    const existing = visibilityStates.get(blockId);
    if (existing) return existing;
    const created = createDefaultBlockVisibilityState();
    visibilityStates.set(blockId, created);
    return created;
  };

  const getBlockVisibilityRef = (blockId: string): Ref<boolean> => {
    return getBlockVisibilityState(blockId).isNearViewport;
  };

  const registerBlockVisibility = (blockId: string, el: HTMLElement): void => {
    if (!blockId || !isDomElement(el)) return;

    const startedAt = nowMs();
    const visibilityState = getBlockVisibilityState(blockId);
    const existing = visibleBlockEntries.get(blockId);
    if (existing?.el) {
      observers.forEach((observer) => {
        observer.unobserve(existing.el);
      });
    }

    visibilityState.isInViewport.value = true;
    visibilityState.isNearViewport.value = true;
    visibilityState.isInHistoryViewport.value = true;
    visibleBlockEntries.set(blockId, { el });

    (Object.keys(VISIBILITY_BAND_CONFIG) as VisibilityBand[]).forEach((band) => {
      ensureObserver(band)?.observe(el);
    });
    logVisibilityManagerStage('register', () => [
      `blockId=${blockId}`,
      `tracked=${visibleBlockEntries.size}`,
      `observers=${observers.size}`,
      `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
    ]);
  };

  const unregisterBlockVisibility = (blockId: string, el?: HTMLElement | null): void => {
    if (!blockId) return;
    const existing = visibleBlockEntries.get(blockId);
    if (!existing) return;

    const startedAt = nowMs();
    observers.forEach((observer) => observer.unobserve(existing.el));

    if (!el || existing.el === el) {
      visibleBlockEntries.delete(blockId);
      const visibilityState = visibilityStates.get(blockId);
      if (visibilityState) {
        visibilityState.isInViewport.value = true;
        visibilityState.isNearViewport.value = true;
        visibilityState.isInHistoryViewport.value = true;
      }
    }
    logVisibilityManagerStage('unregister', () => [
      `blockId=${blockId}`,
      `tracked=${visibleBlockEntries.size}`,
      `observers=${observers.size}`,
      `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
    ]);
  };

  const cleanup = (): void => {
    observers.forEach((observer) => observer.disconnect());
    observers.clear();
    visibleBlockEntries.clear();
    visibilityStates.clear();
    listeners.clear();
  };

  return {
    getBlockVisibilityState,
    getBlockVisibilityRef,
    registerBlockVisibility,
    unregisterBlockVisibility,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resetObserver: () => {
      observers.forEach((observer) => observer.disconnect());
      observers.clear();
      (Object.keys(VISIBILITY_BAND_CONFIG) as VisibilityBand[]).forEach((band) => {
        ensureObserver(band);
      });
    },
    cleanup,
  };
}
