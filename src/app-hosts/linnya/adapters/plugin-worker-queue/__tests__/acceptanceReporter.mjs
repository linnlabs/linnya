import { fileURLToPath } from 'node:url';
import AcceptanceReporter from '../../../../../../scripts/test-runner/features/acceptance-evidence/vitestReporter.mjs';

/** 通用 reporter 不枚举业务夹具；本场景把真实线程脚本一并绑定。 */
export default class PluginWorkerAcceptanceReporter extends AcceptanceReporter {
  onInit(context) {
    super.onInit(context);
    this.evidence.addFile(fileURLToPath(new URL('./fixtures/managed.worker.ts', import.meta.url)));
    this.evidence.addFile(fileURLToPath(import.meta.url));
  }
}
