import type { SubagentArgs, SubagentArtifactRef } from '@app/schemas';
import type { PromptKey } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type { RunRegisteredSubagentResult } from '../../shared';

export interface ResolvedSubagentType {
  readonly type: string;
  readonly promptKey: PromptKey;
  readonly inheritTurns: number;
}

export interface SubagentTaskRequest {
  readonly args: Readonly<SubagentArgs>;
  readonly resolvedType: ResolvedSubagentType;
  readonly modelId: string;
}

/** Host 只准备请求与业务交接，不能在本端口内另起 child runtime。 */
export interface PreparedSubagentTask<TContext> {
  readonly context: TContext;
  readonly userMessage: string;
  readonly subrunId?: string;
  /** 仅在 child 成功且未取消后调用；接纳失败必须抛出，不能伪报委派成功。 */
  acceptResult(
    result: Readonly<RunRegisteredSubagentResult>
  ): Promise<readonly SubagentArtifactRef[]>;
}

export type PrepareSubagentTask<TContext> = (
  request: SubagentTaskRequest
) => Promise<PreparedSubagentTask<TContext>>;
