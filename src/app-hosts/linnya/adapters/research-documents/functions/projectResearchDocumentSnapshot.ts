import { createHash } from 'node:crypto';
import { formatWorkspaceFileLocator } from '@app/schemas';
import type { WorkspaceVfsReadResult } from 'src/features/workspace/vfs';
import {
  ResearchDocumentError,
  type ResearchDocumentSnapshot,
} from '../../../application/research/definitions/researchDocumentPort';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** 同一次 VFS current 读取同时提供正文和 canonical 来源，避免跨两次读取拼接版本。 */
export function projectResearchDocumentSnapshot(read: WorkspaceVfsReadResult): ResearchDocumentSnapshot {
  if (!read.ok) {
    throw new ResearchDocumentError('RESEARCH_DOCUMENT_MISSING', read.message);
  }
  if (read.truncated) {
    throw new ResearchDocumentError('RESEARCH_DOCUMENT_TRUNCATED', '研究文档超过完整读取范围，不能接纳截断正文。');
  }
  if (
    read.node.type !== 'document' || read.node.is_virtual ||
    read.contentType !== 'text/markdown' || read.metadata?.view !== 'current' ||
    read.text.trim().length === 0 || !read.citationProjection
  ) {
    throw new ResearchDocumentError('RESEARCH_DOCUMENT_INVALID', '研究交接要求非空的正式 Markdown current 文档。');
  }
  const { sources, diagnostics } = read.citationProjection;
  if (diagnostics.some(diagnostic => diagnostic.code === 'invalid_citation')) {
    throw new ResearchDocumentError('RESEARCH_DOCUMENT_CITATION_INVALID', '研究文档含未绑定的正式引用，必须修复后重新接纳。');
  }
  const representation = 'workspace-markdown-current-v1';
  // sources 是 Citation owner 接纳后的完整快照；不能改用 read_file 的会话别名或预算后摘录。
  const citationSha256 = hash({ sources, diagnostics });
  return {
    inode: read.node.inode,
    locator: formatWorkspaceFileLocator(read.node.path),
    representation,
    sha256: hash({ representation, contentType: read.contentType, text: read.text, citationSha256 }),
    citationSha256,
    text: read.text,
  };
}
