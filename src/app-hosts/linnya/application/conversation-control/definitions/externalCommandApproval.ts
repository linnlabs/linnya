/**
 * 外部调用方（`linnya` 命令行）此刻能不能代用户批准命令。
 *
 * 默认不能：批准只能由人在桌面端的审批卡，或无界面运行时自己的终端提示里给出。不能时记下
 * 宿主种类，因为“该请用户去哪里批准、怎么放开”在两种宿主上不一样。
 */
export type ExternalCommandApprovalPolicy =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly host: 'desktop' | 'cli_runtime' };

/** 每次查询或回复时现读，用户在设置里改了之后不需要重启。 */
export interface ExternalCommandApprovalPort {
  read(): ExternalCommandApprovalPolicy;
}
