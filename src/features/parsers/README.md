# 文档解析

本目录拥有文本、Office、图像和 PDF 到 `ParsedBlock` 的唯一解析实现。知识库拥有任务、切块、检索索引和持久化；文件读取拥有它的分页窗口与资源范围。两者不复制解析器。

插件公开入口为 `@plugin/backend/documentParsingRuntime`，Worker 构建使用必须内联的
`@plugin/backend/worker/documentParsingRuntime`。只暴露整份解析、PDF 页数、指定 PDF 页解析，
不暴露 parser registry、模型目录、凭据或用户数据根。主线程 SDK 按需加载解析实现，注册插件时不加载 PDF/Office 依赖。

`ParsedBlock`、PDF 诊断和三项操作的类型由
[`documentParsingRuntime`](../../../packages/plugin-host-contract/backend/documentParsingRuntime.ts) 唯一定义；旧 parser 类型入口重导出，保留现有 Host 消费。图片和 PDF 提示词正文属于 `definitions/`，Host Agent Prompt 登记引用同一正文。

调用方必须冻结模型、文件身份与本次任务临时目录。SDK 不自行选择默认模型，也不偷偷换模型：

- 知识库入队在 Host 选择并冻结 PDF OCR/图片模型，Worker 只消费该事实。
- PDF 失败页续跑在所属业务用例选择模型，再传入同一视觉解析策略。
- `read_file` / `web_read` 使用 PDF 文字层读取，不调用模型，不受 OCR 默认值影响。
- 普通 PDF 仍先提取文字和几何布局；只有进入视觉层才要求 OCR 模型。没有配置视觉模型，不影响可直接读取的文本 PDF。

外部 `AbortSignal` 贯穿推理请求、重试退避和后续页调度。取消不会变成可重试的 OCR 故障；在途页面收口后释放 PDF、栅格和临时文件。原有重试分类、次数与 partial 成功语义保持不变。已被远端服务接纳的任务是否真正撤销仍取决于其协议；这里不承诺撤单或退费。

验证入口：`src/plugin-sdk/backend/documentParsingRuntime.integration.test.ts` 与 `pdfParser/`、`imageParser.test.ts`。PDF 性能和页级行为见 [PDF owner](./pdfParser/README.md)。

`generateParsedBlockId` 仅重导既有确定性块 ID 函数；解析结果与知识库后处理使用同一 UUID namespace/算法，不开放其他 ID 工具。
