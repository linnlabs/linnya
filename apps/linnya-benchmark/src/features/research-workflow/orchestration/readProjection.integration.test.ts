import { describe, expect, it, vi } from 'vitest';
import {
  buildDocumentView,
  JsonValueSchema,
  WorkspaceReadFileEventDataSchema,
  type WorkspaceReadFileCitation,
} from '@app/schemas';
import type { ResearchWorkflowCliPort, ResearchToolMessage } from '../definitions/researchWorkflow';
import { readProjection } from './readProjection';
import { fakeCli, textRead, tool } from './__test-helpers__/researchWorkflowFixture';

const locator = 'workspace:/material.md';
const legacyPreview = '...（内容已截断：原始行数=1，原始字符数=12000）...';

function withCitation(
  result: ResearchToolMessage,
  snippet: string,
  title = 'Source'
): ResearchToolMessage {
  const source: WorkspaceReadFileCitation = {
    sourceType: 'web',
    ref: 'ABC234',
    index: 1,
    url: 'https://example.com/source',
    docTitle: title,
    authors: [],
    snippet,
  };
  const appendix = [
    '---',
    'Citation Sources',
    '[@ABC234] source_type=web',
    'snapshot_status=persisted source_status=not_checked',
    'url="https://example.com/source"',
    '<<<BEGIN_UNTRUSTED_CITATION_SOURCE_0123456789abcdef>>>',
    `title=${title}`,
    'excerpt:',
    snippet,
    '<<<END_UNTRUSTED_CITATION_SOURCE_0123456789abcdef>>>',
  ].join('\n');
  return {
    ...result,
    content: `${result.content}\n\n${appendix}`,
    payload: {
      ...result.payload,
      data: JsonValueSchema.parse({
        ...WorkspaceReadFileEventDataSchema.parse(result.payload.data),
        citations: { citations: [source] },
        citation_diagnostics: [],
      }),
    },
  };
}

function documentRead(content: string, offset: number) {
  const end = Math.min(offset + 4000, content.length);
  const truncated = end < content.length;
  const nextOffset = truncated ? end : null;
  return tool(
    'read_file',
    {
      source_kind: 'workspace_document',
      locator,
      inode: 'document',
      content_type: 'application/vnd.linnya.document-view',
      document: {
        documentId: 'document',
        docType: 'markdown',
        documentName: 'material',
        truncatedByChars: truncated,
        totalTextLength: content.length,
        nextOffset,
        presentation: { kind: 'text', text: content.slice(offset, end) },
      },
    },
    buildDocumentView(
      {
        documentId: 'document',
        docType: 'markdown',
        offsetChars: offset,
        totalTextLength: content.length,
        truncatedByChars: truncated,
        nextOffset,
      },
      content.slice(offset, end) + (truncated ? '... [truncated]' : '')
    )
  );
}

function read(cli: ResearchWorkflowCliPort) {
  return readProjection({ cli, projectId: 'project', record: async () => undefined }, locator);
}

