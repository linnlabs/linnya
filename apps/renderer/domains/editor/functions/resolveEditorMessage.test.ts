import { describe, expect, it } from 'vitest';
import {
  createEditorMessageResolver,
  resolveEditorMessage,
  type EditorRawMessageResolver,
} from './resolveEditorMessage';

describe('resolveEditorMessage', () => {
  it('使用 Editor fallback 解析文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback) => fallback;

    expect(resolveEditorMessage('editor.menu.insertImage', rawResolver)).toBe('插入图片');
    expect(resolveEditorMessage('editor.providerOutboundDebug.overviewTab', rawResolver)).toBe('请求概览');
  });

  it('透传参数给底层 message resolver', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => (
      fallback.replace('{fileName}', String(params?.fileName))
    );
    const editorMessage = createEditorMessageResolver(rawResolver);

    expect(editorMessage('editor.menu.toast.imageInserted', { fileName: 'demo.png' })).toBe('图片已插入：demo.png');
  });

  it('用户提示不拼接底层错误详情', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => {
      let message = fallback;
      for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
        message = message.replace(`{${paramKey}}`, String(paramValue));
      }
      return message;
    };
    const editorMessage = createEditorMessageResolver(rawResolver);

    expect(editorMessage('editor.menu.toast.imageLoadFailed', { message: 'ENOENT: demo.png' }))
      .toBe('无法加载图片，请确认文件仍可访问。');
    expect(editorMessage('editor.menu.toast.imageFlowFailed', { message: 'preload missing' }))
      .toBe('插入图片流程出错，请稍后重试。');
    expect(editorMessage('editor.slash.toast.imageLoadFailed', { message: 'bad data url' }))
      .toBe('无法加载图片，请确认文件仍可访问。');
    expect(editorMessage('editor.slash.toast.imageFlowFailed', { message: 'dialog rejected' }))
      .toBe('插入图片流程出错，请稍后重试。');
    expect(editorMessage('editor.annotation.toast.createFailed', { message: 'missing panel' }))
      .toBe('创建批注失败，请稍后重试。');
    expect(editorMessage('editor.tableBlock.alert.aiFillFailed', { message: 'selection lost' }))
      .toBe('执行 AI 填充时出错，请稍后重试。');
    expect(editorMessage('editor.service.loadFileFailed', { errorMessage: 'ENOENT: demo.md' }))
      .toBe('加载文件失败，请稍后重试。');
    expect(editorMessage('editor.shortcuts.save.unexpectedError', { errorMessage: 'disk full' }))
      .toBe('保存时发生意外错误，请稍后重试。');
    expect(editorMessage('editor.tableBlock.selection.metadataProcessingFailed', { message: 'bad selection' }))
      .toBe('处理选区元数据失败，请稍后重试。');
    expect(editorMessage('editor.tableBlock.selection.formattingFailed', { message: 'bad json' }))
      .toBe('格式化错误，请稍后重试。');
  });

  it('解析表格选区错误文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => {
      let message = fallback;
      for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
        message = message.replace(`{${paramKey}}`, String(paramValue));
      }
      return message;
    };

    expect(resolveEditorMessage('editor.tableBlock.selection.invalidState', rawResolver))
      .toBe('无效的编辑器状态');
    expect(resolveEditorMessage('editor.tableBlock.selection.noValidSelection', rawResolver))
      .toBe('未选择有效的表格区域');
    expect(resolveEditorMessage('editor.tableBlock.selection.metadataProcessingFailed', rawResolver, {
      message: 'bad selection',
    })).toBe('处理选区元数据失败，请稍后重试。');
    expect(resolveEditorMessage('editor.tableBlock.selection.formattingFailed', rawResolver, {
      message: 'bad json',
    })).toBe('格式化错误，请稍后重试。');
  });

  it('解析 AI 写作输入框默认文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback) => fallback;

    expect(resolveEditorMessage('editor.aiWriting.placeholder', rawResolver))
      .toBe('AI 写作... (Shift+Enter 换行，按下空格键取消) ');
    expect(resolveEditorMessage('editor.aiWriting.cancel', rawResolver)).toBe('取消 (Esc)');
    expect(resolveEditorMessage('editor.aiWriting.submit', rawResolver)).toBe('生成 (Enter)');
  });

  it('解析编辑器块占位符文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => (
      fallback.replace('{level}', String(params?.level))
    );

    expect(resolveEditorMessage('editor.placeholder.baseBlock', rawResolver)).toBe('开始输入...');
    expect(resolveEditorMessage('editor.placeholder.baseBlockAi', rawResolver)).toBe('输入文字... 按下空格唤起 AI');
    expect(resolveEditorMessage('editor.placeholder.listItem', rawResolver)).toBe('列表项...');
    expect(resolveEditorMessage('editor.placeholder.heading', rawResolver, { level: 3 })).toBe('标题 3');
    expect(resolveEditorMessage('editor.placeholder.heading.empty', rawResolver, { level: 7 })).toBe('标题 7...');
  });

  it('解析编辑器命令错误文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback) => fallback;

    expect(resolveEditorMessage('editor.command.splitBlock.failed', rawResolver))
      .toBe('块拆分时发生错误');
  });

  it('解析 Citation KB 搜索失败文案且不拼接底层错误', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => {
      let message = fallback;
      for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
        message = message.replace(`{${paramKey}}`, String(paramValue));
      }
      return message;
    };

    expect(resolveEditorMessage('editor.citation.kb.searchFailed', rawResolver, {
      errorMessage: 'HTTP 500',
    })).toBe('知识库搜索失败，请稍后重试。');
  });

  it('解析参考文献复制空态默认文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback) => fallback;

    expect(resolveEditorMessage('editor.citation.bibliography.empty', rawResolver)).toBe('暂无引用');
  });

  it('解析 AudioBlock 渲染占位和转录错误文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => fallback
      .replace('{src}', String(params?.src))
      .replace('{fileSizeMB}', String(params?.fileSizeMB));

    expect(resolveEditorMessage('editor.audioBlock.render.file', rawResolver, { src: 'voice.webm' }))
      .toBe('音频文件: voice.webm');
    expect(resolveEditorMessage('editor.audioBlock.render.readyToRecord', rawResolver)).toBe('准备录音...');
    expect(resolveEditorMessage('editor.audioBlock.error.fileTooLarge', rawResolver, { fileSizeMB: '25.01' }))
      .toBe('音频文件过大 (25.01MB)，请确保文件小于25MB。');
    expect(resolveEditorMessage('editor.audioBlock.error.apiBaseUrlUnavailable', rawResolver))
      .toBe('无法获取API服务地址。');
    expect(resolveEditorMessage('editor.audioBlock.error.transcriptionErrorParseFailed', rawResolver))
      .toBe('转录失败，无法解析错误信息。');
    expect(resolveEditorMessage('editor.audioBlock.error.transcriptionServiceReturnedError', rawResolver))
      .toBe('转录服务返回了错误。');
  });

  it('解析 Markdown serializer 标签文案', () => {
    const rawResolver: EditorRawMessageResolver = (_key, fallback, params) => fallback
      .replace('{alt}', String(params?.alt))
      .replace('{width}', String(params?.width))
      .replace('{height}', String(params?.height));

    expect(resolveEditorMessage('editor.markdownSerializer.imageAlt', rawResolver)).toBe('图片');
    expect(resolveEditorMessage('editor.markdownSerializer.imageDescriptionWithSize', rawResolver, {
      alt: 'Demo',
      width: 320,
      height: 240,
    })).toBe('[图片：Demo，宽度320px，高度240px]');
    expect(resolveEditorMessage('editor.markdownSerializer.audioFile', rawResolver)).toBe('音频文件');
    expect(resolveEditorMessage('editor.markdownSerializer.emptyAudioBlock', rawResolver)).toBe('空音频块');
  });
});
