# Transcription Feature

`features/transcription` 是音频转写的唯一业务 owner。它负责模型选择、ASR 协议适配、短音频格式化，以及长音频的解码、切分、转写、合并和进度编排。

本模块不属于通用 LLM inference。它不经过 `AIEngine`、Linnkit `LlmCaller` 或 Vercel AI SDK language capability；上层只依赖 `TranscriptionPort`。

## 目录

```text
src/features/transcription/
├── adapters/                 # ASR 供应商协议实现与 typed capability registry
├── audio-preprocessing/      # 解码、重采样、切分与 VAD
├── definitions/              # feature 公共合同与稳定错误
├── functions/                # 供应商响应校验、格式化、合并与去重规则
├── orchestration/            # 选模、配置投影与 ASR 调用编排
├── routes/                   # Electron backend 路由入口
├── longAudioTranscriptionService.ts
├── transcriptionService.ts
└── index.ts                  # 唯一公共入口
```

现有 `transcriptionMerger.ts`、`utils/` 和部分顶层定义仍是早期布局。后续修改它们时应按职责迁到 `definitions/`、`functions/` 或 `orchestration/`，不能再新增同类顶层文件，也不能新建 `utils`、`manager`、`common`。

## 职责边界

| 模块 | 负责 | 不负责 |
|---|---|---|
| `definitions/transcriptionPort` | vendor-neutral 输入、输出和 port | SDK 类型、凭据、HTTP 响应 |
| `orchestration/transcriptionEngine` | 按用途策略选模、校验能力、创建 adapter、返回实际模型 ID | UI 状态、长音频切分、结果展示 |
| `adapters/` | 单一 ASR surface 的请求、响应校验和认证传输 | 猜测模型协议、默认选模、业务 fallback |
| `transcriptionService` | 短音频请求参数和展示格式编排 | 读取 Model Catalog、识别 Provider |
| `longAudioTranscriptionService` | 预处理、逐段调用 port、合并、进度和临时文件生命周期 | 供应商协议与默认选模 |
| `audio-preprocessing/` | 音频解码、重采样、VAD 与重叠切分 | ASR 请求和文本规则 |
| 合并/去重 functions | 片段重叠、时间戳和 ASR 幻觉处理 | 网络调用和状态持久化 |

依赖方向固定为：route / app composition → service / orchestration → `TranscriptionPort` / pure functions → adapter。adapter 可以消费 feature definitions，但 definitions 不得反向依赖 adapter 或 Model Catalog。

## 模型与协议

- 默认模型由 `TRANSCRIPTION_MODEL_POLICY` 按 `audio_transcription` capability 选择，只有 orchestration 可以访问这一策略。
- 模型必须显式声明 Transcription domain 的 `transcription_route`。当前允许 `host:openai-audio-transcriptions` 与 `host:dashscope-qwen-asr`；未知或缺失 route 直接失败。
- `@app/schemas/transcription` 是跨端 route 的唯一 owner。Model Catalog 校验模型身份，用户端点边界校验 base identity，协议 registry 只按 `capability_id` 分派。
- 禁止根据 `model_name`、`provider`、顶层通用地址或通用 `adapter` 猜转写协议。
- `openai-transcription` 接受官方 JSON、verbose JSON 以及文本类响应；JSON 必须经过 schema 校验。
- `qwen-asr` 只接受 Qwen3-ASR-Flash 官方非流式响应合同，不读取历史 `output.text` 等猜测字段。
- Provider 合同变化时必须同步修改 parser、受控响应测试和本 README，不允许加入多格式 fallback。

Qwen 与 OpenAI 当前协议依据分别见[阿里云 Qwen-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)和[OpenAI Audio API](https://platform.openai.com/docs/api-reference/audio/createTranscription)。

## 长音频流程

1. 音频处理 worker 流式解码并切为带重叠的片段。
2. `LongAudioTranscriptionService` 逐片调用 `TranscriptionPort`；它不直接创建 Provider adapter。
3. 有句子/单词时间戳时按时间合并；没有时间戳时使用文本对齐并输出低置信度片段级时间。
4. 格式化为前端需要的完整文本、段落、模型和处理统计。
5. 除显式调试保留外，编排结束后删除临时片段。

进度阶段由长音频编排拥有，当前依次为 preprocessing、transcribing、merging、formatting、done。Renderer 只展示事件，不能复制进度权重或合并规则。

## 开发规范

- 上层新增转写消费方时，注入 `TranscriptionPort`；禁止注入具体 engine、adapter 或宽 AI 能力。
- 新增 ASR surface 时，先扩共享 typed route 与唯一 capability identity，再实现一个协议 adapter 和严格响应 parser；不要扩展启发式工厂。
- 业务规则放在 `functions/`，多步骤和副作用放在 `orchestration/`，类型与错误放在 `definitions/`。
- adapter 不决定重试、切模型或业务降级。调用次数与失败策略由业务编排显式拥有。
- 不使用 `any` 或类型断言处理供应商响应；`response.json()` 必须作为 `unknown` 校验。
- 日志只能包含阶段、模型 ID、文件大小和安全错误上下文，不得输出音频 base64、API key 或完整供应商错误 body。
- 修改默认模型时，同步更新显式 adapter、capability、环境变量名和 Model Catalog 测试。

## 测试门禁

每次修改至少运行对应的业务测试：

- typed route identity、model/base 一致性与未知 capability fail-closed；
- 官方 Provider 响应投影和未知响应拒绝；
- `TranscriptionService` 经窄 port 的参数与结果流转；
- VAD/重叠切分、长音频合并和格式化；
- Backend/Main build 与生产 import 审计。

受控 HTTP E2E 应验证实际 URL、请求格式、认证、单次调用和结果投影，但不得依赖真实账户密钥。正式安装包验证属于桌面发行门禁，不阻断纯 TypeScript ASR 边界迁移。

## 已知限制

- 文本幻觉去重已禁止把英文词内双写字母和中文正常叠字当作单字符模式；原有 5 个文本损坏回归已修复，完整 Transcription 测试集为 42 项通过。后续调整模式边界时必须同时覆盖中英文正常文本和多字符幻觉。
- `returnAudioData` 不适用于当前流式文件 worker；长音频主链只消费 worker 生成的片段文件。若产品需要内存 PCM 输出，应增加独立能力和内存预算，不能把流式 worker 结果伪装成完整 buffer。
