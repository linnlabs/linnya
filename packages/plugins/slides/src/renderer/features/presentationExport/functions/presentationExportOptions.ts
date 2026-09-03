import type { ExportArtifactTargetRequest } from '@plugin/renderer/exportArtifact';
import type {
  PresentationExportChartMode,
  PresentationExportFormat,
  PresentationExportImageWidth,
  PresentationExportRequest,
} from '@plugin/slides/shared/presentationExport';
import {
  PRESENTATION_EXPORT_ARTIFACTS,
  buildPresentationExportFileName,
} from '@plugin/slides/shared/presentationExport';
import { SLIDES_PLUGIN_ID } from '@plugin/slides/shared/pluginMeta';
import type {
  PresentationExportMenuOption,
  PresentationExportMenuValue,
  PresentationExportUiFormat,
} from '../definitions/presentationExportUi';

export const PRESENTATION_EXPORT_MENU_OPTIONS: readonly PresentationExportMenuOption[] = [
  { value: 'export-pptx', text: '导出为 PPTX' },
  { value: 'export-images', text: '导出为图片' },
];

const FORMAT_DIALOG_LABELS = {
  pptx: { title: '导出为 PPTX', filterName: 'PowerPoint 演示文稿' },
  images: { title: '导出为图片', filterName: 'PNG 图片压缩包' },
} as const;

export function resolvePresentationExportMenuFormat(
  value: string | number | boolean,
): PresentationExportUiFormat | null {
  if (value === 'export-pptx') return 'pptx';
  if (value === 'export-images') return 'images';
  return null;
}

export function buildPresentationExportTargetRequest(input: {
  readonly title: string;
  readonly format: PresentationExportUiFormat;
}): ExportArtifactTargetRequest {
  const artifact = PRESENTATION_EXPORT_ARTIFACTS[input.format];
  const labels = FORMAT_DIALOG_LABELS[input.format];
  return {
    pluginId: SLIDES_PLUGIN_ID,
    suggestedFileName: buildPresentationExportFileName(input.title, input.format),
    extension: artifact.extension,
    mediaType: artifact.mediaType,
    labels: {
      title: labels.title,
      buttonLabel: '导出',
      filterName: labels.filterName,
    },
  };
}

export function buildPresentationExportRequest(input: {
  readonly nodeId: string;
  readonly targetToken: string;
  readonly exportId: string;
  readonly format: PresentationExportUiFormat;
  readonly chartMode: PresentationExportChartMode;
  readonly imageWidthPx: PresentationExportImageWidth;
}): PresentationExportRequest {
  const base = { nodeId: input.nodeId, targetToken: input.targetToken };
  if (input.format === 'pptx') {
    return { ...base, format: 'pptx', chartMode: input.chartMode };
  }
  return {
    ...base,
    format: 'images',
    widthPx: input.imageWidthPx,
    exportId: input.exportId,
  };
}

export function resolvePresentationImageExportProgressPercent(input: {
  readonly completedPages: number;
  readonly totalPages: number;
}): number {
  if (input.totalPages === 0) return 0;
  return Math.round(input.completedPages / input.totalPages * 100);
}

export function resolvePresentationExportPixelSize(input: {
  readonly widthPx: PresentationExportImageWidth;
  readonly slideWidth: number;
  readonly slideHeight: number;
}): { readonly width: number; readonly height: number } {
  return {
    width: input.widthPx,
    height: Math.round(input.widthPx * input.slideHeight / input.slideWidth),
  };
}

export type { PresentationExportMenuValue };
