import { z } from 'zod';
import {
  WorkspaceDocumentCitationDiagnosticSchema,
  WorkspaceDocumentKnowledgeCitationSourceSchema,
  WorkspaceDocumentReadDataSchema,
  WorkspaceDocumentWebCitationSourceSchema,
} from './workspace-document-read';
import {
  ConversationFileLocatorSchema,
  FileLocatorSchema,
  HostFileLocatorSchema,
  WorkspaceFileLocatorSchema,
  parseFileLocator,
} from '../file-locator';

const NonEmptyStringSchema = z.string().trim().min(1);
const NonEmptyPreservedStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const NonNegativeNumberSchema = z.number().finite().nonnegative();

interface WorkspaceFileIdentityInput {
  readonly locator?: unknown;
  readonly inode?: unknown;
}

function requireExactlyOneWorkspaceFileIdentity(
  args: WorkspaceFileIdentityInput,
  context: z.RefinementCtx
): void {
  const identityCount = Number(args.locator !== undefined) + Number(args.inode !== undefined);
  if (identityCount !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['locator'],
      message: 'exactly one of locator or inode is required',
    });
  }
}

function requireAtMostOneWorkspaceFileIdentity(
  args: WorkspaceFileIdentityInput,
  context: z.RefinementCtx
): void {
  if (args.locator !== undefined && args.inode !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['locator'],
      message: 'locator and inode are mutually exclusive',
    });
  }
}

export const WorkspaceReadFileCitationSchema = z.discriminatedUnion('sourceType', [
  WorkspaceDocumentKnowledgeCitationSourceSchema.extend({
    index: PositiveIntegerSchema,
  }).strict(),
  WorkspaceDocumentWebCitationSourceSchema.extend({
    index: PositiveIntegerSchema,
  }).strict(),
]);

export const WorkspaceReadFileCitationMetadataSchema = z
  .object({
    citations: z.array(WorkspaceReadFileCitationSchema),
  })
  .strict();

interface WorkspaceReadFileCitationBearingData {
  readonly citations?: z.infer<typeof WorkspaceReadFileCitationMetadataSchema>;
  readonly citation_diagnostics?: readonly z.infer<
    typeof WorkspaceDocumentCitationDiagnosticSchema
  >[];
}

function requireValidReadFileCitations(
  data: WorkspaceReadFileCitationBearingData,
  context: z.RefinementCtx
): void {
  if ((data.citations === undefined) !== (data.citation_diagnostics === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations'],
      message: 'citations and citation_diagnostics must appear together',
    });
  }
  if (!data.citations) return;

  const refs = new Set<string>();
  const evidenceKeys = new Set<string>();
  data.citations.citations.forEach((citation, index) => {
    if (refs.has(citation.ref)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citations', 'citations', index, 'ref'],
        message: 'read_file citation refs must be unique',
      });
    }
    refs.add(citation.ref);

    const evidenceKey =
      citation.sourceType === 'knowledge_base'
        ? `knowledge_base:${citation.docId}:${citation.blockId}`
        : `web:${citation.url}`;
    if (evidenceKeys.has(evidenceKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citations', 'citations', index],
        message: 'read_file citation evidence identities must be unique',
      });
    }
    evidenceKeys.add(evidenceKey);

    const previous = data.citations?.citations[index - 1];
    if (previous && citation.index !== previous.index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citations', 'citations', index, 'index'],
        message: 'read_file citation indexes must be contiguous',
      });
    }
  });

  data.citation_diagnostics?.forEach((diagnostic, index) => {
    if (diagnostic.ref && !refs.has(diagnostic.ref)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citation_diagnostics', index, 'ref'],
        message: 'citation diagnostic ref must belong to the same read_file result',
      });
    }
  });
}

const WorkspaceReadFileCitationFieldsSchema = {
  citations: WorkspaceReadFileCitationMetadataSchema.optional(),
  citation_diagnostics: z.array(WorkspaceDocumentCitationDiagnosticSchema).optional(),
};

export const WORKSPACE_READ_FILE_DEFAULT_LIMIT = 20_000;
export const WORKSPACE_READ_FILE_MAX_LIMIT = 120_000;

export const WorkspaceCoreFileNodeTypeSchema = z.enum([
  'folder',
  'document',
  'asset_image',
  'asset_file',
  'system_file',
]);

/**
 * 节点类型是插件扩展点：schema 约束稳定标识符语法，具体 owner 与启用状态由文档类型 registry 判定。
 */
