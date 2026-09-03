import { z } from 'zod';

export const WorkspaceNodeTransferRequestSchema = z.object({
  nodeId: z.string().trim().min(1),
  targetProjectId: z.string().trim().min(1),
});

export const WorkspaceNodeTransferResultSchema = z.object({
  nodeId: z.string().trim().min(1),
  nodeType: z.string().trim().min(1),
  nodeName: z.string().trim().min(1),
  sourceProjectId: z.string().trim().min(1),
  sourceParentId: z.string().trim().min(1).nullable(),
  targetProjectId: z.string().trim().min(1),
  targetParentId: z.null(),
  movedNodeIds: z.array(z.string().trim().min(1)).min(1),
});

export type WorkspaceNodeTransferRequest = z.infer<typeof WorkspaceNodeTransferRequestSchema>;
export type WorkspaceNodeTransferResult = z.infer<typeof WorkspaceNodeTransferResultSchema>;
