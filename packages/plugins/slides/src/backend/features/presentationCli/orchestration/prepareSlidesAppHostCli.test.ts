import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coordinator: {
    getDocumentBuildState: vi.fn(),
    export: vi.fn(),
  },
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
  mocks.coordinator.getDocumentBuildState.mockReset();
  mocks.coordinator.export.mockReset();
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

  it('export 把当前版本的 PPTX 写进会话目录，报告版本号与 conversation: 定位符', async () => {
    const conversationRoot = await mkdtemp(path.join(os.tmpdir(), 'slides-export-'));
    try {
      const pptx = Buffer.from('PK\u0003\u0004 pptx bytes');
      mocks.coordinator.getDocumentBuildState.mockResolvedValue({
        state: 'ready', presentationId: 'deck-1', versionId: 'revision-3', versionNumber: 3, sourceHash: 'a'.repeat(64),
      });
      mocks.coordinator.export.mockResolvedValue({ fileName: '季度/复盘:草案.pptx', buffer: pptx });
      const preparation = slidesPluginCli.prepare({
        argv: ['export', '--presentation', 'deck-1'],
        invocationId: 'call_export',
        conversationRoot,
      });
      if (preparation.status !== 'ready') throw new Error('slides export was not prepared');
      // 写会话文件需要写权限；只读档的运行由宿主在执行前拒绝。
      expect(preparation.plan.access).toMatchObject({ internalDataAccess: 'required', conversationFiles: 'write' });
      expect(mocks.getSharedPptCoordinator).not.toHaveBeenCalled();

      const result = await preparation.plan.execute({
        conversationId: 'conversation-1',
        agentRunId: 'run-1',
        hostContext: { databaseService: { getDb: () => ({ kind: 'workspace-db' }) } },
        signal: new AbortController().signal,
      });

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        kind: 'linnya.slides.export-report',
        presentation: { id: 'deck-1', versionId: 'revision-3', versionNumber: 3 },
        file: { format: 'pptx', fileName: '季度_复盘_草案-v3.pptx', sizeBytes: pptx.byteLength },
      });
      const relativePath = String(report.file.locator).replace(/^conversation:\//u, '');
      expect(relativePath).toMatch(/^slides-exports\/presentation-[0-9a-f]{24}\/季度_复盘_草案-v3\.pptx$/u);
      expect(await readFile(path.join(conversationRoot, ...relativePath.split('/')))).toEqual(pptx);
      // 先写临时文件再改名，目录里不留半成品。
      expect(await readdir(path.dirname(path.join(conversationRoot, ...relativePath.split('/'))))).toEqual(['季度_复盘_草案-v3.pptx']);
    } finally {
      await rm(conversationRoot, { recursive: true, force: true });
    }
  });

  it('export 遇到未解决的源码草稿时给出明确错误，不导出上一版', async () => {
    const conversationRoot = await mkdtemp(path.join(os.tmpdir(), 'slides-export-draft-'));
    try {
      mocks.coordinator.getDocumentBuildState.mockResolvedValue({
        state: 'draft', presentationId: 'deck-1', versionId: 'revision-2', versionNumber: 2,
        sourceHash: 'b'.repeat(64), draftStatus: 'failed',
      });
      const preparation = slidesPluginCli.prepare({
        argv: ['export', '--presentation', 'deck-1'],
        invocationId: 'call_export',
        conversationRoot,
      });
      if (preparation.status !== 'ready') throw new Error('slides export was not prepared');
      const result = await preparation.plan.execute({
        conversationId: 'conversation-1',
        agentRunId: 'run-1',
        hostContext: { databaseService: { getDb: () => ({ kind: 'workspace-db' }) } },
        signal: new AbortController().signal,
      });

      expect(result).toMatchObject({ exitCode: 3, stdout: '' });
      expect(result.stderr).toMatch(/^slides\.cli\.unresolved_draft: .*version 2 is the last successful build/u);
      expect(mocks.coordinator.export).not.toHaveBeenCalled();
      expect(await readdir(conversationRoot)).toEqual([]);
    } finally {
      await rm(conversationRoot, { recursive: true, force: true });
    }
  });

  it('export 只接受 --presentation 与 --format', () => {
    const preparation = slidesPluginCli.prepare({
      argv: ['export', '--presentation', 'deck-1', '--slide', '2'],
      invocationId: 'call_export',
      conversationRoot: '/tmp/slides-conversation',
    });
    expect(preparation).toMatchObject({
      status: 'completed',
      result: { exitCode: 2, stderr: 'slides.cli.invalid_arguments: export accepts only --presentation and --format\n' },
    });
  });
});
