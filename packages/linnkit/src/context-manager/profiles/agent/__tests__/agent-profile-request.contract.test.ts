import { describe, expect, it } from 'vitest';

import type { FenceInjection } from '../../shared/fences';
import type { AgentProfileRequest } from '../contracts';

describe('AgentProfileRequest contract', () => {
  it('accepts host-provided fence injections without product-specific legacy fields', () => {
    const fences: FenceInjection[] = [
      {
        kind: 'memory-context',
        content: 'remember this',
        attrs: { memoryId: 'mem-1' },
      },
    ];
    const request: AgentProfileRequest = {
      query: 'hello',
      promptKey: 'default',
      fences,
    };

    expect(request.fences).toBe(fences);
  });
});
