import { describe, expect, it } from 'vitest';
import { formatConversationFileLocator } from '@app/schemas/file-locator';
import { SlidesCliError, SlidesCliExitCode } from '../definitions/slidesCli';
import { parseSlidesCliArgs } from './parseSlidesCliArgs';

describe('parseSlidesCliArgs', () => {
  it('把 render 参数转换成稳定截图请求', () => {
    const invocation = parseSlidesCliArgs([
      'render',
      '--database', '/tmp/workspace.sqlite',
      '--presentation', 'deck-1',
      '--output', '/tmp/slides-output',
      '--from', '2',
      '--to', '4',
      '--width', '1200',
      '--pixel-ratio', '2',
      '--overwrite',
    ]);

    expect(invocation).toEqual({
      kind: 'command',
      command: {
        kind: 'render',
        databasePath: '/tmp/workspace.sqlite',
        presentationId: 'deck-1',
        request: {
          selection: {
            kind: 'range',
            fromSlideNumber: 2,
            toSlideNumber: 4,
          },
          profile: {
            id: 'slides-cli-agent-review-v1',
            viewportWidthPx: 1200,
            pixelRatio: 2,
          },
          encoding: { kind: 'agent_review_jpeg' },
          output: {
            kind: 'directory',
            root: '/tmp/slides-output',
            overwrite: true,
          },
        },
      },
    });
  });

  it('inspect 支持页选择、截断和显式启发式', () => {
    const invocation = parseSlidesCliArgs([
      'inspect',
      '--presentation', 'deck-1',
      '--slide', '3',
      '--max-slides', '5',
      '--heuristics',
    ]);

    expect(invocation).toEqual({
      kind: 'command',
      command: {
        kind: 'inspect',
        presentationId: 'deck-1',
        request: {
          selection: { kind: 'single', slideNumber: 3 },
          maxSlides: 5,
          includeHeuristics: true,
        },
      },
    });
  });

  it('不再暴露独立 diagnose 子命令', () => {
    expect(() => parseSlidesCliArgs([
      'diagnose',
      '--presentation', 'deck-1',
    ])).toThrow('Expected one of: render, inspect, fonts');
  });

  it('拒绝互相冲突的页选择参数并返回稳定 usage exit code', () => {
    expect(() => parseSlidesCliArgs([
      'inspect',
      '--presentation', 'deck-1',
      '--slide', '1',
      '--from', '1',
      '--to', '2',
    ])).toThrowError(expect.objectContaining<Partial<SlidesCliError>>({
      code: 'slides.cli.invalid_arguments',
      exitCode: SlidesCliExitCode.INVALID_ARGUMENTS,
    }));
  });

  it('在启动截图 runtime 前拒绝超出统一像素预算的 render profile', () => {
    expect(() => parseSlidesCliArgs([
      'render',
      '--presentation', 'deck-1',
      '--output', '/tmp/slides-output',
      '--width', '4096',
      '--pixel-ratio', '4',
    ])).toThrowError(expect.objectContaining<Partial<SlidesCliError>>({
      code: 'slides.cli.invalid_arguments',
      exitCode: SlidesCliExitCode.INVALID_ARGUMENTS,
    }));
  });

  it('help 明确说明 render JSON 与 Linux display 合同', () => {
    const invocation = parseSlidesCliArgs(['--help']);
    expect(invocation.kind).toBe('help');
    if (invocation.kind !== 'help') {
      throw new Error('Expected help invocation');
    }
    expect(invocation.text).toContain('JPEG locators');
    expect(invocation.text).toContain('non-zero exit code means the command failed');
    expect(invocation.text).toContain('do not pipe render through');
    expect(invocation.text).toContain('Xvfb');
    expect(invocation.text).toContain('fonts list');
    expect(invocation.text).toContain('fonts check');
  });

  it('受管调用自动选择对话根目录下的输出，并拒绝调用方覆盖输出目录', () => {
    const invocation = parseSlidesCliArgs(
      ['render', '--presentation', 'deck-1'],
      {
        resolveManagedRenderOutput: () => ({
          root: '/conversation/slides-renders/presentation-deck',
          directoryReference: formatConversationFileLocator(
            'slides-renders/presentation-deck',
          ),
        }),
      },
    );
    expect(invocation).toMatchObject({
      kind: 'command',
      command: {
        kind: 'render',
        outputDirectoryReference: 'conversation:/slides-renders/presentation-deck',
        request: {
          encoding: { kind: 'agent_review_jpeg' },
          output: {
            kind: 'latest_version',
            root: '/conversation/slides-renders/presentation-deck',
          },
        },
      },
    });
    expect(() => parseSlidesCliArgs(
      ['render', '--presentation', 'deck-1', '--output', '/tmp/out'],
      {
        resolveManagedRenderOutput: () => ({
          root: '/conversation/slides-renders/presentation-deck',
          directoryReference: formatConversationFileLocator(
            'slides-renders/presentation-deck',
          ),
        }),
      },
    )).toThrow('output and --overwrite are managed by the Linnya Slides host');
  });

  it('fonts check 不要求 presentation，并保留精确 family 查询', () => {
    expect(parseSlidesCliArgs([
      'fonts', 'check', '--family', ' PingFang SC ',
    ])).toEqual({
      kind: 'command',
      command: {
        kind: 'fonts-check',
        family: 'PingFang SC',
      },
    });
  });

  it('fonts list 解析脚本、限制和分页参数', () => {
    expect(parseSlidesCliArgs([
      'fonts', 'list', '--script', 'eastAsian', '--limit', '20', '--offset', '40',
    ])).toEqual({
      kind: 'command',
      command: {
        kind: 'fonts-list',
        request: { script: 'eastAsian', limit: 20, offset: 40 },
      },
    });
  });

  it('fonts list 拒绝未知脚本、无界 limit 和 presentation 参数', () => {
    expect(() => parseSlidesCliArgs([
      'fonts', 'list', '--script', 'chinese',
    ])).toThrow('--script must be one of');
    expect(() => parseSlidesCliArgs([
      'fonts', 'list', '--script', 'latin', '--limit', '101',
    ])).toThrow('--limit must not exceed 100');
    expect(() => parseSlidesCliArgs([
      'fonts', 'check', '--family', 'Georgia', '--presentation', 'deck-1',
    ])).toThrow('Presentation options are not available');
  });
});
