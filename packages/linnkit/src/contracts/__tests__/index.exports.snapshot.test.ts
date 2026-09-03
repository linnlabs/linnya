import { describe, expect, it } from 'vitest';

describe('src/agent/contracts public exports snapshot', () => {
  it('exposes the documented A-class contracts surface', async () => {
    const moduleUnderTest = await import('../index');
    expect(Object.keys(moduleUnderTest).sort()).toMatchSnapshot();
  });

  it('keeps product-level schemas out of contracts', async () => {
    const moduleUnderTest = await import('../index');
    const symbols = Object.keys(moduleUnderTest);

    expect(symbols).not.toContain('PromptKeys');
    expect(symbols).not.toContain('PromptKey');
    expect(symbols).not.toContain('ConversationNextRequest');
  });
});
