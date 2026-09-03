# Image Generation Domain

`image-generation`
拥有“请求生成多少张什么尺寸的图片，以及返回的图片字节是否满足业务合同”这一独立领域边界。它不认识 Vercel
AI SDK、Provider HTTP 形状、Model Catalog、文件系统或 Assets。

## 目录与职责

```text
image-generation/
├── features/generation/
│   ├── definitions/       # ImageGenerationPort、请求/结果与稳定失败
│   ├── functions/         # 尺寸 preflight、结果数量/字节不变量
│   └── index.ts           # feature 公开面
├── index.ts               # domain 唯一跨域入口
└── README.md
```

本 domain 负责：

- 定义不含 SDK 类型的 `ImageGenerationPort`；
- 接纳模型目录明确列出的 `2K/4K` 等 Provider 原生尺寸；
- 对 `WxH` 尺寸执行最小/最大像素数校验；
- 保证 Provider 返回图片数量等于业务请求、每张字节非空；
- 向上层暴露稳定的 aborted/transport/provider/protocol 失败分类。

本 domain 不负责：

- 读取模型、凭据或选择 Provider capability；
- 调用 AI SDK、拼 URL、解析 Provider body 或决定重试；
- 下载临时 URL、识别图片 MIME、命名、落盘或签发 asset claim；
- 决定 Agent 工具 schema、conversation 路径或 Renderer 展示。

## 依赖方向

正式链路固定为：

`GenerateImageTool → app-level image-generation workflow → ImageGenerationPort + Assets publication`

Host 实现在
[`app-hosts/linnya/adapters/image-generation`](../../app-hosts/linnya/adapters/image-generation/README.md)
读取 Model Catalog typed route，并通过 AI SDK 生成字节。跨 Image
Generation 与 Assets 的协作只存在于 application use
case；两个 domain 不允许互相 import。

图片模型可以来自默认、用户或账号目录；domain 不区分凭据来源。Host 统一通过 model-request-auth 按请求解析环境变量、加密 secret、host-managed
identity 或 Provider account
OAuth。ChatGPT 订阅的图片能力与语言 Responses 使用同一账号身份，但走独立的
`/images/generations` route，不借用语言请求的协议头或消息合同。

聊天模型与图片生成模型是两个用途绑定。`generate_image`
必须消费本次请求明确注入的图片生成模型；未选择时以
`image_generation.model_not_configured`
在文件写入和 Provider 调用前失败，禁止在工具、workflow 或 Host
capability 中硬编码默认模型。当前聊天模型是否能看图只决定生成结果是否附加为
`tool_result_image`，不决定图片生成主操作是否成功。

## 开发规范

- 新 Provider surface 必须先扩展共享 `image_generation_route` 与受控 HTTP
  conformance，再进入默认目录；禁止按模型名、provider 或 URL 特判。
- AI SDK Host capability 是 `ImageGenerationPort`
  的唯一 Provider 执行端，不是按模型维护的 adapter；禁止在工具侧恢复 Provider 专属实现。
- 图片调用固定
  `maxRetries: 0`。业务若需要重新生成，应产生新的显式用户/Agent 动作，不能在 capability 内偷偷重试。
- 尺寸不合法时请求前失败；禁止读取上游错误文案后改尺寸重发。
- Provider
  capability 必须返回字节。临时 URL 不能穿过 port，也不能绕过 Assets 的真实解码和像素/字节门禁。
- 不支持的参数不能继续出现在工具 schema 中。新增参数时必须同时明确 route 能力、Provider 映射与业务测试。
- 测试以尺寸准入、Provider 请求次数、结果数量和发布后的真实媒体事实为主，不锁实现目录或文案快照。

日常修改至少运行：

- `pnpm exec vitest run src/domains/image-generation src/app-hosts/linnya/adapters/image-generation src/app-hosts/linnya/application/image-generation`
- `pnpm run guard:model-inference-boundary`
- `pnpm run guard:tsc-baseline`
- `pnpm run build:main`
- `pnpm run build:backend`