export const WorkspaceFileNodeTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/, 'Workspace node type must be a stable lowercase identifier');

export const WorkspaceFileNodeSourceSchema = z.enum([
  'workspace_node',
  'resource_library',
  'generated_image',
  'asset',
  'system_view',
]);

export const WorkspaceFileEntrySchema = z
  .object({
    name: NonEmptyStringSchema,
    locator: WorkspaceFileLocatorSchema,
    inode: NonEmptyStringSchema,
    type: WorkspaceFileNodeTypeSchema,
    source: WorkspaceFileNodeSourceSchema,
    is_virtual: z.boolean(),
    parent_id: NonEmptyStringSchema.nullable(),
    updated_at: NonNegativeNumberSchema,
    // 历史 list_files 资源库事件的 replay admission 字段；live VFS formatter 不再生产 Asset URI。
    resource_uri: NonEmptyStringSchema.refine(
      value => value.startsWith('asset://assets/'),
      'Workspace asset resource URI must use asset://assets/<asset_id>'
    ).optional(),
  })
  .strict();

export const WorkspaceFileDocumentAliasSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    type: WorkspaceFileNodeTypeSchema,
    parentId: NonEmptyStringSchema.nullable(),
    locator: WorkspaceFileLocatorSchema,
    inode: NonEmptyStringSchema,
  })
  .strict();

const WorkspaceRootFileLocator = WorkspaceFileLocatorSchema.parse('workspace:/');

export const WorkspaceListFilesArgsSchema = z
  .object({
    locator: WorkspaceFileLocatorSchema.optional(),
    inode: NonEmptyStringSchema.optional(),
    limit: PositiveIntegerSchema.max(200).default(80),
    offset: NonNegativeIntegerSchema.default(0),
    include_system_nodes: z.boolean().default(false),
  })
  .strict()
  .superRefine(requireAtMostOneWorkspaceFileIdentity)
  .transform(args =>
    args.locator || args.inode ? args : { ...args, locator: WorkspaceRootFileLocator }
  );

export const WorkspaceListFilesResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('workspace_vfs'),
        locator: WorkspaceFileLocatorSchema,
        inode: NonEmptyStringSchema.optional(),
        parent_inode: NonEmptyStringSchema.optional(),
        entries: z.array(WorkspaceFileEntrySchema),
        documents: z.array(WorkspaceFileDocumentAliasSchema),
        total_count: NonNegativeIntegerSchema,
        offset: NonNegativeIntegerSchema,
        has_more: z.boolean(),
        include_system_nodes: z.boolean(),
      })
      .strict()
      .superRefine((data, context) => {
        if (data.entries.length !== data.documents.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['documents'],
            message: 'documents must describe every listed entry',
          });
        }
        const expectedHasMore = data.offset + data.entries.length < data.total_count;
        if (data.has_more !== expectedHasMore) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['has_more'],
            message: 'has_more must agree with offset, entries, and total_count',
          });
        }
      }),
    observation: NonEmptyStringSchema,
  })
  .strict();

const WorkspaceReadFileArgsInputSchema = z
  .object({
    locator: FileLocatorSchema.optional(),
    inode: NonEmptyStringSchema.optional(),
    offset: NonNegativeIntegerSchema.optional(),
    limit: PositiveIntegerSchema.max(WORKSPACE_READ_FILE_MAX_LIMIT).optional(),
    view: z.enum(['text', 'document']).default('text'),
  })
  .strict()
  .superRefine((args, context) => {
    requireExactlyOneWorkspaceFileIdentity(args, context);
    if (
      args.view === 'document' &&
      args.locator &&
      parseFileLocator(args.locator).kind !== 'workspace'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['view'],
        message: 'document view requires a workspace locator or inode',
      });
    }
  });

/**
 * 工具生命周期阶段的参数快照。
 *
 * 模型参数在 decision/process loading 阶段可能尚未通过 owner schema（例如
 * provider 同时给出 locator 与空 inode）。这个合同只允许展示层读取可选的
 * locator/inode，不把生命周期快照误当成正式执行参数；success 仍必须使用
 * WorkspaceReadFileArgsSchema。
 */
export const WorkspaceReadFileLifecycleArgsSchema = z
  .object({
    locator: z.string().optional(),
    inode: z.string().optional(),
  })
  .catchall(z.unknown());

/** 文件写入/编辑生命周期只展示目标；模型参数增量允许空 locator/inode。 */
export const WorkspaceFileLifecycleArgsSchema = z
  .object({
    locator: z.string().optional(),
    inode: z.string().optional(),
  })
  .catchall(z.unknown());

