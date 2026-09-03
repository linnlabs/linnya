export type WorkspaceExportExtension = 'txt' | 'md' | 'pdf';

export interface WorkspaceExportFileNameInput {
  readonly currentFileName: string;
  readonly extension: WorkspaceExportExtension;
  readonly untitledBaseName: string;
}

export function buildWorkspaceExportFileName({
  currentFileName,
  extension,
  untitledBaseName,
}: WorkspaceExportFileNameInput): string {
  const baseName = currentFileName.trim().length > 0
    ? stripLastExtension(currentFileName)
    : untitledBaseName;

  return `${baseName}.${extension}`;
}

function stripLastExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}
