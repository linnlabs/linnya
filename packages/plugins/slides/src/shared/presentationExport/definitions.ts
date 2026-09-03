export const PRESENTATION_EXPORT_FORMATS = ['pptx', 'images', 'pdf'] as const;
export type PresentationExportFormat = typeof PRESENTATION_EXPORT_FORMATS[number];

export const PRESENTATION_EXPORT_IMAGE_WIDTHS = [1280, 1920, 3840] as const;
export type PresentationExportImageWidth = typeof PRESENTATION_EXPORT_IMAGE_WIDTHS[number];

export type PresentationExportChartMode = 'native' | 'image';

interface PresentationExportRequestBase {
  readonly nodeId: string;
  readonly targetToken: string;
}

export type PresentationExportRequest =
  | PresentationExportRequestBase & {
      readonly format: 'pptx';
      readonly chartMode: PresentationExportChartMode;
    }
  | PresentationExportRequestBase & {
      readonly format: 'images';
      readonly widthPx: PresentationExportImageWidth;
      /** Renderer 生成的本次导出身份，只用于关联瞬时页级进度。 */
      readonly exportId: string;
    }
  | PresentationExportRequestBase & {
      readonly format: 'pdf';
    };

export interface PresentationExportResult {
  readonly format: PresentationExportFormat;
  readonly fileName: string;
  readonly byteLength: number;
}

export interface PresentationImageExportProgress {
  readonly exportId: string;
  readonly completedPages: number;
  readonly totalPages: number;
}

export const DEFAULT_PRESENTATION_EXPORT_CHART_MODE: PresentationExportChartMode = 'native';
export const DEFAULT_PRESENTATION_EXPORT_IMAGE_WIDTH: PresentationExportImageWidth = 1920;

export const PRESENTATION_EXPORT_ARTIFACTS = {
  pptx: {
    extension: 'pptx',
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  images: {
    extension: 'zip',
    mediaType: 'application/zip',
  },
  pdf: {
    extension: 'pdf',
    mediaType: 'application/pdf',
  },
} as const satisfies Readonly<Record<PresentationExportFormat, {
  readonly extension: string;
  readonly mediaType: string;
}>>;
