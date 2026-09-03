import { describe, expect, it } from 'vitest';
import {
  computeAnchoredScrollPosition,
  computeInitialScrollableStageScroll,
  computeScrollableStageLayout,
} from './stageViewport';

describe('computeScrollableStageLayout', () => {
  it('keeps a fixed gutter when the scaled slide exceeds the viewport', () => {
    const layout = computeScrollableStageLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1.5,
      gutter: 48,
    });

    expect(layout.contentWidth).toBe(1536);
    expect(layout.contentHeight).toBe(906);
    expect(layout.slideLeft).toBe(48);
    expect(layout.slideTop).toBe(48);
    expect(layout.scaledSlideWidth).toBe(1440);
    expect(layout.scaledSlideHeight).toBe(810);
  });

  it('does not allocate gutter scroll space while the slide still fits inside the viewport', () => {
    const layout = computeScrollableStageLayout({
      viewportWidth: 1200,
      viewportHeight: 900,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1.1,
      gutter: 48,
    });

    expect(layout.contentWidth).toBe(1200);
    expect(layout.contentHeight).toBe(900);
    expect(layout.slideLeft).toBe(72);
    expect(layout.slideTop).toBe(153);
    expect(layout.scaledSlideWidth).toBe(1056);
    expect(layout.scaledSlideHeight).toBe(594);
  });

  it('centers the slide when it is smaller than the viewport', () => {
    const layout = computeScrollableStageLayout({
      viewportWidth: 1200,
      viewportHeight: 900,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1,
      gutter: 48,
    });

    expect(layout.contentWidth).toBe(1200);
    expect(layout.contentHeight).toBe(900);
    expect(layout.slideLeft).toBe(120);
    expect(layout.slideTop).toBe(180);
  });

  it('keeps gutter only on the overflowing axis', () => {
    const layout = computeScrollableStageLayout({
      viewportWidth: 1100,
      viewportHeight: 760,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1.2,
      gutter: 48,
    });

    expect(layout.contentWidth).toBe(1248);
    expect(layout.contentHeight).toBe(760);
    expect(layout.slideLeft).toBe(48);
    expect(layout.slideTop).toBe(56);
  });
});

describe('computeInitialScrollableStageScroll', () => {
  it('starts from the centered viewport position for oversized content', () => {
    const layout = computeScrollableStageLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1.5,
      gutter: 48,
    });

    const initialScroll = computeInitialScrollableStageScroll({
      viewportWidth: 1000,
      viewportHeight: 700,
      layout,
    });

    expect(initialScroll.scrollLeft).toBe(268);
    expect(initialScroll.scrollTop).toBe(103);
  });
});

describe('computeAnchoredScrollPosition', () => {
  it('preserves the viewport center as the anchor during manual zoom', () => {
    const prevLayout = computeScrollableStageLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1,
      gutter: 48,
    });
    const nextLayout = computeScrollableStageLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1.5,
      gutter: 48,
    });

    const nextScroll = computeAnchoredScrollPosition({
      anchorViewportX: 500,
      anchorViewportY: 350,
      viewportWidth: 1000,
      viewportHeight: 700,
      prevScrollLeft: 28,
      prevScrollTop: 0,
      prevLayout,
      nextLayout,
    });

    expect(nextScroll.scrollLeft).toBe(310);
    expect(nextScroll.scrollTop).toBe(103);
  });

  it('clamps the next scroll position to the scrollable bounds', () => {
    const prevLayout = computeScrollableStageLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      slideWidth: 960,
      slideHeight: 540,
      scale: 1.5,
      gutter: 48,
    });
    const nextLayout = computeScrollableStageLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      slideWidth: 960,
      slideHeight: 540,
      scale: 0.75,
      gutter: 48,
    });

    const nextScroll = computeAnchoredScrollPosition({
      anchorViewportX: 990,
      anchorViewportY: 690,
      viewportWidth: 1000,
      viewportHeight: 700,
      prevScrollLeft: 536,
      prevScrollTop: 206,
      prevLayout,
      nextLayout,
    });

    expect(nextScroll.scrollLeft).toBeGreaterThanOrEqual(0);
    expect(nextScroll.scrollTop).toBeGreaterThanOrEqual(0);
    expect(nextScroll.scrollLeft).toBeLessThanOrEqual(nextLayout.contentWidth - 1000);
    expect(nextScroll.scrollTop).toBeLessThanOrEqual(nextLayout.contentHeight - 700);
  });
});
