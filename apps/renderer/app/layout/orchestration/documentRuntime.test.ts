// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createDocumentSurfaceRuntime } from './documentRuntime';

describe('Document Surface runtime', () => {
  it('只等待通用 surface ready，不要求 Markdown editor 实例', async () => {
    const runtime = createDocumentSurfaceRuntime();
    const surface = { type: 'editor', id: 'document-1' };
    const ready = runtime.waitForSurfaceReady(surface);

    runtime.markSurfaceReady(surface);

    await expect(ready).resolves.toBeUndefined();
    runtime.clearSurfaceReady(surface);
  });
});
