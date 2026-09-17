import type {
  MarkdownImportResult,
  ProseMirrorJsonNode,
} from '../../normalization/runtime';

export type MarkdownImporter = (markdown: string) => Promise<MarkdownImportResult>;

export type MarkdownRootBlockJson = ProseMirrorJsonNode & {
  readonly type: 'rootBlock';
  readonly attrs: Record<string, unknown>;
};

export interface PreparedPendingReplacement {
  readonly rootBlock: MarkdownRootBlockJson;
}