/** grep 生命周期只展示当前 pattern；其余参数可能仍处于增量状态。 */
export const WorkspaceGrepLifecycleArgsSchema = z
  .object({
    pattern: z.string().optional(),
    locator: z.string().optional(),
    inode: z.string().optional(),
  })
  .catchall(z.unknown());

/**
 * view 只选择文本投影或结构化 DocumentView；文件的实际媒体类型由 reader 从内容识别。
 */
export const WorkspaceReadFileArgsSchema = WorkspaceReadFileArgsInputSchema.transform(args => ({
  view: args.view,
  locator: args.locator,
  inode: args.inode,
  offset: args.offset ?? 0,
  limit: args.limit ?? WORKSPACE_READ_FILE_DEFAULT_LIMIT,
}));

export const WorkspaceReadFileContentTypeSchema = NonEmptyStringSchema;

const WorkspaceReadFileVfsResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('workspace_vfs'),
        locator: WorkspaceFileLocatorSchema,
        inode: NonEmptyStringSchema,
        content_type: WorkspaceReadFileContentTypeSchema,
        node: WorkspaceFileEntrySchema,
        offset: NonNegativeIntegerSchema,
        limit: PositiveIntegerSchema.max(WORKSPACE_READ_FILE_MAX_LIMIT),
        truncated: z.boolean(),
        has_more: z.boolean(),
        next_offset: NonNegativeIntegerSchema.optional(),
        ...WorkspaceReadFileCitationFieldsSchema,
      })
      .strict()
      .superRefine((data, context) => {
        if (data.locator !== data.node.locator) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locator'],
            message: 'locator must match node.locator',
          });
        }
        if (data.inode !== data.node.inode) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['inode'],
            message: 'inode must match node.inode',
          });
        }
        if (data.has_more !== (data.next_offset !== undefined)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['next_offset'],
            message: 'next_offset must exist exactly when has_more is true',
          });
        }
        if (data.next_offset !== undefined && data.next_offset <= data.offset) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['next_offset'],
            message: 'next_offset must advance beyond offset',
          });
        }
        requireValidReadFileCitations(data, context);
      }),
    observation: NonEmptyPreservedStringSchema,
  })
  .strict();

const WorkspaceReadFileModelInputSchema = z
  .object({
    attachments: z
      .array(
        z
          .object({
            id: NonEmptyStringSchema,
            uri: NonEmptyStringSchema,
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const PhysicalImageAttachmentStatusSchema = z
  .enum(['attached', 'already_attached'])
  // 旧事件没有该字段；回放时按当时唯一存在的 attached 语义解释。
  .default('attached');

function requireValidPhysicalImageAttachment(
  result: {
    readonly data: { readonly attachment_status: 'attached' | 'already_attached' };
    readonly modelInput?: unknown;
  },
  context: z.RefinementCtx,
): void {
  const hasModelInput = result.modelInput !== undefined;
  if ((result.data.attachment_status === 'attached') !== hasModelInput) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['modelInput'],
      message: 'attached image requires modelInput; already_attached image must omit it',
    });
  }
}

const PhysicalTextResultFields = {
  file_name: NonEmptyStringSchema,
  content_type: z.enum(['text/plain', 'text/markdown', 'application/json', 'image/svg+xml']),
  byte_length: NonNegativeIntegerSchema,
  offset: NonNegativeIntegerSchema,
  limit: PositiveIntegerSchema.max(WORKSPACE_READ_FILE_MAX_LIMIT),
  truncated: z.boolean(),
  has_more: z.boolean(),
  next_offset: NonNegativeIntegerSchema.optional(),
};

function requireValidPhysicalTextWindow(
  data: { readonly has_more: boolean; readonly next_offset?: number; readonly offset: number },
  context: z.RefinementCtx
): void {
  if (data.has_more !== (data.next_offset !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_offset'],
      message: 'next_offset must exist exactly when has_more is true',
    });
  }
  if (data.next_offset !== undefined && data.next_offset <= data.offset) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_offset'],
      message: 'next_offset must advance beyond offset',
    });
  }
}

const WorkspaceReadFileConversationTextResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('conversation_file'),
        locator: ConversationFileLocatorSchema,
        ...PhysicalTextResultFields,
      })
      .strict()
      .superRefine(requireValidPhysicalTextWindow),
    observation: NonEmptyPreservedStringSchema,
  })
  .strict();

