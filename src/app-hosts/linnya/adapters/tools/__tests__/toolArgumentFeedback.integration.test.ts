import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import * as builtin from '../../../plugin-registry/builtin';
import { ToolRegistry } from '../toolRegistry';

const executed = vi.fn();

/** 只在测试registry中注册，验证实际npm BaseTool接入，不增加平台工具。 */
class QueryFixtureTool extends BaseTool {
  readonly name = 'query_fixture';
  readonly description = 'Neutral tool for argument admission.';
  readonly parameters: ToolParameterSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Query' },
      limit: { type: 'integer', description: 'Limit' },
    },
    required: ['query'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    executed(args);
    return JSON.stringify({ data: {}, observation: 'Query completed.' });
  }
}

afterEach(() => { vi.restoreAllMocks(); executed.mockClear(); });

describe('published framework argument feedback through the Host registry', () => {
  it('rejects a misspelled field with actionable names and only executes the corrected call', async () => {
    vi.spyOn(builtin, 'getRegisteredToolClasses').mockReturnValue([QueryFixtureTool]);
    vi.spyOn(builtin, 'getRegisteredHostOnlyToolNames').mockReturnValue([]);
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const input = { query: 'private-input', limti: 'private-unknown-value' };
    const rejected = await registry.executeTool('query_fixture', input, {});
    expect(rejected).toMatchObject({ success: false, errorKind: 'protocol' });
    expect(rejected.error).toContain('Allowed parameters: "query", "limit"');
    expect(rejected.error).toContain('"limti" → "limit"');
    expect(rejected.error).not.toContain('private-input');
    expect(rejected.error).not.toContain('private-unknown-value');
    expect(input).toEqual({ query: 'private-input', limti: 'private-unknown-value' });
    expect(executed).not.toHaveBeenCalled();

    const repaired = { query: 'private-input', limit: 5 };
    expect(await registry.executeTool('query_fixture', repaired, {})).toMatchObject({ success: true });
    expect(executed).toHaveBeenCalledExactlyOnceWith(repaired);
  });
});
