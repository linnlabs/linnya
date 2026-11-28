import { describe, expect, it } from 'vitest';
import type { PluginCliToolStructuredResult } from '@app/schemas';
import { projectPluginCliCompactStep, projectPluginCliPresentation } from './projectPluginCliPresentation';

const argv = ['export', '--presentation', 'deck-1', '--note', '季度 复盘'];
const result: PluginCliToolStructuredResult = {
  data: {
    plugin_id: 'slides',
    argv,
    exit_code: 0,
    stdout: '{"kind":"linnya.slides.export-report","file":{"locator":"conversation:/slides-exports/季度 复盘-v3.pptx"}}\n',
    stderr: 'font fallback: Inter\n',
  },
  observation: 'exported',
};

describe('projectPluginCliPresentation：外部命令行运行插件命令的工具卡', () => {
  it('完成后标题写插件命令与子命令，内容给出完整命令行、缩进后的报告和 stderr', () => {
    const projection = projectPluginCliPresentation({
      sourceToolName: 'plugin_cli',
      uiKey: 'plugin_cli',
      args: { plugin_id: 'slides', argv },
      result,
      status: 'success',
      phase: 'complete',
    });

    expect(projection.title).toEqual({
      text: { key: 'conversation.tool.pluginCli.completed', fallback: '已运行 {command}', params: { command: 'linnya-slides export' } },
    });
    expect(projection.data).toEqual({
      kind: 'completed',
      commandLine: 'linnya-slides export --presentation deck-1 --note "季度 复盘"',
      output: [
        '{',
        '  "kind": "linnya.slides.export-report",',
        '  "file": {',
        '    "locator": "conversation:/slides-exports/季度 复盘-v3.pptx"',
        '  }',
        '}',
        '',
        'font fallback: Inter',
      ].join('\n'),
    });
  });

  it('说明文字原样显示；运行中参数读不出时不编造命令', () => {
    const help = projectPluginCliPresentation({
      sourceToolName: 'plugin_cli',
      uiKey: 'plugin_cli',
      args: { plugin_id: 'slides', argv: ['--help'] },
      result: { ...result, data: { ...result.data, argv: ['--help'], stdout: 'Linnya Slides CLI\n\nUsage:\n', stderr: '' } },
      status: 'success',
      phase: 'complete',
    });
    expect(help.data).toMatchObject({ commandLine: 'linnya-slides --help', output: 'Linnya Slides CLI\n\nUsage:' });
    expect(help.title?.text.params).toEqual({ command: 'linnya-slides' });

    const streaming = projectPluginCliPresentation({
      sourceToolName: 'plugin_cli',
      uiKey: 'plugin_cli',
      args: { plugin_id: 'slides' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    });
    expect(streaming).toEqual({
      data: { kind: 'lifecycle' },
      title: { text: { key: 'conversation.tool.pluginCli.runningUnknown', fallback: '正在运行插件命令' } },
    });
    expect(projectPluginCliCompactStep({
      sourceToolName: 'plugin_cli',
      uiKey: 'plugin_cli',
      toolCallId: 'call-1',
      args: { plugin_id: 'slides', argv: ['render', '--slide', '2'] },
      result: undefined,
      status: 'error',
      phase: 'error',
    }).title.params).toEqual({ command: 'linnya-slides render' });
  });
});
