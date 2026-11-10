import { expect, it } from 'vitest';
import { canvasTextureUploadFacts } from '../performancePaintTrace';

it('keeps WebGL allocation, pixel-buffer and subimage dimensions distinct across overloads', () => {
  expect(canvasTextureUploadFacts('texImage2D', [3553, 0, 6408, 128, 64, 0, 6408, 5121, null]))
    .toMatchObject({ sourceKind: 'null-allocation', width: 128, height: 64 });
  expect(canvasTextureUploadFacts('texSubImage2D', [3553, 0, 2, 3, 70, 58, 6408, 5121, new Uint8Array(4), 1]))
    .toMatchObject({ sourceKind: 'typed-array', width: 70, height: 58 });
  expect(canvasTextureUploadFacts('texImage2D', [3553, 0, 6408, 128, 64, 0, 6408, 5121, 32]))
    .toMatchObject({ sourceKind: 'buffer-offset', width: 128, height: 64 });
});

it('preserves an unknown source as unknown instead of inventing source pixels or dimensions', () => {
  expect(canvasTextureUploadFacts('texSubImage2D', [3553, 0, 0, 0, 6408, 5121, {}]))
    .toEqual({ method: 'texSubImage2D', sourceKind: 'unknown', sourceWidth: undefined, sourceHeight: undefined, width: undefined, height: undefined });
});
