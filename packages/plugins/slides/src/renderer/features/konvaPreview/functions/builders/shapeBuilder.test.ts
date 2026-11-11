import { describe, expect, it } from 'vitest';
import type { ShapeRenderNode } from '../../../../types/render';
import { buildShapeRenderInstruction } from './shapeBuilder';

function createLine(overrides: Partial<ShapeRenderNode> = {}): ShapeRenderNode {
  return {
    id: 'line-1',
    kind: 'shape',
    geometry: { type: 'preset', name: 'line' },
    box: { x: 0, y: 0, w: 4, h: 1, unit: 'in' },
    zIndex: 1,
    ...overrides,
  };
}

describe('shapeBuilder line Paint contract', () => {
  it('renders line color only from stroke.paint instead of reviving fill fallback', () => {
    const instruction = buildShapeRenderInstruction(createLine({
      fill: { type: 'solid', color: '#FF0000' },
    }));

    expect(instruction.primitive).toBe('line');
    expect(instruction.config).not.toHaveProperty('stroke');
    expect(instruction.config).not.toHaveProperty('strokeWidth');
  });

  it('maps a linear stroke Paint without borrowing fill opacity', () => {
    const instruction = buildShapeRenderInstruction(createLine({
      opacity: 0.25,
      fill: { type: 'none' },
      stroke: {
        width: 2,
        paint: {
          type: 'linear',
          angle: 0,
          stops: [
            { color: '#22C55E', position: 0 },
            { color: '#FACC15', position: 1 },
          ],
        },
      },
    }));

    expect(instruction.config).toMatchObject({
      strokeWidth: 2 * (96 / 72),
      strokeLinearGradientColorStops: [0, '#22C55E', 1, '#FACC15'],
    });
  });

  it('converts shape shadow geometry from RenderModel points to Konva pixels', () => {
    const instruction = buildShapeRenderInstruction({
      ...createLine(),
      geometry: { type: 'preset', name: 'rect' },
      shadow: {
        color: '#000000',
        blur: 3,
        offsetX: 1.5,
        offsetY: 2.25,
        opacity: 0.4,
      },
    });

    expect(instruction.config).toMatchObject({
      shadowBlur: 3,
      shadowOffsetX: 2,
      shadowOffsetY: 3,
      shadowOpacity: 0.4,
    });
  });

  it('keeps a typed line path open in the Konva instruction', () => {
    const instruction = buildShapeRenderInstruction(createLine({
      geometry: {
        type: 'path',
        viewBox: { width: 100, height: 100 },
        commands: [
          { type: 'moveTo', x: 0, y: 100 },
          { type: 'lineTo', x: 100, y: 0 },
        ],
        closed: false,
      },
    }));

    expect(instruction).toMatchObject({
      primitive: 'line',
      config: { closed: false },
    });
  });

  it('多个子路径走 Konva.Path 并按奇偶规则填充，内圈挖空而不是被 Line 连成一笔', () => {
    const instruction = buildShapeRenderInstruction(createLine({
      geometry: {
        type: 'path',
        viewBox: { width: 10, height: 10 },
        commands: [
          { type: 'moveTo', x: 0, y: 0 }, { type: 'lineTo', x: 10, y: 0 }, { type: 'lineTo', x: 10, y: 10 }, { type: 'close' },
          { type: 'moveTo', x: 3, y: 3 }, { type: 'lineTo', x: 7, y: 3 }, { type: 'lineTo', x: 7, y: 7 }, { type: 'close' },
        ],
        closed: true,
      },
    }));

    expect(instruction.primitive).toBe('path');
    expect(instruction.config).toMatchObject({ fillRule: 'evenodd' });
    expect(instruction.primitive === 'path' && instruction.config.data.match(/M /g)).toHaveLength(2);
  });
});