const WorkspaceReadFileConversationImageDataSchema = z
  .object({
    source_kind: z.literal('conversation_file'),
    locator: ConversationFileLocatorSchema,
    file_name: NonEmptyStringSchema,
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    byte_length: PositiveIntegerSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
    attachment_status: PhysicalImageAttachmentStatusSchema,
  })
  .strict();

const WorkspaceReadFileConversationImageResultSchema = z
  .object({
    data: WorkspaceReadFileConversationImageDataSchema,
    observation: NonEmptyPreservedStringSchema,
    modelInput: WorkspaceReadFileModelInputSchema.optional(),
  })
  .strict()
  .superRefine(requireValidPhysicalImageAttachment);

const WorkspaceReadFileHostTextResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('host_file'),
        locator: HostFileLocatorSchema,
        ...PhysicalTextResultFields,
      })
      .strict()
      .superRefine(requireValidPhysicalTextWindow),
    observation: NonEmptyPreservedStringSchema,
  })
  .strict();

const WorkspaceReadFileHostImageDataSchema = z
  .object({
    source_kind: z.literal('host_file'),
    locator: HostFileLocatorSchema,
    file_name: NonEmptyStringSchema,
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    byte_length: PositiveIntegerSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
    attachment_status: PhysicalImageAttachmentStatusSchema,
  })
  .strict();

const WorkspaceReadFileHostImageResultSchema = z
  .object({
    data: WorkspaceReadFileHostImageDataSchema,
    observation: NonEmptyPreservedStringSchema,
    modelInput: WorkspaceReadFileModelInputSchema.optional(),
  })
  .strict()
  .superRefine(requireValidPhysicalImageAttachment);

const WorkspaceReadFileDocumentResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('workspace_document'),
        locator: WorkspaceFileLocatorSchema,
        inode: NonEmptyStringSchema,
        content_type: z.literal('application/vnd.linnya.document-view'),
        document: WorkspaceDocumentReadDataSchema,
        ...WorkspaceReadFileCitationFieldsSchema,
      })
      .strict()
      .superRefine(requireValidReadFileCitations),
    observation: NonEmptyPreservedStringSchema,
    observationPreviewMeta: z
      .object({
        document_name: NonEmptyStringSchema,
        doc_type: NonEmptyStringSchema,
      })
      .strict(),
  })
  .strict();

/**
 * RuntimeEvent 只持久化工具的 data/observation，不持久化 UI preview metadata。
 * 需要从 working history 接纳 read_file 引用的后端流程必须使用这个 owner data 合同，
 * 不能扫描任意 `data.citations`，也不能伪造 preview metadata 来拼完整结果。
 */
export const WorkspaceReadFileEventDataSchema = z.union([
  WorkspaceReadFileVfsResultSchema.shape.data,
  WorkspaceReadFileConversationTextResultSchema.shape.data,
  WorkspaceReadFileConversationImageDataSchema,
  WorkspaceReadFileHostTextResultSchema.shape.data,
  WorkspaceReadFileHostImageDataSchema,
  WorkspaceReadFileDocumentResultSchema.shape.data,
]);

/**
 * RuntimeEvent 的 read_file 持久化结果只包含 owner data 与 observation。
 * Renderer preview metadata 和模型附件 selection 都有各自的事件 owner，不能在 replay
 * admission 中伪造成 live Tool 返回值。
 */
export const WorkspaceReadFileEventResultSchema = z.union([
  z
    .object({
      data: WorkspaceReadFileVfsResultSchema.shape.data,
      observation: NonEmptyPreservedStringSchema,
    })
    .strict(),
  z
    .object({
      data: WorkspaceReadFileConversationTextResultSchema.shape.data,
      observation: NonEmptyPreservedStringSchema,
    })
    .strict(),
  z
    .object({
      data: WorkspaceReadFileConversationImageDataSchema,
      observation: NonEmptyPreservedStringSchema,
    })
    .strict(),
  z
    .object({
      data: WorkspaceReadFileHostTextResultSchema.shape.data,
      observation: NonEmptyPreservedStringSchema,
    })
    .strict(),
  z
    .object({
      data: WorkspaceReadFileHostImageDataSchema,
      observation: NonEmptyPreservedStringSchema,
    })
    .strict(),
  z
    .object({
      data: WorkspaceReadFileDocumentResultSchema.shape.data,
      observation: NonEmptyPreservedStringSchema,
    })
    .strict(),
]);

