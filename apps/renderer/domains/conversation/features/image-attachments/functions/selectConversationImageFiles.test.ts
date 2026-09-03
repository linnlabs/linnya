import { describe, expect, it } from 'vitest';
import { selectConversationImageFiles } from './selectConversationImageFiles';

describe('selectConversationImageFiles', () => {
  it('paste 只提取图片意图，有普通文本时不阻止编辑器继续粘贴', () => {
    const png = new File(['png'], 'image.png', { type: 'image/png' });
    const gif = new File(['gif'], 'image.gif', { type: 'image/gif' });
    const emptyMimeJpeg = new File(['jpeg'], 'camera.JPEG');
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' });

    expect(selectConversationImageFiles({
      source: 'paste',
      files: [png, text, gif, emptyMimeJpeg],
      hasPlainText: true,
    })).toEqual({
      files: [png, gif, emptyMimeJpeg],
      shouldConsumeEvent: false,
    });
  });

  it.each(['picker', 'drop'] as const)(
    '%s 不静默过滤非图片，所有文件都交给同一 host ingress 验证',
    (source) => {
      const png = new File(['png'], 'image.png', { type: 'image/png' });
      const text = new File(['text'], 'notes.txt', { type: 'text/plain' });

      expect(selectConversationImageFiles({ source, files: [png, text] })).toEqual({
        files: [png, text],
        shouldConsumeEvent: true,
      });
    },
  );

  it('纯文本 paste 不进入图片 staging，也不消费事件', () => {
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' });

    expect(selectConversationImageFiles({
      source: 'paste',
      files: [text],
      hasPlainText: true,
    })).toEqual({ files: [], shouldConsumeEvent: false });
  });
});
