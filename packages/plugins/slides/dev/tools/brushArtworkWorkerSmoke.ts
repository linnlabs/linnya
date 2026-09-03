import { createHash } from 'node:crypto';
import { app } from 'electron';
import sharp from 'sharp';
import {
  registerHiddenWorker,
  unregisterHiddenWorker,
} from '@plugin/backend/hiddenWorkerRuntime';
import {
  createBrushArtworkWorkerDefinition,
  createPresentationBrushArtworkGenerator,
} from '../../src/backend/features/presentationBrushArtworkGeneration';
import type { BrushArtworkRenderRequest } from '../../src/shared/brushArtwork';

const requests: readonly BrushArtworkRenderRequest[] = [
  {
    requestId: 'smoke-a-1',
    widthPx: 640,
    heightPx: 180,
    intent: {
      seed: 17,
      backgroundColor: '#FFF4DC',
      quality: 'standard',
      layers: [
        {
          fill: { kind: 'watercolor', color: '#D97757', opacity: 72, bleed: 0.24 },
          marks: [
            { type: 'ellipse', center: [34, 48], radiusX: 24, radiusY: 30, irregularity: 0.4 },
            { type: 'ellipse', center: [62, 52], radiusX: 22, radiusY: 26, irregularity: 0.3 },
          ],
        },
        {
          stroke: { brush: 'charcoal', color: '#633B2E', weight: 0.7 },
          field: 'hand',
          marks: [
            { type: 'spline', points: [[12, 78], [35, 36, 0.7], [60, 62], [90, 22, 0.5]], curvature: 0.55 },
            { type: 'arc', center: [52, 48], radius: 28, startAngle: 200, endAngle: 350 },
          ],
        },
      ],
    },
  },
  {
    requestId: 'smoke-b',
    widthPx: 480,
    heightPx: 320,
    intent: {
      seed: 23,
      backgroundColor: '#F5EEDC',
      quality: 'standard',
      layers: [
        {
          fill: { kind: 'mass', brush: 'pastel', color: '#7C3AED', strength: 0.8 },
          marks: [{ type: 'polygon', points: [[10, 80], [28, 16], [58, 28], [84, 12], [92, 78]] }],
        },
        {
          stroke: { brush: 'rotring', color: '#312E81', weight: 0.5 },
          hatch: { brush: '2H', color: '#6D28D9', spacing: 3, angle: 32, randomness: 0.1 },
          marks: [{ type: 'rect', x: 18, y: 24, width: 64, height: 56 }],
        },
      ],
    },
  },
  {
    requestId: 'smoke-a-2',
    widthPx: 640,
    heightPx: 180,
    intent: {
      seed: 17,
      backgroundColor: '#FFF4DC',
      quality: 'standard',
      layers: [
        {
          fill: { kind: 'watercolor', color: '#D97757', opacity: 72, bleed: 0.24 },
          marks: [
            { type: 'ellipse', center: [34, 48], radiusX: 24, radiusY: 30, irregularity: 0.4 },
            { type: 'ellipse', center: [62, 52], radiusX: 22, radiusY: 26, irregularity: 0.3 },
          ],
        },
        {
          stroke: { brush: 'charcoal', color: '#633B2E', weight: 0.7 },
          field: 'hand',
          marks: [
            { type: 'spline', points: [[12, 78], [35, 36, 0.7], [60, 62], [90, 22, 0.5]], curvature: 0.55 },
            { type: 'arc', center: [52, 48], radius: 28, startAngle: 200, endAngle: 350 },
          ],
        },
      ],
    },
  },
];

void run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);

async function run(): Promise<void> {
  await app.whenReady();
  await registerHiddenWorker(createBrushArtworkWorkerDefinition({
    mode: 'source-development',
    packageRoot: process.cwd(),
    rootSource: 'explicit',
  }));
  try {
    const generator = createPresentationBrushArtworkGenerator();
    const hashes: string[] = [];
    for (const request of requests) {
      const result = await generator.generateBrushArtwork(request);
      if (result.widthPx !== request.widthPx || result.heightPx !== request.heightPx) {
        throw new Error(`Brush dimensions drifted for ${request.requestId}.`);
      }
      const decoded = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
      for (let index = 3; index < decoded.length; index += 4) {
        if (decoded[index] !== 255) {
          throw new Error(`Brush output must be opaque: ${request.requestId}.`);
        }
      }
      hashes.push(createHash('sha256').update(result.bytes).digest('hex'));
    }
    if (hashes[0] !== hashes[2]) {
      throw new Error('Job-scoped Brush A → B → A output is not deterministic.');
    }
    console.log(JSON.stringify({
      status: 'passed',
      requestCount: requests.length,
      deterministicHash: hashes[0],
    }));
  } finally {
    await unregisterHiddenWorker('slides-brush');
  }
}