export const WorkspaceReadFileResultSchema = z.union([
  WorkspaceReadFileVfsResultSchema,
  WorkspaceReadFileConversationTextResultSchema,
  WorkspaceReadFileConversationImageResultSchema,
  WorkspaceReadFileHostTextResultSchema,
  WorkspaceReadFileHostImageResultSchema,
  WorkspaceReadFileDocumentResultSchema,
]);

export const WorkspaceWriteFileArgsSchema = z
  .object({
    locator: WorkspaceFileLocatorSchema.optional(),
    inode: NonEmptyStringSchema.optional(),
    content: z.string(),
  })
  .strict()
  .superRefine((args, context) => {
    requireExactlyOneWorkspaceFileIdentity(args, context);
  });

export const WorkspaceDocumentDiagnosticSchema = z
  .object({
    severity: z.enum(['error', 'warning', 'info']),
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    target: NonEmptyStringSchema.optional(),
  })
  .strict();

export const WorkspaceWriteFileResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('workspace_vfs'),
        locator: WorkspaceFileLocatorSchema,
        inode: NonEmptyStringSchema,
        operation: z.enum(['create', 'update']),
        documentId: NonEmptyStringSchema,
        node: WorkspaceFileEntrySchema,
        diagnostics: z.array(WorkspaceDocumentDiagnosticSchema).max(20).readonly().optional(),
        diagnosticsTruncatedCount: PositiveIntegerSchema.optional(),
      })
      .strict()
      .superRefine((data, context) => {
        if (data.locator !== data.node.locator) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locator'],
            message: 'locator must match node.locator',
          });
        }
        if (data.inode !== data.node.inode) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['inode'],
            message: 'inode must match node.inode',
          });
        }
        if (data.inode !== `workspace:${data.documentId}`) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['documentId'],
            message: 'documentId must match the workspace inode',
          });
        }
        if (data.diagnosticsTruncatedCount !== undefined && !data.diagnostics?.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['diagnosticsTruncatedCount'],
            message: 'truncated diagnostics require visible diagnostics',
          });
        }
      }),
    observation: NonEmptyStringSchema,
  })
  .strict();

export const WorkspaceEditFileArgsSchema = z
  .object({
    locator: WorkspaceFileLocatorSchema.optional(),
    inode: NonEmptyStringSchema.optional(),
    old_string: z.string().min(1),
    new_string: z.string(),
    replace_all: z.boolean().default(false),
  })
  .strict()
  .superRefine((args, context) => {
    requireExactlyOneWorkspaceFileIdentity(args, context);
    if (args.old_string === args.new_string) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['new_string'],
        message: 'new_string must differ from old_string',
      });
    }
  });

export const WorkspaceEditFileResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('workspace_vfs'),
        locator: WorkspaceFileLocatorSchema,
        inode: NonEmptyStringSchema,
        documentId: NonEmptyStringSchema,
        node: WorkspaceFileEntrySchema,
        replaced: PositiveIntegerSchema,
        changes: z
          .array(
            z
              .object({
                oldStartLine: PositiveIntegerSchema,
                oldEndLine: PositiveIntegerSchema,
                newStartLine: PositiveIntegerSchema,
                newEndLine: PositiveIntegerSchema,
              })
              .strict()
          )
          .max(50)
          .readonly()
          .optional(),
        changesTruncatedCount: PositiveIntegerSchema.optional(),
        diff: z.string().max(12_500).optional(),
        diffTruncated: z.boolean().optional(),
        diagnostics: z.array(WorkspaceDocumentDiagnosticSchema).max(20).readonly().optional(),
        diagnosticsTruncatedCount: PositiveIntegerSchema.optional(),
      })
      .strict()
      .superRefine((data, context) => {
        if (data.locator !== data.node.locator) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locator'],
            message: 'locator must match node.locator',
          });
        }
        if (data.inode !== data.node.inode) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['inode'],
            message: 'inode must match node.inode',
          });
        }
        if (data.inode !== `workspace:${data.documentId}`) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['documentId'],
            message: 'documentId must match the workspace inode',
          });
        }
        if (data.diagnosticsTruncatedCount !== undefined && !data.diagnostics?.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['diagnosticsTruncatedCount'],
            message: 'truncated diagnostics require visible diagnostics',
          });
        }
        if (data.changesTruncatedCount !== undefined && !data.changes?.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['changesTruncatedCount'],
            message: 'truncated changes require visible change ranges',
          });
        }
      }),
    observation: NonEmptyStringSchema,
  })
  .strict();

