import { describe, expect, it } from 'vitest';

describe('src/agent/testkit public exports snapshot', () => {
  it('exposes the documented testkit surface', async () => {
    const moduleUnderTest = await import('../index');
    expect(Object.keys(moduleUnderTest).sort()).toMatchSnapshot();
  });

  it('keeps runtime internals out of testkit', async () => {
    const moduleUnderTest = await import('../index');
    const symbols = Object.keys(moduleUnderTest);

    expect(symbols).not.toContain('GraphExecutor');
    expect(symbols).not.toContain('LlmCaller');
    expect(symbols).not.toContain('eventMapper');
  });
});
