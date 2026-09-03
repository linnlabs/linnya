import { describe, expect, it, vi } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { isFlexComposeInput } from '@plugin/slides/shared';
import { pptComposeProfile, readPptComposeRawPayload } from '../../sandbox/pptComposeProfile';
import { resolveImageSources } from '../../engine/assets/imageSourceResolver';
import { compileFlexInput } from '../compose/flex-layout/FlexLayoutCompiler';
import { initYoga } from '../compose/flex-layout/YogaAdapter';
import { buildDeckSpecFromDirectInput } from '../compose/presentationComposeInput';

const SOURCE = `
const slide = createSlide({ background: '#F5EEDC' });
slide.add(createBrushArtwork({
  seed: 23,
  backgroundColor: '#F5EEDC',
  quality: 'standard',
  layers: [{
    fill: {
      kind: 'watercolor',
      color: '#9A3412',
      bleed: 0.22,
    },
    marks: [{
      type: 'ellipse',
      center: [50, 50],
      radiusX: 34,
      radiusY: 28,
    }],
  }],
  position: 'absolute',
  x: 1,
  y: 1.5,
  width: 4.8,
  height: 2.6,
  alt: '复古棕红水彩色块',
}));
compose({ title: 'Brush Artwork', slides: [slide] });
`;

describe('Brush Artwork codegen integration', () => {
  it('从公开 DSL 保留作者意图，并把最终 Image 盒传给图片物化边界', async () => {
    const service = createSandboxService();
    const execution = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      profileMode: 'codegen-source',
      source: SOURCE,
      capabilities: [{ name: 'host.compose', maxBytes: 256 * 1024 }],
    });
    expect(execution.success).toBe(true);
    const payload = readPptComposeRawPayload(execution.value);
    expect(payload).not.toBeNull();
    if (!payload || !isFlexComposeInput(payload.rawPayload)) {
      throw new Error('Expected Flex compose input.');
    }

    await initYoga();
    const compiled = compileFlexInput(payload.rawPayload);
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected compiled input.');
    const deck = buildDeckSpecFromDirectInput(compiled.input);
    const image = deck.slides[0].spec.elements[0];
    expect(image).toEqual(expect.objectContaining({
      type: 'image',
      position: { x: 1, y: 1.5, w: 4.8, h: 2.6 },
      src: {
        kind: 'brush_artwork',
        seed: 23,
        backgroundColor: '#F5EEDC',
        quality: 'standard',
        layers: [{
          fill: {
            kind: 'watercolor',
            color: '#9A3412',
            bleed: 0.22,
          },
          marks: [{
            type: 'ellipse',
            center: [50, 50],
            radiusX: 34,
            radiusY: 28,
          }],
        }],
      },
    }));

    const resolveImageSource = vi.fn(async () => ({
      kind: 'data_uri' as const,
      dataUri: 'data:image/png;base64,AQ==',
    }));
    await resolveImageSources(deck, { resolveImageSource }, {
      documentId: 'presentation-brush-1',
    });
    expect(resolveImageSource).toHaveBeenCalledWith({
      kind: 'brush_artwork',
      seed: 23,
      backgroundColor: '#F5EEDC',
      quality: 'standard',
      layers: [{
        fill: {
          kind: 'watercolor',
          color: '#9A3412',
          opacity: 150,
          bleed: 0.22,
          bleedDirection: 'out',
          texture: 0.8,
          border: 0.5,
          scatter: true,
        },
        marks: [{
          type: 'ellipse',
          center: [50, 50],
          radiusX: 34,
          radiusY: 28,
          irregularity: 0,
        }],
      }],
    }, {
      documentId: 'presentation-brush-1',
      targetSizeInches: { width: 4.8, height: 2.6 },
    });
    expect(deck.slides[0].spec.elements[0]).toEqual(expect.objectContaining({
      src: { kind: 'data_uri', dataUri: 'data:image/png;base64,AQ==' },
    }));
  });
});

function createSandboxService(): SandboxService {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  return new SandboxService(registry, createSandboxEvaluatorTestRunner());
}
