import { describe, expect, it } from 'vitest';

import { analyzeMarkdownDomainBoundarySource } from '../guards/markdown-domain-boundary-guard';

describe('markdown domain boundary guard', () => {
  it('允许 Workspace 通过 Markdown 公开入口读取内建文档实体', () => {
    expect(analyzeMarkdownDomainBoundarySource(
      'src/features/workspace/vfs/orchestration/readWorkspaceVfsNode.ts',
      "import { readMarkdownVfsContent } from 'src/domains/markdown';",
    )).toEqual([]);
  });

  it('禁止 Workspace 深入 Markdown feature 与 SQLite 实现', () => {
    const violations = analyzeMarkdownDomainBoundarySource(
      'src/features/workspace/vfs/orchestration/readWorkspaceVfsNode.ts',
      "import { readVersion } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/versionRepository';",
    );
    expect(violations.map(violation => violation.ruleId)).toEqual([
      'MARKDOWN-BOUNDARY-01-workspace-no-deep-import',
    ]);
  });

  it('禁止五个通用工具直接认识 Markdown，包括公开入口', () => {
    const violations = analyzeMarkdownDomainBoundarySource(
      'src/tools/workspace/read_file/workspaceDocumentReadAdapter.ts',
      "import { MarkdownDocumentService } from 'src/domains/markdown';",
    );
    expect(violations.map(violation => violation.ruleId)).toEqual([
      'MARKDOWN-BOUNDARY-02-generic-tools-use-host-contract',
    ]);
  });

  it('禁止 ToolContext 重新注入 Markdown 具体服务', () => {
    const violations = analyzeMarkdownDomainBoundarySource(
      'src/tools/types.ts',
      "type Store = import('src/domains/markdown').MarkdownDocumentService;",
    );
    expect(violations.map(violation => violation.ruleId)).toEqual([
      'MARKDOWN-BOUNDARY-03-tool-context-has-no-markdown-service',
    ]);
  });

  it('不把测试 fixture 的内部 schema 依赖误判为生产耦合', () => {
    expect(analyzeMarkdownDomainBoundarySource(
      'src/tools/workspace/read_file/__tests__/fixture.test.ts',
      "import { SCHEMA } from 'src/domains/markdown/features/document-storage/infrastructure/sqlite/schema';",
    )).toEqual([]);
  });

  it('禁止重新建立 Workspace Markdown 专属工具岛', () => {
    const violations = analyzeMarkdownDomainBoundarySource(
      'src/tools/workspace/markdown/LegacyMarkdownTool.ts',
      'export class LegacyMarkdownTool {}',
    );
    expect(violations.map(violation => violation.ruleId)).toEqual([
      'MARKDOWN-BOUNDARY-04-no-workspace-markdown-tool-island',
    ]);
  });

  it('禁止重新建立无领域归属的通用 Table 工具岛', () => {
    const violations = analyzeMarkdownDomainBoundarySource(
      'src/tools/table/WriteToTableTool.ts',
      'export class WriteToTableTool {}',
    );
    expect(violations.map(violation => violation.ruleId)).toEqual([
      'MARKDOWN-BOUNDARY-05-no-generic-table-tool-island',
    ]);
  });
});
