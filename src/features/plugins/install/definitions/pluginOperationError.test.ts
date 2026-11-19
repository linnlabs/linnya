import { describe, expect, it } from 'vitest';
import { PluginOperationError, toPluginOperationError } from './pluginOperationError';

describe('PluginOperationError', () => {
  it('preserves a category attached at the failure point', () => {
    const error = new PluginOperationError('artifact-integrity', 'checksum is invalid', {
      pluginId: 'knowledge',
    });

    expect(toPluginOperationError(error)).toBe(error);
    expect(error.code).toBe('artifact-integrity');
    expect(error.pluginId).toBe('knowledge');
  });

  it('does not infer categories from incidental message words', () => {
    expect(toPluginOperationError(new Error('schema validation failed; source=official'))).toMatchObject({
      code: 'unknown',
    });
  });

  it('recognizes the platform disk-full error without parsing text', () => {
    const error = Object.assign(new Error('write failed'), { code: 'ENOSPC' });
    expect(toPluginOperationError(error)).toMatchObject({ code: 'disk-space' });
  });
});