export const WorkspaceGrepArgsSchema = z
  .object({
    pattern: NonEmptyStringSchema,
    locator: WorkspaceFileLocatorSchema.optional(),
    inode: NonEmptyStringSchema.optional(),
    case_sensitive: z.boolean().default(false),
    max_results: PositiveIntegerSchema.max(500).default(50),
    max_indexed_nodes: PositiveIntegerSchema.max(20_000).default(5_000),
  })
  .strict()
  .superRefine(requireAtMostOneWorkspaceFileIdentity)
  .transform(args =>
    args.locator || args.inode ? args : { ...args, locator: WorkspaceRootFileLocator }
  );

export const WorkspaceGrepMatchSchema = z
  .object({
    locator: WorkspaceFileLocatorSchema,
    inode: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    type: WorkspaceFileNodeTypeSchema,
    source: WorkspaceFileNodeSourceSchema,
    line: PositiveIntegerSchema,
    column: PositiveIntegerSchema,
    preview: z.string(),
  })
  .strict();

export const WorkspaceGrepIndexSchema = z
  .object({
    available: z.boolean(),
    indexed_nodes: NonNegativeIntegerSchema.optional(),
    skipped_fresh_nodes: NonNegativeIntegerSchema.optional(),
    visited_nodes: NonNegativeIntegerSchema.optional(),
    truncated_indexing: z.boolean().optional(),
    truncated_files: NonNegativeIntegerSchema.optional(),
  })
  .strict();

export const WorkspaceGrepResultSchema = z
  .object({
    data: z
      .object({
        source_kind: z.literal('workspace_vfs'),
        pattern: NonEmptyStringSchema,
        searched_locator: WorkspaceFileLocatorSchema.optional(),
        searched_inode: NonEmptyStringSchema.optional(),
        matches: z.array(WorkspaceGrepMatchSchema),
        total_count: NonNegativeIntegerSchema,
        truncated: z.boolean(),
        index: WorkspaceGrepIndexSchema.optional(),
      })
      .strict()
      .superRefine((data, context) => {
        if ((data.searched_locator === undefined) === (data.searched_inode === undefined)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['searched_locator'],
            message: 'exactly one of searched_locator or searched_inode is required',
          });
        }
        if (data.total_count !== data.matches.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['total_count'],
            message: 'total_count must equal matches.length',
          });
        }
      }),
    observation: NonEmptyStringSchema,
  })
  .strict();

export type WorkspaceFileEntry = z.infer<typeof WorkspaceFileEntrySchema>;
export type WorkspaceFileDocumentAlias = z.infer<typeof WorkspaceFileDocumentAliasSchema>;
export type WorkspaceListFilesArgs = z.infer<typeof WorkspaceListFilesArgsSchema>;
export type WorkspaceListFilesResult = z.infer<typeof WorkspaceListFilesResultSchema>;
export type WorkspaceReadFileArgs = z.infer<typeof WorkspaceReadFileArgsSchema>;
export type WorkspaceReadFileContentType = z.infer<typeof WorkspaceReadFileContentTypeSchema>;
export type WorkspaceReadFileCitation = z.infer<typeof WorkspaceReadFileCitationSchema>;
export type WorkspaceReadFileCitationMetadata = z.infer<
  typeof WorkspaceReadFileCitationMetadataSchema
>;
export type WorkspaceReadFileResult = z.infer<typeof WorkspaceReadFileResultSchema>;
export type WorkspaceReadFileEventResult = z.infer<typeof WorkspaceReadFileEventResultSchema>;
export type WorkspaceWriteFileArgs = z.infer<typeof WorkspaceWriteFileArgsSchema>;
export type WorkspaceDocumentDiagnostic = z.infer<typeof WorkspaceDocumentDiagnosticSchema>;
export type WorkspaceWriteFileResult = z.infer<typeof WorkspaceWriteFileResultSchema>;
export type WorkspaceEditFileArgs = z.infer<typeof WorkspaceEditFileArgsSchema>;
export type WorkspaceEditFileResult = z.infer<typeof WorkspaceEditFileResultSchema>;
export type WorkspaceGrepArgs = z.infer<typeof WorkspaceGrepArgsSchema>;
export type WorkspaceGrepMatch = z.infer<typeof WorkspaceGrepMatchSchema>;
export type WorkspaceGrepResult = z.infer<typeof WorkspaceGrepResultSchema>;
