import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

/**
 * 子运行改动的来源文字：子 Agent 没有面向用户的名字，说成发起它的 Agent 的子任务（“Linnya Agent 的子任务”）。
 * 发起者显示名由调用方用 Agent 显示名规则查好；历史记录查不回发起者时传 null，只说“子任务”。
 * 项目概览的来源列与标签管理的改动记录共用这一条。
 */
export function formatSubrunActorLabel(rootAgentName: string | null, message: WorkspaceMessageResolver): string {
  return rootAgentName === null
    ? message('workspace.projectOverview.actor.subrun')
    : message('workspace.projectOverview.actor.subrunOf', { agent: rootAgentName });
}
