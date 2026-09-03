import type Database from 'better-sqlite3';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';

import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { ToolContext } from 'src/tools/types';

export interface SubagentWorkspaceTestFixture {
  readonly db: Database.Database;
  readonly projectId: string;
  readonly context: ToolContext;
  createContext(params?: {
    readonly conversationId?: string;
    readonly turnId?: string;
    readonly patch?: Partial<ToolContext>;
  }): ToolContext;
  dispose(): void;
}

export function createSubagentWorkspaceTestFixture(
  patch: Partial<ToolContext> = {}
): SubagentWorkspaceTestFixture {
  const databaseService = new DatabaseService(':memory:');
  databaseService.initialize();
  const db = databaseService.getDb();
  const projectId = 'project-subagent-workspace';
  db.prepare(
    `
    INSERT INTO projects (id, name, description, icon, system_role, created_at, updated_at)
    VALUES (?, 'Subagent Workspace Test', NULL, NULL, NULL, 1, 1)
  `
  ).run(projectId);

  const workspaceService = new WorkspaceService(db);
  const basePatch: Partial<ToolContext> = {
    databaseService,
    workspaceService,
    workspaceProjectId: projectId,
    ...patch,
  };
  const createContext = (
    params: {
      readonly conversationId?: string;
      readonly turnId?: string;
      readonly patch?: Partial<ToolContext>;
    } = {}
  ): ToolContext =>
    createToolContextFixture({
      conversationId: params.conversationId ?? 'conv_subagent_workspace',
      turnId: params.turnId ?? 'turn_subagent_workspace',
      patch: {
        ...basePatch,
        ...(params.patch ?? {}),
      },
    });
  const context = createContext();

  return {
    db,
    projectId,
    context,
    createContext,
    dispose: () => databaseService.close(),
  };
}
