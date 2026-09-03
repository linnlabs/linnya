# Document OCR Host Adapter

本目录是 Linnya 对 `DocumentOcrPort` 的 Host 实现。它把 Model Catalog 中的显式 OCR 声明投影为窄 profile，并把一次文档识别交给唯一 Provider capability。

## 目录与 owner

- `orchestration/createDocumentOcrPort.ts`：解析模型、投影 profile、选择唯一 capability；不决定 Parser retry 或切换模型。
- `capabilities/paddle/functions/`：把 Paddle 响应严格投影为逐页 Markdown，保留页码和图片索引。
- `capabilities/paddle/orchestration/`：Paddle layout 同步请求与 async job 提交/轮询/结果下载。
- `index.ts`：composition root 唯一公开入口。

## 边界

- Host 可以依赖 Model Catalog 和 Provider transport；`domains/document-ocr` 不能反向依赖本目录。
- capability 只执行一次实际 Provider 业务调用。layout 接口为单请求；job 接口的提交、轮询和下载是同一 Provider job 的完整协议，不是业务 retry。
- Parser 拥有超时、retry、并发和 partial 页策略。Host 不能在 OCR 失败后切换到通用视觉模型。
- 不按模型名、Provider 名或 URL 关键字猜协议，不接受旧 `paddleocr` 别名。
- 不存储、记录或返回 request/response body、base64、API key 和本地文件路径。
- `createDocumentOcrPort()` 在真实 capability 调用边界写入统一 `ProviderOutboundAuditPort`；只投影 OCR route、输入种类、状态与安全错误分类，不复用 LLM HTTP client。

## 测试要求

- capability 测试覆盖真实 HTTP body/header 形状、逐页结果、单页全局页码和可分类错误。
- port 测试覆盖严格 profile 投影、非 OCR 模型、缺失 route 的失败语义，以及真实 transport 到统一安全快照的完整数据流。
- Parser/Knowledge Base 业务测试证明专用 OCR 不进入 `TextGenerationPort`，且 partial 续跑不丢页码。
