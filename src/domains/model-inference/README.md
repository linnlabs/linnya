# Model Inference Domain

`model-inference` 拥有非 Agent 业务可消费的 vendor-neutral 推理能力合同。它不拥有 Provider SDK、模型目录、凭据、Agent 策略或业务 retry。

## 目录

- `features/text-generation/`：一次无工具文本/视觉生成的 request、result、failure 与 port。
- `features/embedding/`：已投产的向量生成合同、typed failure 与批次顺序/数量/维度/有限值不变量。
- `features/reranking/`：已投产的重排合同、typed failure 与 `originalIndex` 身份/分数不变量。

## 依赖规则

- Parser、Knowledge Base 和 Graph 只能从本目录 `index.ts` 导入窄合同；
- 本 domain 不读取 Model Catalog，不创建 Vercel AI SDK Provider，不访问 credential；
- App Host 在 `app-hosts/linnya/adapters/inference/` 实现这些 port；
- retry、fallback、索引重建和并发属于调用方业务流程；每次 Host 调用只执行一个 attempt；
- 不允许新增总括性的 `InferenceEngine`、`AIEngine`、manager 或 service。

Text Generation 只支持当前真实消费者需要的 system/user 文本与图片输入，不提前加入工具调用或 Assistant continuation。Agent 继续使用 Linnkit `CanonicalInferencePort`，不能反向改用这里的窄 port。

Embedding 只表达“按输入顺序生成向量”。它不知道 Qdrant、知识库、分批进度或索引重建规则。`usage.raw` 只保留 Provider 实际返回的 usage；上游未返回时不构造本地 token 出身。

Reranking 只表达“query + 原始 documents → 原始索引 + 分数”。它不知道 RRF、Qdrant payload 或失败时是否继续搜索；禁止通过文档文本反查身份，也禁止在 Provider 失败时生成本地假分数。`usage.raw` 仅保留 Provider 实际返回的 `meta`。
