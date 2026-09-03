import { describe, expect, it } from 'vitest';

describe('src/agent public exports snapshot', () => {
  it('exposes the documented root public surface', async () => {
    const moduleUnderTest = await import('../index');
    expect(Object.keys(moduleUnderTest).sort()).toMatchSnapshot();
  });

  it('keeps internal helpers private', async () => {
    const moduleUnderTest = await import('../index');
    const symbols = Object.keys(moduleUnderTest);

    expect(symbols).not.toContain('TokenCalculator');
    expect(symbols).not.toContain('errorClassifier');
    expect(symbols).not.toContain('logger');
    expect(symbols).not.toContain('contextManager');
    expect(symbols).not.toContain('llmTelemetryContext');
    expect(symbols).not.toContain('llmAuditRecorder');
    const removedCompatNamespace = ['linnkit', 'Compat'].join('');
    expect(symbols).not.toContain(removedCompatNamespace);

    expect(symbols).toContain('contracts');
    expect(symbols).toContain('setLlmAuditRecorder');
  });
});
