import { describe, expect, it } from 'vitest';import { diffSnapshots, normalizeInspectSnapshot, serializeSnapshot, toSnapshotString } from '../engine/parser/InspectSnapshot.js';
import type { PresentationInfo } from '@plugin/slides/shared';

function makeInfo(overrides?: Partial<PresentationInfo>): PresentationInfo {
  return {
    slideCount: 1,
    slideSize: { width: 10, height: 5.625 },
    slides: [
      {
        number: 1,
        elements: [
          { name: 'Title 1', creationId: 'abc-123', type: 'text', text: 'Hello', position: { x: 1, y: 1, w: 8, h: 1 } },
        ],
      },
    ],
    theme: {
      colors: { accent1: '#FF0000' },
      fonts: { major: 'Arial', minor: 'Calibri' },
      chart: { palette: ['#B64646', '#4776B1'] },
    },
    masters: [{ name: 'Master 1', layouts: ['Layout 1'] }],
    ...overrides,
  };
}

describe('InspectSnapshot', () => {
  describe('normalizeInspectSnapshot', () => {
    it('produces stable output for the same input', () => {
      const info = makeInfo();
      const a = serializeSnapshot(normalizeInspectSnapshot(info));
      const b = serializeSnapshot(normalizeInspectSnapshot(info));
      expect(a).toBe(b);
    });

    it('strips creationId from elements', () => {
      const info = makeInfo();
      const snapshot = normalizeInspectSnapshot(info);
      const json = JSON.stringify(snapshot);
      expect(json).not.toContain('abc-123');
      expect(json).not.toContain('creationId');
    });

    it('strips element name from output', () => {
      const info = makeInfo();
      const snapshot = normalizeInspectSnapshot(info);
      const json = JSON.stringify(snapshot);
      expect(json).not.toContain('"name"');
    });

    it('rounds position values to 3 decimals', () => {
      const info = makeInfo({
        slides: [{
          number: 1,
          elements: [{
            name: 'T', type: 'text', text: 'Hi',
            position: { x: 1.00049999, y: 2.12345678, w: 3.9999, h: 4.0015 },
          }],
        }],
      });
      const snapshot = normalizeInspectSnapshot(info);
      const pos = snapshot.slides[0].elements[0].position!;
      expect(pos.x).toBe(1);
      expect(pos.y).toBe(2.123);
      expect(pos.w).toBe(4);
      expect(pos.h).toBe(4.002);
    });

    it('sorts elements by position (y, x)', () => {
      const info = makeInfo({
        slides: [{
          number: 1,
          elements: [
            { name: 'B', type: 'text', text: 'Bottom', position: { x: 1, y: 5, w: 1, h: 1 } },
            { name: 'A', type: 'text', text: 'Top', position: { x: 1, y: 1, w: 1, h: 1 } },
            { name: 'C', type: 'text', text: 'TopRight', position: { x: 5, y: 1, w: 1, h: 1 } },
          ],
        }],
      });
      const snapshot = normalizeInspectSnapshot(info);
      expect(snapshot.slides[0].elements.map((e) => e.text)).toEqual(['Top', 'TopRight', 'Bottom']);
    });

    it('includes masterCount', () => {
      const info = makeInfo({
        masters: [
          { name: 'M1', layouts: ['L1'] },
          { name: 'M2', layouts: ['L2', 'L3'] },
        ],
      });
      const snapshot = normalizeInspectSnapshot(info);
      expect(snapshot.masterCount).toBe(2);
    });

    it('preserves theme chart palette in normalized snapshot', () => {
      const snapshot = normalizeInspectSnapshot(makeInfo());
      expect(snapshot.theme.chart?.palette).toEqual(['#B64646', '#4776B1']);
    });
  });

  describe('toSnapshotString', () => {
    it('returns a JSON string', () => {
      const info = makeInfo();
      const str = toSnapshotString(info);
      expect(() => JSON.parse(str)).not.toThrow();
    });
  });

  describe('diffSnapshots', () => {
    it('reports equal for identical snapshots', () => {
      const info = makeInfo();
      const str = toSnapshotString(info);
      const diff = diffSnapshots(str, str);
      expect(diff.equal).toBe(true);
      expect(diff.differences).toHaveLength(0);
    });

    it('detects text changes', () => {
      const a = toSnapshotString(makeInfo());
      const modified = makeInfo({
        slides: [{
          number: 1,
          elements: [{ name: 'Title 1', type: 'text', text: 'Changed', position: { x: 1, y: 1, w: 8, h: 1 } }],
        }],
      });
      const b = toSnapshotString(modified);
      const diff = diffSnapshots(a, b);

      expect(diff.equal).toBe(false);
      expect(diff.differences.some((d) => d.path.includes('text'))).toBe(true);
    });

    it('detects element additions', () => {
      const a = toSnapshotString(makeInfo());
      const modified = makeInfo({
        slideCount: 1,
        slides: [{
          number: 1,
          elements: [
            { name: 'Title 1', type: 'text', text: 'Hello', position: { x: 1, y: 1, w: 8, h: 1 } },
            { name: 'New', type: 'shape', position: { x: 1, y: 3, w: 2, h: 2 } },
          ],
        }],
      });
      const b = toSnapshotString(modified);
      const diff = diffSnapshots(a, b);

      expect(diff.equal).toBe(false);
      expect(diff.differences.some((d) => d.path.includes('elements'))).toBe(true);
    });

    it('detects position changes', () => {
      const a = toSnapshotString(makeInfo());
      const modified = makeInfo({
        slides: [{
          number: 1,
          elements: [{ name: 'Title 1', type: 'text', text: 'Hello', position: { x: 2, y: 1, w: 8, h: 1 } }],
        }],
      });
      const b = toSnapshotString(modified);
      const diff = diffSnapshots(a, b);

      expect(diff.equal).toBe(false);
      expect(diff.differences.some((d) => d.path.includes('position') || d.path.includes('.x'))).toBe(true);
    });

    it('detects slide count changes', () => {
      const a = toSnapshotString(makeInfo());
      const modified = makeInfo({ slideCount: 2 });
      const b = toSnapshotString(modified);
      const diff = diffSnapshots(a, b);

      expect(diff.equal).toBe(false);
      expect(diff.differences.some((d) => d.path.includes('slideCount'))).toBe(true);
    });
  });
});
