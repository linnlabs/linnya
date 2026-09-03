import { describe, expect, it } from 'vitest';

describe('src/agent/ports public exports snapshot', () => {
  it('exposes the documented ports contract surface', async () => {
    const moduleUnderTest = await import('../index');
    expect(Object.keys(moduleUnderTest).sort()).toMatchSnapshot();
  });

  it('does not leak unrelated runtime helpers', async () => {
    const moduleUnderTest = await import('../index');
    const symbols = Object.keys(moduleUnderTest);

    expect(symbols).not.toContain('LlmCaller');
    expect(symbols).not.toContain('GraphExecutor');
    expect(symbols).not.toContain('generateMessageId');
  });
});
