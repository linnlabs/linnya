import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolvePresentationBuildWorkerPath } from './resolvePresentationBuildWorkerPath';

describe('resolvePresentationBuildWorkerPath', () => {
  it('resolves the single packaged worker identity below the Slides artifact root', () => {
    expect(resolvePresentationBuildWorkerPath('/plugins/slides/1.1.0')).toBe(
      path.resolve(
        '/plugins/slides/1.1.0',
        'dist/backend/presentation-build-worker.cjs',
      ),
    );
  });
});
