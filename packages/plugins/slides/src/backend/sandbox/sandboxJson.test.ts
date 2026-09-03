import { describe, expect, it } from 'vitest';

import {
  isSandboxJsonObject,
  projectSandboxJsonObject,
} from './sandboxJson';

describe('sandbox JSON boundary', () => {
  it('rejects nested values that JSON protocols cannot represent', () => {
    expect(isSandboxJsonObject({ nested: { missing: undefined } })).toBe(false);
    expect(isSandboxJsonObject({ values: [Number.POSITIVE_INFINITY] })).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isSandboxJsonObject(cyclic)).toBe(false);
  });

  it('projects domain objects into transport-safe JSON without optional undefined fields', () => {
    const shared = { nodeId: 'layout:root' };
    expect(projectSandboxJsonObject({
      title: 'Deck',
      layout: undefined,
      slides: [
        { elements: [], notes: undefined, parent: shared },
        { elements: [], parent: shared },
      ],
    })).toEqual({
      title: 'Deck',
      slides: [
        { elements: [], parent: { nodeId: 'layout:root' } },
        { elements: [], parent: { nodeId: 'layout:root' } },
      ],
    });

    expect(() => projectSandboxJsonObject({ value: Number.NaN })).toThrow(
      'contains a value that JSON cannot represent',
    );
    expect(() => projectSandboxJsonObject({ values: [undefined] })).toThrow(
      'contains a value that JSON cannot represent',
    );
  });
});