describe('Workspace projection window completeness through the CLI port', () => {
  it('reads historical blob instructions and truncation quotations as ordinary numbered content', async () => {
    const content = Array.from({ length: 219 }, (_, i) =>
      i === 212
        ? `tool_output://blobs/historical; tool_output_read({}); observation truncated; [truncated]`
        : i === 213
          ? legacyPreview
          : `正文 ${i + 1}`
    ).join('\n');
    const cli = fakeCli(new Map([[locator, content]]));
    expect(await read(cli)).toMatchObject({ representation: 'text', text: content });
    expect(vi.mocked(cli.workspaceTool).mock.calls.map(([request]) => request.args)).toEqual([
      { locator, offset: 1, limit: 200 },
      { locator, offset: 201, limit: 200 },
    ]);
  });

  it('shrinks a genuinely incomplete window despite has_more=false and absent legacy metadata', async () => {
    const content = Array.from({ length: 120 }, (_, i) => `正文 ${i + 1}`).join('\n');
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        const result = textRead(
          locator,
          content,
          Number(request.args.offset),
          Number(request.args.limit)
        );
        return request.args.limit === 200
          ? {
              ...result,
              content:
                result.content === null
                  ? null
                  : result.content
                      .split('\n')
                      .filter((_, i) => i < 40 || i >= 80)
                      .join('\n'),
            }
          : result;
      }),
    });
    expect(await read(cli)).toMatchObject({ representation: 'text', text: content });
    expect(vi.mocked(cli.workspaceTool).mock.calls.map(([request]) => request.args)).toEqual([
      { locator, offset: 1, limit: 200 },
      { locator, offset: 1, limit: 100 },
      { locator, offset: 101, limit: 100 },
    ]);
  });

  it.each(['metadata', 'legacy-wrapper'] as const)(
    'recovers a truncated single line through DocumentView (%s)',
    async mode => {
      const content = `[#Abc234] ${'长'.repeat(9200)}`;
      const cli = fakeCli(new Map(), {
        workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
          if (request.args.view === 'document')
            return documentRead(content, Number(request.args.offset_chars));
          const result = textRead(locator, content, 1, Number(request.args.limit));
          return {
            ...result,
            content: mode === 'legacy-wrapper' ? `1 | 前缀\n${legacyPreview}\n尾部` : '1 | 前缀',
            payload: {
              ...result.payload,
              ...(mode === 'metadata'
                ? {
                    observation_truncation: { originalChars: content.length, previewChars: 6 },
                  }
                : {}),
            },
          };
        }),
      });
      expect(await read(cli)).toMatchObject({
        representation: 'document-view',
        text: content,
        hanCharacters: 9200,
      });
      expect(
        vi
          .mocked(cli.workspaceTool)
          .mock.calls.filter(([request]) => request.args.view === 'document')
          .map(([request]) => request.args.offset_chars)
      ).toEqual([0, 4000, 8000]);
    }
  );

  it('rejects a document version change during a truncation retry', async () => {
    let calls = 0;
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        calls += 1;
        const result = textRead(locator, '首行\n尾行', 1, Number(request.args.limit));
        const data = result.payload.data;
        if (data === null || Array.isArray(data) || typeof data !== 'object')
          throw new Error('fixture');
        const node = data.node;
        if (node === null || Array.isArray(node) || typeof node !== 'object')
          throw new Error('fixture');
        return {
          ...result,
          content: calls === 1 ? '1 | 首行' : result.content,
          payload: { ...result.payload, data: { ...data, node: { ...node, updated_at: calls } } },
        };
      }),
    });
    await expect(read(cli)).rejects.toThrow('Document changed while reading');
    expect(cli.workspaceTool).toHaveBeenCalledTimes(2);
  });

  it('does not accept a separately truncated DocumentView as a complete fallback', async () => {
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        const result =
          request.args.view === 'document'
            ? documentRead('原文', 0)
            : textRead(locator, '原文', 1, Number(request.args.limit));
        return {
          ...result,
          payload: {
            ...result.payload,
            observation_truncation: { originalChars: 100, previewChars: 10 },
          },
        };
      }),
    });
    await expect(read(cli)).rejects.toThrow('Truncated DocumentView envelope');
  });

  it('does not mistake a verified citation title or excerpt for an outer truncation wrapper', async () => {
    const content = '正文 [@ABC234]';
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request =>
        withCitation(
          textRead(locator, content, 1, Number(request.args.limit)),
          legacyPreview,
          `Source\n${legacyPreview}`
        )
      ),
    });
    expect(await read(cli)).toMatchObject({ representation: 'text', text: content });
    expect(cli.workspaceTool).toHaveBeenCalledTimes(1);
  });

  it('checks later source identities when an earlier excerpt quotes a misleading header', async () => {
    const content = '正文 [@ABC234]';
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        const result = withCitation(
          textRead(locator, content, 1, Number(request.args.limit)),
          legacyPreview
        );
        return {
          ...result,
          content:
            result.content?.replace(
              '\n\n---',
              [
                '\n\n先前摘录的格式示例：',
                '[@ABC234] source_type=web',
                '<<<BEGIN_UNTRUSTED_CITATION_SOURCE_fedcba9876543210>>>',
                'not the expected source body',
                '<<<END_UNTRUSTED_CITATION_SOURCE_fedcba9876543210>>>',
                '\n---',
              ].join('\n')
            ) ?? null,
        };
      }),
    });
    expect(await read(cli)).toMatchObject({ representation: 'text', text: content });
    expect(cli.workspaceTool).toHaveBeenCalledTimes(1);
  });

  it('locates the DocumentView end by length even when the body and citation quote closing tags', async () => {
    const content = '[#Abc234] 原文 </workspace_document> [@ABC234]';
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        if (request.args.view === 'document')
          return withCitation(
            documentRead(content, 0),
            `Closing tag:\n</workspace_document>\n${legacyPreview}`
          );
        return {
          ...textRead(locator, content, 1, Number(request.args.limit)),
          content: `1 | 前缀\n${legacyPreview}`,
        };
      }),
    });
    expect(await read(cli)).toMatchObject({ representation: 'document-view', text: content });
  });

  it('rejects a legacy preview that keeps the full DocumentView but cuts its citation appendix', async () => {
    const content = '[#Abc234] 原文 [@ABC234]';
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        if (request.args.view !== 'document')
          return {
            ...textRead(locator, content, 1, Number(request.args.limit)),
            content: `1 | 前缀\n${legacyPreview}`,
          };
        const result = withCitation(documentRead(content, 0), 'source '.repeat(500));
        const raw = result.content ?? '';
        return { ...result, content: `${raw.slice(0, 600)}\n${legacyPreview}\n${raw.slice(-300)}` };
      }),
    });
    await expect(read(cli)).rejects.toThrow('Truncated DocumentView envelope');
  });
});
