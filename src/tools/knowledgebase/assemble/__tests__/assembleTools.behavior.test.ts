import { describe, expect, it } from 'vitest';
import { AssembleDocumentsTool } from '../AssembleDocumentsTool';
import type { ToolContext } from '../../../types';

describe('assemble_documents behavior', () => {
  it('assemble_documents 应保持原状：返回 control.terminateRun=true', async () => {
    const tool = new AssembleDocumentsTool();
    const ctx: ToolContext = {};
    const out = await tool.run({ query: 'q', selected_blocks: [] }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    const control = parsed['control'] as Record<string, unknown> | undefined;
    expect(control).toBeDefined();
    expect(control?.['terminateRun']).toBe(true);
  });
});
