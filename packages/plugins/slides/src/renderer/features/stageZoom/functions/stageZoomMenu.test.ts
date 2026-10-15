import { describe, expect, it } from 'vitest';
import { buildStageZoomMenuOptions, resolveStageZoomMenuAction } from './stageZoomMenu';

const labels = { fitLabel: 'Fit', formatPercent: (percent: number) => `${percent}%` };

describe('stage zoom menu', () => {
  it('marks fit as current in fit mode even when the fitted value equals a preset', () => {
    const options = buildStageZoomMenuOptions({ ...labels, zoomMode: 'fit', zoomPercent: 100 });

    expect(options.filter(option => option.selected).map(option => option.value)).toEqual(['fit']);
    expect(options[1]).toEqual({ isSeparator: true });
    expect(options.slice(2).map(option => option.label)).toEqual(['25%', '50%', '75%', '100%', '150%', '200%']);
  });

  it('marks the matching preset in manual mode and nothing for an in-between value', () => {
    expect(buildStageZoomMenuOptions({ ...labels, zoomMode: 'manual', zoomPercent: 150 })
      .filter(option => option.selected).map(option => option.value)).toEqual(['150']);
    expect(buildStageZoomMenuOptions({ ...labels, zoomMode: 'manual', zoomPercent: 118 })
      .some(option => option.selected)).toBe(false);
  });

  it('maps menu values back to typed actions', () => {
    expect(resolveStageZoomMenuAction('fit')).toEqual({ kind: 'fit' });
    expect(resolveStageZoomMenuAction('75')).toEqual({ kind: 'percent', percent: 75 });
    expect(resolveStageZoomMenuAction('80')).toBeNull();
  });
});
