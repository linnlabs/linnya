import {
  prepareCanvasEvaluationConfigs,
  setupCanvasEvaluation,
  attachCanvasEvaluation,
  startCanvasEvaluation,
  collectCanvasEvaluation,
  waitCanvasEvaluation,
  continueCanvasApprovalEvaluation,
  type EvaluationRunnerPorts,
} from './index';
import { readEvidence } from './adapters/evidenceFiles';
import { executeEvaluationCli } from './adapters/evaluationCli';
import { executeEvaluationBridge } from './adapters/evaluationBridge';
import { verifyEvaluationSourceRevision } from './adapters/verifySourceRevision';
const ports: EvaluationRunnerPorts = {
  cli: executeEvaluationCli,
  bridge: executeEvaluationBridge,
  verifyRevision: verifyEvaluationSourceRevision,
};
const [command, directory, argument] = process.argv.slice(2);
async function run(): Promise<unknown> {
  if (!command || !directory)
    throw new Error(
      'Usage: run.ts setup CONFIG NEW-DIR | attach RUN-DIR CONNECTION | start RUN-DIR | continue-approval RUN-DIR CONTROLS.json | collect RUN-DIR NEW-LABEL | wait RUN-DIR NEW-LABEL [TIMEOUT-MS]'
    );
  if (command === 'configs' && argument)
    return prepareCanvasEvaluationConfigs({
      matrix: await readEvidence(directory),
      outputDirectory: argument,
    });
  if (command === 'setup' && argument)
    return setupCanvasEvaluation({
      config: await readEvidence(directory),
      outputDirectory: argument,
      ports,
    });
  if (command === 'attach' && argument)
    return attachCanvasEvaluation({ directory, connectionFile: argument, ports });
  if (command === 'start') return startCanvasEvaluation({ directory, ports });
  if (command === 'continue-approval' && argument)
    return continueCanvasApprovalEvaluation({ directory, controlsFile: argument, ports });
  if (command === 'collect' && argument)
    return collectCanvasEvaluation({ directory, label: argument, ports });
  if (command === 'wait' && argument)
    return waitCanvasEvaluation({
      directory,
      label: argument,
      timeoutMs: Number(process.argv[5] ?? 1_200_000),
      ports,
    });
  throw new Error('Invalid evaluation runner command');
}
try {
  process.stdout.write(JSON.stringify(await run()) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
