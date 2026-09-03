import { z } from 'zod';

export const WORKSPACE_MUTATION_CHANNEL = 'workspace:mutation';

export const WorkspaceMutationSourceSchema = z.enum([
  'tool',
  'user',
  'import',
  'subrun',
  'system',
]);

export const WorkspaceDocumentMutationKindSchema = z.enum([
  'version',
  'pending',
  'incremental',
]);

const WorkspaceMutationBaseSchema = z.object({
  mutationId: z.string().trim().min(1),
  source: WorkspaceMutationSourceSchema.optional(),
});

const WorkspaceNodeIdentitySchema = z.object({
  projectId: z.string().trim().min(1).nullable(),
  nodeId: z.string().trim().min(1),
});

export const WorkspaceNodeCreatedEventSchema = WorkspaceMutationBaseSchema
  .merge(WorkspaceNodeIdentitySchema)
  .extend({
    type: z.literal('workspace.node.created'),
    nodeType: z.string().trim().min(1),
    parentId: z.string().trim().min(1).nullable(),
    name: z.string().trim().min(1),
  });

export const WorkspaceNodeRenamedEventSchema = WorkspaceMutationBaseSchema
  .merge(WorkspaceNodeIdentitySchema)
  .extend({
    type: z.literal('workspace.node.renamed'),
    nodeType: z.string().trim().min(1),
    parentId: z.string().trim().min(1).nullable(),
    name: z.string().trim().min(1),
    oldName: z.string().trim().min(1),
  });

export const WorkspaceNodeMovedEventSchema = WorkspaceMutationBaseSchema
  .merge(WorkspaceNodeIdentitySchema)
  .extend({
    type: z.literal('workspace.node.moved'),
    nodeType: z.string().trim().min(1),
    parentId: z.string().trim().min(1).nullable(),
    oldParentId: z.string().trim().min(1).nullable(),
    name: z.string().trim().min(1),
  });

export const WorkspaceNodeTransferredEventSchema = WorkspaceMutationBaseSchema.extend({
  type: z.literal('workspace.node.transferred'),
  nodeId: z.string().trim().min(1),
  nodeType: z.string().trim().min(1),
  name: z.string().trim().min(1),
  sourceProjectId: z.string().trim().min(1),
  sourceParentId: z.string().trim().min(1).nullable(),
  targetProjectId: z.string().trim().min(1),
  targetParentId: z.null(),
  movedNodeIds: z.array(z.string().trim().min(1)).min(1),
});

export const WorkspaceNodeDeletedEventSchema = WorkspaceMutationBaseSchema
  .merge(WorkspaceNodeIdentitySchema)
  .extend({
    type: z.literal('workspace.node.deleted'),
    nodeType: z.string().trim().min(1),
    parentId: z.string().trim().min(1).nullable(),
    name: z.string().trim().min(1),
    deletedNodeIds: z.array(z.string().trim().min(1)).min(1),
  });

export const WorkspaceDocumentUpdatedEventSchema = WorkspaceMutationBaseSchema.extend({
  type: z.literal('workspace.document.updated'),
  projectId: z.string().trim().min(1).nullable(),
  documentId: z.string().trim().min(1),
  nodeType: z.string().trim().min(1),
  versionNumber: z.number().int().positive().optional(),
  mutationKind: WorkspaceDocumentMutationKindSchema,
});

export const WorkspaceMutationEventSchema = z.discriminatedUnion('type', [
  WorkspaceNodeCreatedEventSchema,
  WorkspaceNodeRenamedEventSchema,
  WorkspaceNodeMovedEventSchema,
  WorkspaceNodeTransferredEventSchema,
  WorkspaceNodeDeletedEventSchema,
  WorkspaceDocumentUpdatedEventSchema,
]);

export type WorkspaceMutationSource = z.infer<typeof WorkspaceMutationSourceSchema>;
export type WorkspaceDocumentMutationKind = z.infer<typeof WorkspaceDocumentMutationKindSchema>;
export type WorkspaceNodeCreatedEvent = z.infer<typeof WorkspaceNodeCreatedEventSchema>;
export type WorkspaceNodeRenamedEvent = z.infer<typeof WorkspaceNodeRenamedEventSchema>;
export type WorkspaceNodeMovedEvent = z.infer<typeof WorkspaceNodeMovedEventSchema>;
export type WorkspaceNodeTransferredEvent = z.infer<typeof WorkspaceNodeTransferredEventSchema>;
export type WorkspaceNodeDeletedEvent = z.infer<typeof WorkspaceNodeDeletedEventSchema>;
export type WorkspaceDocumentUpdatedEvent = z.infer<typeof WorkspaceDocumentUpdatedEventSchema>;
export type WorkspaceMutationEvent = z.infer<typeof WorkspaceMutationEventSchema>;

export function parseWorkspaceMutationEvent(value: unknown): WorkspaceMutationEvent {
  return WorkspaceMutationEventSchema.parse(value);
}
