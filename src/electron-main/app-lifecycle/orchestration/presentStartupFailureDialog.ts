import type { AppServerStartupFailure } from '../../../app-hosts/linnya/app-server-control';
import { AppServerStartupFailedError } from '../../../infra/adapters/app-server-process';
import type {
  StartupFailureDialogChoice,
  StartupFailureDialogContext,
  StartupFailureDialogPort,
} from '../definitions/startupFailureDialog';
import { describeStartupFailureDialog } from '../functions/describeStartupFailureDialog';

const RESTART_BUTTON = 0;
const COPY_DIAGNOSTICS_BUTTON = 1;
const QUIT_BUTTON = 2;
/** 复制诊断后重新显示同一对话框；有上限，避免任何异常的 response 让启动失败收口永远不结束。 */
const MAX_DIALOG_ROUNDS = 20;

/**
 * Backend ready 之前的启动失败：说明原因，让用户选择重新启动、复制诊断信息或退出。
 *
 * 不提供删除数据、重置或跳过迁移。App Server 给出的类别优先；Main 自身的启动失败没有类别，
 * 按“原因未知”说明并附上错误文案。
 */
export async function presentStartupFailureDialog(input: {
  readonly error: unknown;
  readonly context: StartupFailureDialogContext;
  readonly port: StartupFailureDialogPort;
}): Promise<StartupFailureDialogChoice> {
  const view = describeStartupFailureDialog({
    failure: resolveStartupFailure(input.error),
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    context: input.context,
  });
  let copied = false;
  for (let round = 0; round < MAX_DIALOG_ROUNDS; round += 1) {
    const { response } = await input.port.showMessageBox({
      type: 'error',
      title: view.title,
      message: view.headline,
      detail: copied ? `${view.copiedNotice}\n\n${view.detail}` : view.detail,
      buttons: [...view.buttons],
      defaultId: RESTART_BUTTON,
      cancelId: QUIT_BUTTON,
      noLink: true,
    });
    if (response === RESTART_BUTTON) return 'restart';
    if (response !== COPY_DIAGNOSTICS_BUTTON) return 'quit';
    input.port.writeClipboardText(view.diagnostics);
    copied = true;
  }
  return 'quit';
}

function resolveStartupFailure(error: unknown): AppServerStartupFailure {
  if (error instanceof AppServerStartupFailedError) return error.startupFailure;
  return Object.freeze({ reason: 'unknown', code: null, migration_from_version: null });
}
