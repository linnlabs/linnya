import type {
  PresentationSourceKind,
  TemplateSpec,
  TemplateSummary,
  ThemeSpec,
} from '@plugin/slides/shared';
import type {
  DeckAssembleOptions,
  DeckAssemblerPort,
  ImageSourceResolverPort,
  PatchCompilerPort,
  PptxReaderPort,
} from '@plugin/slides/backend-engine-core';
import type {
  ExportedPresentationFile,
} from '@plugin/slides/backend-engine-core';
import type {
  PresentationDraftErrorKind,
  PresentationDraftRecord,
  PresentationDraftRepositoryPort,
  PresentationDocumentRecord,
  PresentationRepositoryPort,
  PresentationTemplateRecord,
} from '../persistence';

export interface GeneratePresentationOptions {
  projectId: string;
  parentId?: string;
  authorId?: string;
  conversationId?: string;
}

export interface GeneratePresentationResult {
  nodeId: string;
  versionId: string;
}

export interface RestorePresentationRevisionResult {
  readonly nodeId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

export interface TemplateManagerPort {
  importFromPptx(buffer: Buffer, name: string, description?: string): Promise<TemplateSpec>;
  getTheme(templateId: string): Promise<ThemeSpec | null>;
  getTemplate?(templateId: string): Promise<PresentationTemplateRecord | null>;
}

export interface WorkspacePresentationPort {
  createPresentationNode?(options: GeneratePresentationOptions & { title: string }): Promise<string>;
  deletePresentationNode?(nodeId: string): Promise<void>;
  getPresentationProjectId?(nodeId: string): Promise<string | null>;
}

export type {
  DeckAssembleOptions,
  DeckAssemblerPort,
  ExportedPresentationFile,
  ImageSourceResolverPort,
  PatchCompilerPort,
  PresentationDraftErrorKind,
  PresentationDraftRecord,
  PresentationDraftRepositoryPort,
  PresentationDocumentRecord,
  PresentationRepositoryPort,
  PresentationSourceKind,
  PresentationTemplateRecord,
  PptxReaderPort,
  TemplateSummary,
};
