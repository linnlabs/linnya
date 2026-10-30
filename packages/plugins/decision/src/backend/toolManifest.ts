import { DecisionFinishTool } from './features/decision-delivery/DecisionFinishTool';

const finish = new DecisionFinishTool().name;
export const decisionToolManifest = {
  classes: [DecisionFinishTool], allNames: [finish], names: { finish },
  agentTools: { decision: [finish] },
};
