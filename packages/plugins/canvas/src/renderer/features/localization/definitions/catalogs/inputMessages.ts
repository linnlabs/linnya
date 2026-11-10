import { defineCanvasMessages } from '../../functions/defineCanvasMessages';

/** 复制、剪切、粘贴、拖入图片的提示。 */
export const INPUT_MESSAGES = defineCanvasMessages(
  {
    'canvas.input.paste.readonly': '画布为只读，无法粘贴',
    'canvas.input.paste.denied': '无法读取剪贴板，请回到此窗口后重新粘贴。',
    'canvas.input.paste.unsupported': '这段内容暂时不能粘贴到画布。',
    'canvas.input.copy.denied': '无法写入剪贴板，请回到此窗口后重新复制。',
    'canvas.input.copy.failed': '复制失败，请重试。',
    'canvas.input.cut.readonly': '画布为只读，无法剪切',
    'canvas.input.cut.readonlyAfterCopy': '内容已复制，画布现为只读，原卡已保留',
    'canvas.input.image.readonly': '画布为只读，无法插入图片',
    'canvas.input.image.unreadable': '图片字节读取失败',
    'canvas.input.image.readCancelled': '图片读取已取消',
    'canvas.input.image.sourceClosed': '图片导入的画布已关闭',
    'canvas.input.image.editorClosed': '原文字卡已关闭，请重新插入图片',
    'canvas.input.image.notAdopted': '此图片尚未接管，请通过插入或粘贴图片文件导入',
    'canvas.input.drop.readonly': '画布为只读，无法添加卡片',
    'canvas.input.surface.noClipboardCopy': '当前表面未配置子图复制',
    'canvas.input.surface.noImagePaste': '当前表面未配置图片粘贴',
    'canvas.input.surface.imageNotReady': '图片导入尚未就绪',
  },
  {
    'canvas.input.paste.readonly': 'This canvas is read-only, so nothing can be pasted.',
    'canvas.input.paste.denied':
      "Couldn't read the clipboard. Return to this window and paste again.",
    'canvas.input.paste.unsupported': "This content can't be pasted onto the canvas yet.",
    'canvas.input.copy.denied':
      "Couldn't write to the clipboard. Return to this window and copy again.",
    'canvas.input.copy.failed': 'Copy failed. Please try again.',
    'canvas.input.cut.readonly': 'This canvas is read-only, so nothing can be cut.',
    'canvas.input.cut.readonlyAfterCopy':
      'Copied, but this canvas is now read-only, so the original cards were kept.',
    'canvas.input.image.readonly': 'This canvas is read-only, so images cannot be inserted.',
    'canvas.input.image.unreadable': "Couldn't read the image data.",
    'canvas.input.image.readCancelled': 'Image reading was cancelled.',
    'canvas.input.image.sourceClosed': 'The canvas for this image import was closed.',
    'canvas.input.image.editorClosed': 'The original text card was closed. Insert the image again.',
    'canvas.input.image.notAdopted':
      'This image has not been imported yet. Import it by inserting or pasting an image file.',
    'canvas.input.drop.readonly': 'This canvas is read-only, so cards cannot be added.',
    'canvas.input.surface.noClipboardCopy': 'This surface is not set up to copy subgraphs.',
    'canvas.input.surface.noImagePaste': 'This surface is not set up to paste images.',
    'canvas.input.surface.imageNotReady': 'Image import is not ready yet.',
  }
);
