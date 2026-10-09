import type { ToolContext } from 'src/tools/types';
import { createResearchToolExecution } from './createResearchToolExecution';

export function decorateResearchToolContext(context: ToolContext): void {
  context.researchExecution = createResearchToolExecution(context);
}
/** 固定材料研究在正式取得工具边界拒绝联网；Shell 不被伪装为同等隔离。 */
export function enforceResearchRetrievalScope(context: ToolContext): void {
  if (context.researchRetrievalAllowed === false) {
    throw new ResearchRetrievalScopeError();
  }
}
class ResearchRetrievalScopeError extends Error {
  readonly code = 'RESEARCH_RETRIEVAL_NOT_ALLOWED';
  constructor() {
    super(
      'This research stage uses fixed materials. Read the supplied Workspace documents; external retrieval is not allowed.'
    );
  }
}
