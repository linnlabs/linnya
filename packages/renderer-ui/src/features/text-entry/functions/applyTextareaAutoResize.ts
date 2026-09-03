import type { TextareaAutoResizeOptions } from '../definitions/textareaAutoResize';

function readTextareaMinHeight(textarea: HTMLTextAreaElement): number {
  const parsedMinHeight = Number.parseFloat(getComputedStyle(textarea).minHeight);
  return Number.isFinite(parsedMinHeight) ? parsedMinHeight : 0;
}

export function applyTextareaAutoResize(
  textarea: HTMLTextAreaElement,
  options: TextareaAutoResizeOptions = {},
): number {
  const minHeight = options.minHeight ?? readTextareaMinHeight(textarea);
  textarea.style.height = 'auto';
  // 强制浏览器完成 height=auto 的布局计算，避免 scrollHeight 沿用旧布局。
  void textarea.offsetHeight;

  const contentHeight = textarea.scrollHeight;
  const nextHeight =
    options.maxHeight === undefined
      ? Math.max(minHeight, contentHeight)
      : Math.max(minHeight, Math.min(contentHeight, options.maxHeight));
  const isOverflowing = options.maxHeight !== undefined && contentHeight > options.maxHeight;

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden';

  const shouldFollowCursor =
    options.scrollToBottomWhenCursorAtEnd === true &&
    textarea.selectionStart === textarea.value.length &&
    textarea.selectionEnd === textarea.value.length;

  if (isOverflowing && shouldFollowCursor) {
    textarea.scrollTop = contentHeight;
  }

  return nextHeight;
}
