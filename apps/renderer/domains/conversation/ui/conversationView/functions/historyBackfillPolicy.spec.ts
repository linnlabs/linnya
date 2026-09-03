import { describe, expect, it } from 'vitest';
import { shouldTriggerLoadAfter, shouldTriggerLoadBefore } from './historyBackfillPolicy';

describe('shouldTriggerLoadBefore', () => {
  it('triggers before the top reaches the larger of two viewports and quarter scroll height', () => {
    expect(shouldTriggerLoadBefore({
      scrollTop: 2_499,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreBefore: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(true);

    expect(shouldTriggerLoadBefore({
      scrollTop: 2_500,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreBefore: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(false);

    expect(shouldTriggerLoadBefore({
      scrollTop: 799,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreBefore: false,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(false);

    expect(shouldTriggerLoadBefore({
      scrollTop: 799,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreBefore: true,
      windowStatus: 'loading',
      loadingMode: 'before',
      isNavigating: false,
    })).toBe(false);

    expect(shouldTriggerLoadBefore({
      scrollTop: 799,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'follow-bottom',
      hasMoreBefore: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(false);

    expect(shouldTriggerLoadBefore({
      scrollTop: 799,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreBefore: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: true,
    })).toBe(false);
  });
});

describe('shouldTriggerLoadAfter', () => {
  it('triggers symmetrically near the bottom while the window is ready', () => {
    expect(shouldTriggerLoadAfter({
      scrollTop: 6_701,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreAfter: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(true);

    expect(shouldTriggerLoadAfter({
      scrollTop: 6_700,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreAfter: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(false);

    expect(shouldTriggerLoadAfter({
      scrollTop: 6_701,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'anchored',
      hasMoreAfter: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: true,
    })).toBe(false);

    expect(shouldTriggerLoadAfter({
      scrollTop: 6_701,
      viewportHeight: 800,
      scrollHeight: 10_000,
      scrollMode: 'follow-bottom',
      hasMoreAfter: true,
      windowStatus: 'ready',
      loadingMode: null,
      isNavigating: false,
    })).toBe(true);
  });
});
