import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coordinator: {},
  getSharedPptCoordinator: vi.fn(),
  executeSlidesCliCommand: vi.fn(),
  executeSlidesCliFontCommand: vi.fn(),
  checkFontFamily: vi.fn(),
  listFontFamilies: vi.fn(),
}));

vi.mock('@plugin/backend/fontResolution', () => ({
  checkFontFamily: mocks.checkFontFamily,
  listFontFamilies: mocks.listFontFamilies,
}));

vi.mock('../../../coordinator', () => ({
  getSharedPptCoordinator: mocks.getSharedPptCoordinator,
}));

vi.mock('./executeSlidesCliCommand', () => ({
  executeSlidesCliCommand: mocks.executeSlidesCliCommand,
}));

vi.mock('./executeSlidesCliFontCommand', () => ({
  executeSlidesCliFontCommand: mocks.executeSlidesCliFontCommand,
}));

import { slidesPluginCli } from './prepareSlidesAppHostCli';

beforeEach(() => {
  mocks.getSharedPptCoordinator.mockReset();
  mocks.getSharedPptCoordinator.mockReturnValue(mocks.coordinator);
  mocks.executeSlidesCliCommand.mockReset();
  mocks.executeSlidesCliCommand.mockResolvedValue({ exitCode: 0, stdout: 'ok\n', stderr: '' });
  mocks.executeSlidesCliFontCommand.mockReset();
  mocks.executeSlidesCliFontCommand.mockResolvedValue({ exitCode: 0, stdout: 'fonts\n', stderr: '' });
});

describe('slidesPluginCli', () => {
  it('prepare 只解析 argv 和声明权限，DB/coordinator 只在父 Shell 门禁后读取', async () => {
    const preparation = slidesPluginCli.prepare({
      argv: ['inspect', '--presentation', 'deck-1'],
      invocationId: 'command_execution_test',
      conversationRoot: '/tmp/slides-conversation',
    });

    expect(preparation.status).toBe('ready');
    expect(mocks.getSharedPptCoordinator).not.toHaveBeenCalled();
    if (preparation.status !== 'ready') throw new Error('slides CLI was not prepared');
    expect(preparation.plan.access).toEqual({
      internalDataAccess: 'required',
      conversationFiles: 'none',
      externalFiles: 'denied',
      network: 'denied',
      guiControl: 'denied',
      localIpcControl: 'denied',
    });
    const db = { kind: 'workspace-db' };
    const getDb = vi.fn(() => db);
    const signal = new AbortController().signal;

    await expect(preparation.plan.execute({
      hostContext: { databaseService: { getDb } },
      signal,
    })).resolves.toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '' });
    expect(getDb).toHaveBeenCalledOnce();
    expect(mocks.getSharedPptCoordinator).toHaveBeenCalledWith(db);
  });

  it('render 按 presentation 使用稳定工作集目录，并声明 conversation 写权限', async () => {
    const preparation = slidesPluginCli.prepare({
      argv: ['render', '--presentation', 'deck-1'],
      invocationId: 'command_execution_render',
      conversationRoot: '/tmp/slides-conversation',
    });

    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') throw new Error('slides render was not prepared');
    expect(preparation.plan.access.conversationFiles).toBe('write');
    expect(mocks.getSharedPptCoordinator).not.toHaveBeenCalled();
    await preparation.plan.execute({
      hostContext: { databaseService: { getDb: () => ({}) } },
      signal: new AbortController().signal,
    });
    expect(mocks.executeSlidesCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'render',
        outputDirectoryReference: expect.stringMatching(
          /^conversation:\/slides-renders\/presentation-[a-f0-9]{24}$/,
        ),
        request: expect.objectContaining({
          encoding: { kind: 'agent_review_jpeg' },
          output: expect.objectContaining({
            kind: 'latest_version',
            root: expect.stringMatching(
              /^\/tmp\/slides-conversation\/slides-renders\/presentation-[a-f0-9]{24}$/,
            ),
          }),
        }),
      }),
      mocks.coordinator,
      expect.any(AbortSignal),
    );
  });

  it('当前 App bridge 拒绝 --database，且不会接触 workspace DB', () => {
    const preparation = slidesPluginCli.prepare({
      argv: ['inspect', '--database', '/tmp/other.sqlite', '--presentation', 'deck-1'],
      invocationId: 'command_execution_database',
      conversationRoot: '/tmp/slides-conversation',
    });

    expect(preparation).toEqual({
      status: 'completed',
      result: {
        exitCode: 2,
        stdout: '',
        stderr: 'slides.cli.invalid_arguments: --database is not available through the current App bridge\n',
      },
    });
    expect(mocks.getSharedPptCoordinator).not.toHaveBeenCalled();
  });

  it('字体命令不读取 workspace DB，也不经过 PptCoordinator', async () => {
    const preparation = slidesPluginCli.prepare({
      argv: ['fonts', 'list', '--script', 'eastAsian'],
      invocationId: 'command_execution_fonts',
      conversationRoot: '/tmp/slides-conversation',
    });

    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') throw new Error('slides fonts was not prepared');
    expect(preparation.plan.access).toEqual({
      internalDataAccess: 'none',
      conversationFiles: 'none',
      externalFiles: 'denied',
      network: 'denied',
      guiControl: 'denied',
      localIpcControl: 'denied',
    });

    await expect(preparation.plan.execute({
      hostContext: {},
      signal: new AbortController().signal,
    })).resolves.toEqual({ exitCode: 0, stdout: 'fonts\n', stderr: '' });
    expect(mocks.getSharedPptCoordinator).not.toHaveBeenCalled();
    expect(mocks.executeSlidesCliFontCommand).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'fonts-list' }),
      {
        checkFontFamily: mocks.checkFontFamily,
        listFontFamilies: mocks.listFontFamilies,
      },
      expect.any(AbortSignal),
    );
  });
});
