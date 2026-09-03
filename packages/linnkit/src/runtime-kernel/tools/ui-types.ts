/** 工具结果中由 runtime 解释或转交给 Host 的显式合同。 */

export interface ToolObservationPreviewMeta {
  filename?: string;
  doc_name?: string;
  document_name?: string;
  /** 宿主或插件拥有的文档类型；runtime-kernel 只透传，不维护产品类型枚举。 */
  doc_type?: string;
}

export interface ToolResultImageMedia {
  path: string;
  width: number;
  height: number;
}

export interface ToolControlInfo {
  requireUser?: boolean;
  questionnaireId?: string;
  resumeStrategy?: 'continue';
  terminateRun?: boolean;
  /**
   * 将工具产物投影为本轮最终答案。
   *
   * 中文说明：
   * - 这是通用工具输出契约，不绑定具体工具名；
   * - 适用于“工具是最终产物出口”的场景，例如报告写入、子任务汇总等；
   * - ToolNode 只解释该控制字段，不内置宿主业务工具名。
   */
  finalAnswer?: string;
  reason?: string;
}

export interface StructuredToolResult<T = Record<string, unknown>> {
  data: T;
  /**
   * 唯一进入 AI 上下文的业务结果视图。
   *
   * 中文说明：
   * - Agent 工具必须返回包含非空白字符的纯文本 observation；正文自然首尾空白可以保留；
   * - data 只服务 UI、审计和程序化消费，工具不得假设模型能读取 data；
   * - ToolNode 会在运行时校验该合同，缺失或空 observation 会被判为工具实现错误。
   */
  observation: string;
  /**
   * 工具结果的展示元数据。
   *
   * 中文说明：
   * - `data` 仍是唯一业务数据，产物创建、摘要和后续工具链不得依赖 media；
   * - media 只服务 UI 占位、预估高度、预览等展示场景；
   * - 图片宽高必须成对出现，缺失时工具不要写入对应 entry。
   */
  media?: ToolResultImageMedia[];
  /**
   * 工具希望交给下一轮模型的资源选择。
   *
   * 中文说明：
   * - 这是未验证的声明，不是 durable resource ref；
   * - ToolNode 必须经 host resolver 授权和完整性校验后才能写入 runtime event；
   * - 与只服务 UI 的 media 完全独立。
   */
  modelInput?: import('./model-input').ToolModelInputDeclaration;
  /**
   * observation 被落盘/预览时传给 host 的轻量展示元数据。
   *
   * 中文说明：
   * - 由工具自己声明，runtime-kernel 不按具体工具名猜测业务字段；
   * - host 可用它给大段输出预览命名或选择展示样式。
   */
  observationPreviewMeta?: ToolObservationPreviewMeta;
  control?: ToolControlInfo;
}
