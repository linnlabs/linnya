import { relative } from 'node:path';
import { createEvidence, failureOf } from './createEvidence.mjs';

/** 使用 Vitest 正式事件，不从终端的 FAIL 文本猜测是否执行了断言。 */
export default class AcceptanceReporter {
  onInit(context) {
    this.root = context.config.root;
    this.evidence = createEvidence('vitest', { root: this.root });
  }

  onTestCaseResult(test) {
    const result = test.result();
    this.evidence.addFile(test.module.moduleId);
    const name = `${relative(this.root, test.module.moduleId).replaceAll('\\', '/')} > ${test.fullName}`;
    const errors = result.errors ?? [];
    // 普通错误混在断言错误里时，整项仍属于运行失败。
    const failures = errors.map(failureOf);
    const failure = failures.find(value => value.kind === 'error') ?? failures[0];
    this.evidence.record(name, result.state, failure);
    if (result.state === 'passed' && (errors.length || test.diagnostic()?.flaky)) {
      this.evidence.error(`测试经重试才通过：${name}`);
    }
  }

  onTestRunEnd(modules, errors, reason) {
    for (const module of modules) {
      this.evidence.addFile(module.moduleId);
      for (const error of module.errors()) this.evidence.error(error);
    }
    for (const error of errors) this.evidence.error(error);
    if (reason !== 'passed' && reason !== 'failed') this.evidence.error(`测试运行未正常结束：${reason}`);
    const result = this.evidence.finish();
    console.log(JSON.stringify({ acceptanceEvidence: result.manifest }));
  }
}
