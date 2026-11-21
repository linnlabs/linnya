/**
 * Agent 定义的 `requestAdmission` 拒绝请求时抛出的统一错误基类。
 *
 * 调用方只依赖这个类型，不 deep import 某个 Agent 的错误类：Flow 把它作为运行被拒绝的原因，
 * 上下文估算则把它理解为“没有可估算的下一次请求”。必须是无依赖的叶子模块，因为各 Agent 定义
 * 都要引用它，而注册中心又会引用这些定义。
 */
export class AgentRequestAdmissionError<Code extends string = string> extends Error {
  constructor(
    readonly code: Code,
    message: string
  ) {
    super(message);
    this.name = 'AgentRequestAdmissionError';
  }
}
