/**
 * @file workspaceVfsNode.ts
 * @description Workspace Path Layer 暴露给前端和工具层的统一节点契约。
 */
import { z } from 'zod';

/** Workspace node type 是平台类型与插件贡献类型共用的开放字符串合同。 */
export type WorkspaceVfsNodeType = string;

export type WorkspaceVfsNodeSource =
  | 'workspace_node'
  | 'resource_library'
  | 'generated_image'
  | 'asset'
  | 'system_view';

export interface WorkspaceVfsNodePayload {
  readonly filePath?: string;
  readonly assetId?: string;
  readonly imagePreviewAccess?: 'verified_asset' | 'media_path';
  readonly uri?: string;
  readonly mediaType?: string;
  readonly version?: number;
  readonly viewKind?: string;
  readonly workspaceNodeId?: string;
  readonly workspaceNodeType?: string;
}

export interface WorkspaceVfsNode {
  readonly id: string;
  readonly inode: string;
  readonly path: string;
  /** 节点的项目归属；不能用 Runtime workspaceRoot 或界面导航身份代替。 */
  readonly project_id: string | null;
  readonly parent_id: string | null;
  readonly type: WorkspaceVfsNodeType;
  readonly name: string;
  readonly display_name?: string;
  readonly icon: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly deleted_at: number | null;
  readonly last_opened_at: number | null;
  readonly access_count: number;
  readonly tags: string | null;
  readonly is_virtual: boolean;
  readonly source: WorkspaceVfsNodeSource;
  readonly payload?: WorkspaceVfsNodePayload;
}

export const WorkspaceNodeRowSchema = z.object({
  id: z.string(), project_id: z.string().nullable(), parent_id: z.string().nullable(),
  type: z.string(), name: z.string(), icon: z.string().nullable(),
  created_at: z.number(), updated_at: z.number(), deleted_at: z.number().nullable(),
  last_opened_at: z.number().nullable(), access_count: z.number(), tags: z.string().nullable(),
});
export type WorkspaceNodeRow = Readonly<z.infer<typeof WorkspaceNodeRowSchema>>;
