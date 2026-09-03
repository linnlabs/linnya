import { z } from 'zod';

import {
  WorkspaceFileNodeSourceSchema,
  WorkspaceFileNodeTypeSchema,
  WorkspaceReadFileCitationMetadataSchema,
  WORKSPACE_READ_FILE_MAX_LIMIT,
} from './workspace-file';
import {
  WorkspaceDocumentCitationDiagnosticSchema,
  WorkspaceDocumentReadDataSchema,
} from './workspace-document-read';

const NonEmptyStringSchema = z.string().trim().min(1);
const NonEmptyPreservedStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const NonNegativeNumberSchema = z.number().finite().nonnegative();

/**
 * locator 上线前已经持久化的 Workspace 文件工具事件合同。
 *
 * 这里只服务 Renderer/history replay admission；live 工具参数和结果禁止引用本文件，
 * 避免旧 path 重新进入模型可调用合同。
 */

export const HistoricalWorkspaceFileEntrySchema = z.object({
  name: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  inode: NonEmptyStringSchema,
  type: WorkspaceFileNodeTypeSchema,
  source: WorkspaceFileNodeSourceSchema,
  is_virtual: z.boolean(),
  parent_id: NonEmptyStringSchema.nullable(),
  updated_at: NonNegativeNumberSchema,
  resource_uri: NonEmptyStringSchema.refine(
    value => value.startsWith('asset://assets/'),
    'Historical Workspace asset resource URI must use asset://assets/<asset_id>',
  ).optional(),
}).strict();

const HistoricalWorkspaceFileDocumentAliasSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  type: WorkspaceFileNodeTypeSchema,
  parentId: NonEmptyStringSchema.nullable(),
  path: NonEmptyStringSchema,
  inode: NonEmptyStringSchema,
}).strict();

export const HistoricalWorkspaceListFilesArgsSchema = z.object({
  path: NonEmptyStringSchema.default('/'),
  inode: NonEmptyStringSchema.optional(),
  limit: PositiveIntegerSchema.max(200).default(80),
  offset: NonNegativeIntegerSchema.default(0),
  include_system_nodes: z.boolean().default(false),
}).strict();

export const HistoricalWorkspaceListFilesResultSchema = z.object({
  data: z.object({
    path: NonEmptyStringSchema,
    inode: NonEmptyStringSchema.optional(),
    parent_inode: NonEmptyStringSchema.optional(),
    entries: z.array(HistoricalWorkspaceFileEntrySchema),
    documents: z.array(HistoricalWorkspaceFileDocumentAliasSchema),
    total_count: NonNegativeIntegerSchema,
    offset: NonNegativeIntegerSchema,
    has_more: z.boolean(),
    include_system_nodes: z.boolean(),
  }).strict().superRefine((data, context) => {
    if (data.entries.length !== data.documents.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documents'],
        message: 'historical documents must describe every listed entry',
      });
    }
    const expectedHasMore = data.offset + data.entries.length < data.total_count;
    if (data.has_more !== expectedHasMore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['has_more'],
        message: 'historical has_more must agree with offset, entries, and total_count',
      });
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();

const HistoricalWorkspaceReadFileArgsInputSchema = z.object({
  path: NonEmptyStringSchema.optional(),
  inode: NonEmptyStringSchema.optional(),
  offset: NonNegativeIntegerSchema.optional(),
  limit: PositiveIntegerSchema.max(WORKSPACE_READ_FILE_MAX_LIMIT).optional(),
  view: z.enum(['text', 'document']).default('text'),
}).strict().superRefine((args, context) => {
  if (!args.path && !args.inode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: 'historical path or inode is required',
    });
  }
});

export const HistoricalWorkspaceReadFileArgsSchema = HistoricalWorkspaceReadFileArgsInputSchema
  .transform(args => ({
    view: args.view,
    path: args.path,
    inode: args.inode,
    offset: args.offset ?? 0,
    limit: args.limit ?? 20_000,
  }));

export const HistoricalWorkspaceReadFileLifecycleArgsSchema = z.object({
  path: z.string().optional(),
  inode: z.string().optional(),
}).catchall(z.unknown());

const HistoricalWorkspaceReadFileCitationFieldsSchema = {
  citations: WorkspaceReadFileCitationMetadataSchema.optional(),
  citation_diagnostics: z.array(WorkspaceDocumentCitationDiagnosticSchema).optional(),
};

interface HistoricalCitationBearingData {
  readonly citations?: z.infer<typeof WorkspaceReadFileCitationMetadataSchema>;
  readonly citation_diagnostics?: readonly z.infer<typeof WorkspaceDocumentCitationDiagnosticSchema>[];
}

function requirePairedHistoricalCitationFields(
  data: HistoricalCitationBearingData,
  context: z.RefinementCtx,
): void {
  if ((data.citations === undefined) !== (data.citation_diagnostics === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citations'],
      message: 'historical citations and citation_diagnostics must appear together',
    });
  }
}

