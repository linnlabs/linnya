# Document OCR Domain

`document-ocr` 拥有专用文档识别的 vendor-neutral 合同。它向 PDF Parser、Knowledge Base 等业务流程提供窄 `DocumentOcrPort`，不拥有 Provider 协议、模型目录或凭据。

## 目录与职责

- `features/recognition/definitions/`：文档/单页图片输入、逐页 Markdown 结果、进度、稳定 Provider 错误、模型 profile 和 port。
- `features/recognition/functions/`：不依赖 Provider 的 OCR 规则；当前包含文档页数上限门禁。
- `features/recognition/index.ts`：feature 公开入口。
- `index.ts`：domain 公开入口。

## 依赖规则

- Parser 和 Knowledge Base 只能从本 domain 公开入口导入合同，不能创建 Provider adapter。
- 本 domain 不读 Model Catalog，不访问 API key/base URL，不发 HTTP 请求。
- 跨端 `document_ocr_route` 由 `@app/schemas/document-ocr` 拥有；domain 只接收 Host 投影后的窄 profile，不依赖 route wire shape。
- Linnya Host 在 `src/app-hosts/linnya/adapters/document-ocr/` 实现 port，并在 Main/Worker composition root 显式注入。
- retry、并发、partial diagnostics 和业务流程属于 Parser/Knowledge Base；Provider job 提交与轮询属于 Host capability。
- 禁止新增 `OcrManager`、宽 `service`、全局 locator 或通用 LLM 合同。

## 稳定不变量

- `modelId` 是每次识别请求的显式路由身份，调用方不能依赖默认 Provider。
- 单页重跑必须保留原文档全局页码。
- 页数上限来自已解析 profile；超限必须在上传或 Provider 请求前失败，不接受上游静默截断。
- Provider 错误不包含 response body、base64、文件路径或凭据。
