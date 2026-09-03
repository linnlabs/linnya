import { beforeEach, describe, expect, it, vi } from 'vitest';

const LoggerMock = vi.fn().mockImplementation(() => ({
  debug: vi.fn(),
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: LoggerMock,
}));

describe('HistoryPurificationPreprocessor config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('使用 logPrefix 作为日志标签，同时不改变注册用的 preprocessor name', async () => {
    const { HistoryPurificationPreprocessor } = await import('../historyPurification');

    const preprocessor = new HistoryPurificationPreprocessor({
      logPrefix: 'Agent-HistoryPurification',
    });

    expect(preprocessor.name).toBe('HistoryPurificationPreprocessor');
    expect(LoggerMock).toHaveBeenCalledWith('Agent-HistoryPurification');
  });
});
