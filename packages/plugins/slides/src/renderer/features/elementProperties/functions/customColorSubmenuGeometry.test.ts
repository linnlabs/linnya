import { describe, expect, it } from 'vitest';
import { resolveCustomColorSubmenuPosition } from './customColorSubmenuGeometry';

describe('custom color submenu placement', () => {
  const surface = { width: 248, height: 290 };
  it('opens beside the row, flipping left and bottom-aligning near pane edges', () => {
    expect(resolveCustomColorSubmenuPosition(
      { left: 10, top: 20, width: 224, height: 100 }, { left: 18, top: 80, width: 208, height: 32 },
      surface, { width: 760, height: 760 },
    )).toEqual({ left: 238, top: 80 });
    expect(resolveCustomColorSubmenuPosition(
      { left: 520, top: 580, width: 224, height: 100 }, { left: 528, top: 648, width: 208, height: 32 },
      surface, { width: 760, height: 760 },
    )).toEqual({ left: 268, top: 390 });
  });
  it('keeps all controls inside a narrow pane when side-by-side placement is impossible', () => {
    const position = resolveCustomColorSubmenuPosition(
      { left: 120, top: 50, width: 224, height: 100 }, { left: 128, top: 120, width: 208, height: 32 },
      surface, { width: 360, height: 420 },
    );
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.top).toBeGreaterThanOrEqual(8);
    expect(position.left + surface.width).toBeLessThanOrEqual(352);
    expect(position.top + surface.height).toBeLessThanOrEqual(412);
  });
});
