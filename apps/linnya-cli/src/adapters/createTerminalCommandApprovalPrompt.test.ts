import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createTerminalCommandApprovalPrompt } from './createTerminalCommandApprovalPrompt';

describe('terminal command approval prompt', () => {
  it('把 readline 截获的 Ctrl+C 交回 Runtime lifecycle', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const onInterrupt = vi.fn();
    const prompt = createTerminalCommandApprovalPrompt({ input, output, onInterrupt });

    input.write('\u0003');
    await new Promise(resolve => setImmediate(resolve));

    expect(onInterrupt).toHaveBeenCalledOnce();
    prompt.close();
  });
});
