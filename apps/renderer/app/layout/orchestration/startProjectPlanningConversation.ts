import type { LayoutMessageKey } from '../definitions/layoutMessages';

/** 平台插件贡献的 Agent 选项 id；只由项目初始化入口选中，不进入输入框菜单。 */
export const PROJECT_PLANNING_AGENT_CHOICE_ID = 'project_planning';

export interface ProjectPlanningTarget {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface StartProjectPlanningConversationInput {
  readonly project: ProjectPlanningTarget;
  readonly navigation: {
    openWorkspace(scope: { kind: 'project'; projectId: string }): Promise<void>;
  };
  readonly startDraft: (scope: { kind: 'project'; projectId: string }) => void;
  readonly chooseAgent: (agentChoiceId: string) => Promise<unknown>;
  readonly send: (
    text: string,
    projectMetadata: { id: string; name: string; description: string },
  ) => Promise<boolean>;
  readonly resolveInitialMessage: (
    key: LayoutMessageKey,
    params: Record<string, string>,
  ) => string;
}

/**
 * 在统一项目对话里开启项目初始化。
 *
 * Agent 身份写在会话上，后续每一轮都走同一 Agent；用户移除后回到默认 Agent。
 * 首条消息用户可见，提问框架由 Agent 的系统提示词负责。
 */
export async function startProjectPlanningConversation(
  input: StartProjectPlanningConversationInput,
): Promise<boolean> {
  const { project } = input;
  const scope = { kind: 'project', projectId: project.id } as const;
  const description = project.description.trim();

  await input.navigation.openWorkspace(scope);
  input.startDraft(scope);
  await input.chooseAgent(PROJECT_PLANNING_AGENT_CHOICE_ID);

  const text = description
    ? input.resolveInitialMessage('layout.projectPlanning.initialMessageWithDescription', {
        projectName: project.name,
        projectDescription: description,
      })
    : input.resolveInitialMessage('layout.projectPlanning.initialMessage', {
        projectName: project.name,
      });

  return input.send(text, { id: project.id, name: project.name, description });
}
