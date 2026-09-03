import { describe, expect, it, vi } from 'vitest';

import { runAppShutdownStages } from './runAppShutdownStages';

describe('runAppShutdownStages', () => {
  it('网页渲染器失败后仍收口后端命令 owner，并传播不完整结果', async () => {
    const backendShutdown = vi.fn().mockResolvedValue(undefined);
    await expect(runAppShutdownStages([
      async () => { throw new Error('renderer cleanup failed'); },
      backendShutdown,
    ])).rejects.toMatchObject({ name: 'AppShutdownStagesError' });
    expect(backendShutdown).toHaveBeenCalledOnce();
  });
});