function requireHistoricalWindow(data: {
  readonly offset: number;
  readonly has_more: boolean;
  readonly next_offset?: number;
}, context: z.RefinementCtx): void {
  if (data.has_more !== (data.next_offset !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_offset'],
      message: 'historical next_offset must exist exactly when has_more is true',
    });
  }
  if (data.next_offset !== undefined && data.next_offset <= data.offset) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_offset'],
      message: 'historical next_offset must advance beyond offset',
    });
  }
}

const HistoricalWorkspaceReadFileContentTypeSchema = NonEmptyStringSchema;

const HistoricalWorkspaceReadFileVfsResultSchema = z.object({
  data: z.object({
    path: NonEmptyStringSchema,
    inode: NonEmptyStringSchema,
    content_type: HistoricalWorkspaceReadFileContentTypeSchema,
    node: HistoricalWorkspaceFileEntrySchema,
    offset: NonNegativeIntegerSchema,
    limit: PositiveIntegerSchema.max(WORKSPACE_READ_FILE_MAX_LIMIT),
    truncated: z.boolean(),
    has_more: z.boolean(),
    next_offset: NonNegativeIntegerSchema.optional(),
    ...HistoricalWorkspaceReadFileCitationFieldsSchema,
  }).strict().superRefine((data, context) => {
    if (data.path !== data.node.path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'historical path must match node.path',
      });
    }
    if (data.inode !== data.node.inode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inode'],
        message: 'historical inode must match node.inode',
      });
    }
    requireHistoricalWindow(data, context);
    requirePairedHistoricalCitationFields(data, context);
  }),
  observation: NonEmptyPreservedStringSchema,
}).strict();

const HistoricalWorkspaceReadFileConversationTextResultSchema = z.object({
  data: z.object({
    source: z.literal('conversation_file'),
    path: NonEmptyStringSchema,
    relative_path: NonEmptyStringSchema,
    file_name: NonEmptyStringSchema,
    content_type: z.enum(['text/plain', 'text/markdown', 'application/json']),
    offset: NonNegativeIntegerSchema,
    limit: PositiveIntegerSchema.max(WORKSPACE_READ_FILE_MAX_LIMIT),
    truncated: z.boolean(),
    has_more: z.boolean(),
    next_offset: NonNegativeIntegerSchema.optional(),
  }).strict().superRefine((data, context) => {
    if (data.path !== data.relative_path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'historical conversation path must match relative_path',
      });
    }
    requireHistoricalWindow(data, context);
  }),
  observation: NonEmptyPreservedStringSchema,
}).strict();

/** 历史 event 已把 modelInput 消费为 attachments，因此 replay result 不再要求该运行期字段。 */
const HistoricalWorkspaceReadFileConversationImageEventResultSchema = z.object({
  data: z.object({
    source: z.literal('conversation_file'),
    path: NonEmptyStringSchema,
    relative_path: NonEmptyStringSchema,
    file_name: NonEmptyStringSchema,
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  }).strict().superRefine((data, context) => {
    if (data.path !== data.relative_path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'historical conversation path must match relative_path',
      });
    }
  }),
  observation: NonEmptyPreservedStringSchema,
}).strict();

const HistoricalWorkspaceReadFileDocumentResultSchema = z.object({
  data: z.object({
    source: z.literal('workspace_document'),
    path: NonEmptyStringSchema,
    inode: NonEmptyStringSchema,
    content_type: z.literal('application/vnd.linnya.document-view'),
    document: WorkspaceDocumentReadDataSchema,
    ...HistoricalWorkspaceReadFileCitationFieldsSchema,
  }).strict().superRefine(requirePairedHistoricalCitationFields),
  observation: NonEmptyPreservedStringSchema,
  observationPreviewMeta: z.object({
    document_name: NonEmptyStringSchema,
    doc_type: NonEmptyStringSchema,
  }).strict(),
}).strict();

export const HistoricalWorkspaceReadFileEventResultSchema = z.union([
  HistoricalWorkspaceReadFileVfsResultSchema,
  HistoricalWorkspaceReadFileConversationTextResultSchema,
  HistoricalWorkspaceReadFileConversationImageEventResultSchema,
  HistoricalWorkspaceReadFileDocumentResultSchema,
]);

/** 后端从旧 RuntimeEvent 读取 citation owner facts 时使用，不接纳完整工具运行结果。 */
export const HistoricalWorkspaceReadFileEventDataSchema = z.union([
  HistoricalWorkspaceReadFileVfsResultSchema.shape.data,
  HistoricalWorkspaceReadFileConversationTextResultSchema.shape.data,
  HistoricalWorkspaceReadFileConversationImageEventResultSchema.shape.data,
  HistoricalWorkspaceReadFileDocumentResultSchema.shape.data,
]);

export const HistoricalWorkspaceFileLifecycleArgsSchema = z.object({
  path: z.string().optional(),
  inode: z.string().optional(),
}).catchall(z.unknown());

export const HistoricalWorkspaceWriteFileArgsSchema = z.object({
  path: NonEmptyStringSchema.optional(),
  inode: NonEmptyStringSchema.optional(),
  content: z.string(),
}).strict().superRefine((args, context) => {
  if (!args.path && !args.inode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: 'historical path or inode is required',
    });
  }
});

const HistoricalWorkspaceDocumentDiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  target: NonEmptyStringSchema.optional(),
}).strict();

const HistoricalWorkspaceWriteFileResultSchema = z.object({
  data: z.object({
    path: NonEmptyStringSchema,
    inode: NonEmptyStringSchema,
    operation: z.enum(['create', 'update']),
    documentId: NonEmptyStringSchema,
    node: HistoricalWorkspaceFileEntrySchema,
    diagnostics: z.array(HistoricalWorkspaceDocumentDiagnosticSchema).max(20).readonly().optional(),
    diagnosticsTruncatedCount: PositiveIntegerSchema.optional(),
  }).strict().superRefine(requireHistoricalWorkspaceMutationIdentity),
  observation: NonEmptyStringSchema,
}).strict();

export { HistoricalWorkspaceWriteFileResultSchema };

export const HistoricalWorkspaceEditFileArgsSchema = z.object({
  path: NonEmptyStringSchema.optional(),
  inode: NonEmptyStringSchema.optional(),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().default(false),
}).strict().superRefine((args, context) => {
  if (!args.path && !args.inode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: 'historical path or inode is required',
    });
  }
  if (args.old_string === args.new_string) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['new_string'],
      message: 'historical new_string must differ from old_string',
    });
  }
});

export const HistoricalWorkspaceEditFileResultSchema = z.object({
  data: z.object({
    path: NonEmptyStringSchema,
    inode: NonEmptyStringSchema,
    documentId: NonEmptyStringSchema,
    node: HistoricalWorkspaceFileEntrySchema,
    replaced: PositiveIntegerSchema,
    diagnostics: z.array(HistoricalWorkspaceDocumentDiagnosticSchema).max(20).readonly().optional(),
    diagnosticsTruncatedCount: PositiveIntegerSchema.optional(),
  }).strict().superRefine(requireHistoricalWorkspaceMutationIdentity),
  observation: NonEmptyStringSchema,
}).strict();

function requireHistoricalWorkspaceMutationIdentity(data: {
  readonly path: string;
  readonly inode: string;
  readonly documentId: string;
  readonly node: z.infer<typeof HistoricalWorkspaceFileEntrySchema>;
  readonly diagnostics?: readonly z.infer<typeof HistoricalWorkspaceDocumentDiagnosticSchema>[];
  readonly diagnosticsTruncatedCount?: number;
}, context: z.RefinementCtx): void {
  if (data.path !== data.node.path) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: 'historical path must match node.path',
    });
  }
  if (data.inode !== data.node.inode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inode'],
      message: 'historical inode must match node.inode',
    });
  }
  if (data.inode !== `workspace:${data.documentId}`) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['documentId'],
      message: 'historical documentId must match the workspace inode',
    });
  }
  if (data.diagnosticsTruncatedCount !== undefined && !data.diagnostics?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['diagnosticsTruncatedCount'],
      message: 'historical truncated diagnostics require visible diagnostics',
    });
  }
}

export const HistoricalWorkspaceGrepLifecycleArgsSchema = z.object({
  pattern: z.string().optional(),
  path: z.string().optional(),
  inode: z.string().optional(),
}).catchall(z.unknown());

export const HistoricalWorkspaceGrepArgsSchema = z.object({
  pattern: NonEmptyStringSchema,
  path: NonEmptyStringSchema.default('/'),
  inode: NonEmptyStringSchema.optional(),
  case_sensitive: z.boolean().default(false),
  max_results: PositiveIntegerSchema.max(500).default(50),
  max_indexed_nodes: PositiveIntegerSchema.max(20_000).default(5_000),
}).strict();

const HistoricalWorkspaceGrepMatchSchema = z.object({
  path: NonEmptyStringSchema,
  inode: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  type: WorkspaceFileNodeTypeSchema,
  source: WorkspaceFileNodeSourceSchema,
  line: PositiveIntegerSchema,
  column: PositiveIntegerSchema,
  preview: z.string(),
}).strict();

const HistoricalWorkspaceGrepIndexSchema = z.object({
  available: z.boolean(),
  indexed_nodes: NonNegativeIntegerSchema.optional(),
  skipped_fresh_nodes: NonNegativeIntegerSchema.optional(),
  visited_nodes: NonNegativeIntegerSchema.optional(),
  truncated_indexing: z.boolean().optional(),
  truncated_files: NonNegativeIntegerSchema.optional(),
}).strict();

export const HistoricalWorkspaceGrepResultSchema = z.object({
  data: z.object({
    pattern: NonEmptyStringSchema,
    searched_path: NonEmptyStringSchema,
    matches: z.array(HistoricalWorkspaceGrepMatchSchema),
    total_count: NonNegativeIntegerSchema,
    truncated: z.boolean(),
    index: HistoricalWorkspaceGrepIndexSchema.optional(),
  }).strict().superRefine((data, context) => {
    if (data.total_count !== data.matches.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total_count'],
        message: 'historical total_count must equal matches.length',
      });
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();
