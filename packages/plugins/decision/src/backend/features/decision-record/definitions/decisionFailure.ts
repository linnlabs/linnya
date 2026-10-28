/** 可向调用者解释的业务失败；存储/编程异常继续交给 Host 的安全诊断。 */
export class DecisionFailure extends Error {
  constructor(readonly code: 'invalid_model' | 'not_found' | 'revision_conflict' | 'constraint_failed' | 'no_changes' | 'export_failed', message: string) {
    super(message);
    this.name = 'DecisionFailure';
  }
}
