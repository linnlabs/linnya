import {
  PRESENTATION_EXPORT_IMAGE_WIDTHS,
  type PresentationExportFormat,
  type PresentationExportImageWidth,
  type PresentationImageExportProgress,
  type PresentationExportRequest,
} from './definitions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(record: Readonly<Record<string, unknown>>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isPresentationExportImageWidth(
  value: unknown,
): value is PresentationExportImageWidth {
  return typeof value === 'number'
    && PRESENTATION_EXPORT_IMAGE_WIDTHS.some(width => width === value);
}

export function parsePresentationExportRequest(value: unknown): PresentationExportRequest {
  if (!isRecord(value)) {
    throw new Error('slides:export payload must be an object.');
  }
  const nodeId = readNonEmptyString(value, 'nodeId');
  const targetToken = readNonEmptyString(value, 'targetToken');

  if (value.format === 'pptx') {
    if (value.chartMode !== 'native' && value.chartMode !== 'image') {
      throw new Error('chartMode must be native or image.');
    }
    return { nodeId, targetToken, format: 'pptx', chartMode: value.chartMode };
  }
  if (value.format === 'images') {
    if (!isPresentationExportImageWidth(value.widthPx)) {
      throw new Error('widthPx must be 1280, 1920, or 3840.');
    }
    return {
      nodeId,
      targetToken,
      format: 'images',
      widthPx: value.widthPx,
      exportId: readNonEmptyString(value, 'exportId'),
    };
  }
  if (value.format === 'pdf') {
    return { nodeId, targetToken, format: 'pdf' };
  }
  throw new Error('format must be pptx, images, or pdf.');
}

export function parsePresentationImageExportProgress(
  value: unknown,
): PresentationImageExportProgress {
  if (!isRecord(value)) {
    throw new Error('slides image export progress must be an object.');
  }
  const exportId = readNonEmptyString(value, 'exportId');
  const completedPages = value.completedPages;
  const totalPages = value.totalPages;
  if (
    !isInteger(completedPages)
    || !isInteger(totalPages)
    || totalPages < 1
    || completedPages < 0
    || completedPages > totalPages
  ) {
    throw new Error('image export page progress is invalid.');
  }
  return {
    exportId,
    completedPages,
    totalPages,
  };
}

function sanitizePresentationTitle(title: string): string {
  const sanitized = Array.from(title.trim() || '演示文稿', character => (
    '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32
      ? '-'
      : character
  )).join('').replace(/[.\s]+$/u, '');
  return sanitized || '演示文稿';
}

export function buildPresentationExportFileName(
  title: string,
  format: PresentationExportFormat,
): string {
  const safeTitle = sanitizePresentationTitle(title);
  if (format === 'pptx') return `${safeTitle}.pptx`;
  if (format === 'images') return `${safeTitle}-images.zip`;
  return `${safeTitle}.pdf`;
}
