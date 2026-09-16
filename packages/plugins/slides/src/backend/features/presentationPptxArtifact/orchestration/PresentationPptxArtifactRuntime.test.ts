import { describe, expect, it, vi } from 'vitest';
import type { PresentationPptxArtifactSourceRecord } from '../../../persistence/index.js';
import { PresentationPptxArtifactRuntime } from './PresentationPptxArtifactRuntime.js';

const SOURCE: PresentationPptxArtifactSourceRecord = {
  nodeId: 'deck-1',
  currentRevisionId: 'revision-2',
  currentRevision: 2,
  deckSource: 'compose({ title: "Demo", slides: [] });',
  deckSpec: { title: 'Demo', slides: [] },
  title: 'Demo',
  artifact: { state: 'deferred' },
};

describe('PresentationPptxArtifactRuntime', () => {
  it('相同 revision 的并发读取只物化一次并以 CAS 缓存', async () => {
    const materialize = vi.fn(async () => Buffer.from('pptx-v2'));
    const savePresentationPptxArtifact = vi.fn(async () => true);
    const runtime = new PresentationPptxArtifactRuntime({
      repository: {
        getPresentationPptxArtifactSource: vi.fn(async () => SOURCE),
        savePresentationPptxArtifact,
      },
      materialize,
    });

    const [first, second] = await Promise.all([
      runtime.loadCurrent('deck-1'),
      runtime.loadCurrent('deck-1'),
    ]);
    expect(materialize).toHaveBeenCalledOnce();
    expect(savePresentationPptxArtifact).toHaveBeenCalledWith(
      'deck-1',
      'revision-2',
      expect.any(Buffer),
    );
    expect(first.pptxBuffer.equals(second.pptxBuffer)).toBe(true);
  });

  it('已有 current artifact 时直接返回，不启动物化', async () => {
    const materialize = vi.fn(async () => Buffer.from('unexpected'));
    const runtime = new PresentationPptxArtifactRuntime({
      repository: {
        getPresentationPptxArtifactSource: vi.fn(async () => ({
          ...SOURCE,
          artifact: {
            state: 'ready',
            revisionId: 'revision-2',
            buffer: Buffer.from('cached'),
          },
        })),
        savePresentationPptxArtifact: vi.fn(async () => true),
      },
      materialize,
    });

    const result = await runtime.loadCurrent('deck-1');
    expect(result.pptxBuffer.equals(Buffer.from('cached'))).toBe(true);
    expect(materialize).not.toHaveBeenCalled();
  });
});
