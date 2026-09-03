import type { DocumentOcrModelProfile } from '../definitions/documentOcr';

export class DocumentOcrPageLimitError extends Error {
  constructor(args: {
    filename: string;
    modelName: string;
    pageCount: number;
    maxInputPages: number;
  }) {
    super(
      `PDF "${args.filename}" 共 ${args.pageCount} 页，当前 OCR 模型 ${args.modelName} 单次最多解析 ${args.maxInputPages} 页。为避免上游忽略超出页，请先拆分后上传。`
    );
    this.name = 'DocumentOcrPageLimitError';
  }
}

export function hasDocumentOcrPageLimit(
  profile: DocumentOcrModelProfile | undefined
): profile is DocumentOcrModelProfile & { readonly maxInputPages: number } {
  return profile?.maxInputPages !== undefined;
}

export function assertDocumentOcrPageLimit(args: {
  filename: string;
  pageCount: number;
  profile: DocumentOcrModelProfile;
}): void {
  if (!hasDocumentOcrPageLimit(args.profile) || args.pageCount <= args.profile.maxInputPages) {
    return;
  }

  throw new DocumentOcrPageLimitError({
    filename: args.filename,
    modelName: args.profile.displayName,
    pageCount: args.pageCount,
    maxInputPages: args.profile.maxInputPages,
  });
}
