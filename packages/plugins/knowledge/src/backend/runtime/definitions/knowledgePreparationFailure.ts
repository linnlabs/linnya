/** 仅代表知识库自己的目录或元数据准备失败；Host 合同/注册编程错误不转成局部降级。 */
export class KnowledgePreparationFailure extends Error {
  constructor(readonly cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`知识库未能启动：${detail}。其他项目仍可使用；修复资料访问问题后，请停用并重新启用知识库插件。`);
    this.name = 'KnowledgePreparationFailure';
  }
}
