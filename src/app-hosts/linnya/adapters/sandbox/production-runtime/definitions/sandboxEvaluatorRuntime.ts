import type {
  SandboxEvaluatorLaunch,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport';

/** App Host 在安装 production scope 前冻结并验证的专用 evaluator 资产。 */
export interface SandboxEvaluatorRuntime {
  readonly nodeVersion: string;
  readonly manifestPath: string;
  readonly launch: SandboxEvaluatorLaunch;
}
