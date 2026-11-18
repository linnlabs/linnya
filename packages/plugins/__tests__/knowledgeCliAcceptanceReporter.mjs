import AcceptanceReporter from '../../../scripts/test-runner/features/acceptance-evidence/vitestReporter.mjs';
import { fileURLToPath } from 'node:url';

/** 受控 Worker 改变业务预期，必须与主测试一起绑定到反向回归回执。 */
export default class KnowledgeCliAcceptanceReporter extends AcceptanceReporter {
  onInit(context) {
    super.onInit(context);
    this.evidence.addFile(fileURLToPath(new URL('./fixtures/knowledgeCliWorker.ts', import.meta.url)));
    this.evidence.addFile(fileURLToPath(import.meta.url));
  }
}
