import type { EditorMessageResolver } from '../../../definitions/editorMessages';

export function formatImageFileSize(bytes: number, editorMessage: EditorMessageResolver): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return editorMessage('editor.imageBlock.value.unknown');

  const unitBase = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(unitBase));

  return `${Math.round((bytes / Math.pow(unitBase, unitIndex)) * 100) / 100} ${sizes[unitIndex]}`;
}

export function formatImageDateTime(
  timestamp: number | null,
  editorMessage: EditorMessageResolver,
  locale: string,
): string {
  if (!timestamp) return editorMessage('editor.imageBlock.value.unknown');

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

export function getImageFormat(src: string, editorMessage: EditorMessageResolver): string {
  if (!src) return editorMessage('editor.imageBlock.value.unknown');

  if (src.startsWith('data:')) {
    const match = src.match(/data:image\/([^;,]+)/);
    if (!match) return editorMessage('editor.imageBlock.value.unknown');

    const format = match[1].toUpperCase();
    if (format === 'JPEG') return 'JPG';
    if (format === 'SVG+XML') return 'SVG';
    return format;
  }

  const srcWithoutQuery = src.split(/[?#]/)[0] ?? src;
  const decodedMediaPath = decodeMediaLocatorPath(srcWithoutQuery);
  const extensionSource = decodedMediaPath || srcWithoutQuery;
  const extension = extensionSource.split('.').pop()?.toLowerCase();
  const formatMap: Readonly<Record<string, string>> = {
    jpg: 'JPG',
    jpeg: 'JPG',
    png: 'PNG',
    gif: 'GIF',
    webp: 'WebP',
    svg: 'SVG',
    bmp: 'BMP',
  };

  return formatMap[extension || ''] || extension?.toUpperCase() || editorMessage('editor.imageBlock.value.unknown');
}

function decodeMediaLocatorPath(src: string): string | null {
  const match = src.match(/^media:\/\/load\/[^/]+\/([A-Za-z0-9_-]+)$/);
  if (!match) return null;

  try {
    const encoded = match[1];
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function getImageDimensions(
  width: number | null | undefined,
  height: number | null | undefined,
  editorMessage: EditorMessageResolver,
): string {
  if (width && height) {
    return `${width} × ${height} px`;
  }
  if (width) {
    return editorMessage('editor.imageBlock.value.widthOnly', { width });
  }
  if (height) {
    return editorMessage('editor.imageBlock.value.heightOnly', { height });
  }

  return editorMessage('editor.imageBlock.value.originalSize');
}
