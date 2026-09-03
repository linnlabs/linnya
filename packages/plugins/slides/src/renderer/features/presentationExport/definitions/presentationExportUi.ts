import type { PresentationExportFormat } from '@plugin/slides/shared/presentationExport';

export type PresentationExportUiFormat = Exclude<PresentationExportFormat, 'pdf'>;
export type PresentationExportMenuValue = `export-${PresentationExportUiFormat}`;

export interface PresentationExportMenuOption {
  readonly value: PresentationExportMenuValue;
  readonly text: string;
}
