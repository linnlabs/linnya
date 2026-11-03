import type { DocumentReferenceInput, DocumentReferenceMarkdownBinding, JsonValue } from '@app/schemas';
import type { ReferenceNode } from '../../../definitions/documentReferences';
export interface ReferenceMarkdownPort {
  read(documentId: string): ReferenceNode | null;
  location(documentId: string): { readonly path: string } | null;
  resolvePath(projectId: string, path: string): ReferenceNode | null;
}
export interface ReferenceMarkdownBaseline {
  readonly bindings: readonly DocumentReferenceMarkdownBinding[];
  readonly unprojectableReferenceIds: readonly string[];
}
export interface ReferenceMarkdownPrepared {
  readonly content: JsonValue;
  readonly references: readonly DocumentReferenceInput[];
  readonly bindings: readonly DocumentReferenceMarkdownBinding[];
}
export class ReferenceMarkdownError extends Error {
  constructor(readonly code: 'reference_read_required' | 'reference_projection_lossy' | 'reference_path_changed' | 'reference_path_not_found' | 'reference_source_unavailable') {
    const messages = {
      reference_read_required: '该正文包含文档引用。请先通过可信读取入口重新读取，再替换正文。',
      reference_projection_lossy: '该正文含失效或越界的文档引用，不能无损替换。请使用 append 保留原节点，或先在界面处理引用。',
      reference_path_changed: '引用的文档在读取或准备后改名、移动或被同路径新文档替换。请重新读取后再提交。',
      reference_path_not_found: 'workspace 文档链接没有对应的同项目活动文档。请使用当前 workspace 路径。',
      reference_source_unavailable: '来源文档不存在、已删除或没有活动项目归属。',
    };
    super(messages[code]); this.name = 'ReferenceMarkdownError';
  }
}
