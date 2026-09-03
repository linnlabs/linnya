import { describe, expect, it } from 'vitest';
import {
  computeSteppedZoomLevel,
  computeWheelZoomLevel,
} from './zoomBehavior';

describe('computeSteppedZoomLevel', () => {
  it('uses smaller stepped zoom increments for button zoom', () => {
    expect(computeSteppedZoomLevel({
      currentZoom: 1,
      direction: 'in',
      step: 0.05,
      minZoom: 0.25,
      maxZoom: 3,
    })).toBeCloseTo(1.05);

    expect(computeSteppedZoomLevel({
      currentZoom: 1,
      direction: 'out',
      step: 0.05,
      minZoom: 0.25,
      maxZoom: 3,
    })).toBeCloseTo(0.95);
  });

  it('clamps button zoom to the configured range', () => {
    expect(computeSteppedZoomLevel({
      currentZoom: 2.98,
      direction: 'in',
      step: 0.05,
      minZoom: 0.25,
      maxZoom: 3,
    })).toBe(3);
  });
});

describe('computeWheelZoomLevel', () => {
  it('maps wheel delta to a continuous zoom factor instead of a fixed jump', () => {
    const nextZoom = computeWheelZoomLevel({
      currentZoom: 1,
      deltaY: -120,
      minZoom: 0.25,
      maxZoom: 3,
      sensitivity: 0.0015,
    });

    expect(nextZoom).toBeCloseTo(1.197217, 5);
  });

  it('clamps wheel zoom to the configured range', () => {
    const nextZoom = computeWheelZoomLevel({
      currentZoom: 0.26,
      deltaY: 1000,
      minZoom: 0.25,
      maxZoom: 3,
      sensitivity: 0.0015,
    });

    expect(nextZoom).toBe(0.25);
  });
});
