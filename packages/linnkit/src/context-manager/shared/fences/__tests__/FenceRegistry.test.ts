import { describe, expect, it } from 'vitest';

import { createFenceRegistry, type FenceDescriptor } from '../FenceRegistry';

function createDescriptor(overrides: Partial<FenceDescriptor> = {}): FenceDescriptor {
  return {
    kind: 'memory-context',
    llmRole: 'user',
    placement: 'before-current-user',
    lifetime: 'turn-only',
    formatter: (content) => `<memory-context>\n${content}\n</memory-context>`,
    ...overrides,
  };
}

describe('FenceRegistry', () => {
  it('registers, retrieves, and lists descriptors', () => {
    const registry = createFenceRegistry();
    const descriptor = createDescriptor();

    registry.register(descriptor);

    expect(registry.get('memory-context')).toBe(descriptor);
    expect(registry.list()).toEqual([descriptor]);
  });

  it('rejects duplicate fence kinds', () => {
    const registry = createFenceRegistry();
    registry.register(createDescriptor());

    expect(() => registry.register(createDescriptor())).toThrow(/already registered/i);
  });

  it('requires kebab-case kinds', () => {
    const registry = createFenceRegistry();

    expect(() => registry.register(createDescriptor({ kind: 'MemoryContext' }))).toThrow(/kebab-case/i);
    expect(() => registry.register(createDescriptor({ kind: 'memory_context' }))).toThrow(/kebab-case/i);
  });

  it('requires maxBudgetFraction to be within (0, 1]', () => {
    const registry = createFenceRegistry();

    expect(() => registry.register(createDescriptor({ maxBudgetFraction: 0 }))).toThrow(/maxBudgetFraction/i);
    expect(() => registry.register(createDescriptor({ maxBudgetFraction: 1.1 }))).toThrow(/maxBudgetFraction/i);
  });
});
