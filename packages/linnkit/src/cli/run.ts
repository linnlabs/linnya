import type { RuntimeEvent } from '../contracts';
import { resolveConfiguredInference, runAgent } from '../quickstart';
import { loadConfig } from './configLoader';
import { loadDotEnv } from './env';

export interface RunCommandOptions {
  cwd: string;
  configPath: string;
  agentId: string;
  input: string;
  modelId?: string;
  write?: (text: string) => void;
}

function readEventText(event: RuntimeEvent): string | undefined {
  if (event.type === 'final_answer_chunk') {
    return event.content;
  }
  if (event.type === 'tool_call_decision' && event.phase === 'start') {
    return `\n[tool] ${event.tool_name}\n`;
  }
  if (event.type === 'tool_output') {
    return `[tool-result] ${event.tool_name}\n`;
  }
  return undefined;
}

export async function runRunCommand(options: RunCommandOptions): Promise<number> {
  await loadDotEnv(options.cwd);
  const config = await loadConfig(options.configPath, options.cwd);
  const agent = config.agents.find((candidate) => candidate.spec.id === options.agentId);
  if (!agent) {
    throw new Error(`[linnkit] unknown agent id: ${options.agentId}`);
  }

  const inference = await resolveConfiguredInference(config);
  const modelId = options.modelId ?? agent.modelId ?? config.defaultModelId;
  const write = options.write ?? ((text: string) => process.stdout.write(text));

  write(`[linnkit] agent=${agent.spec.id} model=${modelId ?? '(missing)'}\n`);
  const result = await runAgent(agent, {
    input: options.input,
    inference,
    modelId,
    onEvent: (event) => {
      const text = readEventText(event);
      if (text) write(text);
    },
  });

  write('\n');
  write(`[linnkit] runId=${result.runId}\n`);
  write(`[linnkit] tokens input=${result.cost.tokensInput} output=${result.cost.tokensOutput}\n`);
  return 0;
}
