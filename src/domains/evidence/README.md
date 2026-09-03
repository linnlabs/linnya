## Evidence / Ref Resolver（彻底打通引用与证据系统）

本 README 放在实现附近，作为 **EvidenceStore + Ref Resolver** 的唯一权威说明文档。

> **演进状态**：Knowledge/Web 生产者自动捕获证据、Workspace Citation 写入和 `assemble_evidence` 退役
> 已完成。当前只继续验证 `evidence_resolve` 的独立消费者与退出条件；稳定退出标准由本文维护。

### 一句话目标

把 `[@XXXXXX]` 的 **ref** 作为 conversation + instance 范围内可审计的证据身份，并保证 Evidence
生产、解析与冲突检查拥有单一 domain owner。Workspace 文档的长期引用事实由 CitationMark 保存，
不依赖 EvidenceStore 或原 conversation 永久在线。

---

### 核心概念与口径（必须统一）

- **ref（稳定短引用）**：
  - **数据层**：永远使用裸 token `XXXXXX`（6 位 base58，排除 `0/1/I/O/l`）
  - **展示层**：Markdown/模型输出使用 `[@XXXXXX]`
  - 字符集、工具入参归一化、展示格式和 Markdown token 语义统一由 Citation domain 拥有；
    Evidence 只消费 canonical 裸 ref
- **citations（UI 引用元数据）**：
  - 用于前端引用卡片：一条消息的 dependency snapshot 保存
    `ref -> (docId, blockId, snippet, title...)` 或 Web 来源
  - 它跟随 message 生命周期且可由 durable producer facts 重建，**不是跨 subagent 的语义协作通道**
- **EvidenceStore bundle（证据快照）**：
  - 用于审计/回放/写作注入：统一保存 `ref_id/source_type/title/snippet/content_text`
  - KB 证据额外包含 `doc_id/block_id/capture_kind`；search/glance 为低质量快照，full chunk 为高质量快照
  - Web 证据额外包含 `url/site_name/published_at/capture_kind`
  - 落盘位置：`Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/evidence/bundles/*.json`
- **Ref Resolver（权威解析器）**：
  - 以 EvidenceStore 为基底的“全局解析权威”：`ref -> 指针/全文（可截断）`
  - **不依赖**历史 `tool_output.data.citations`
  - 返回冻结快照用于验证、审计和恢复；Web 大文本分页由 ToolOutputStore 负责

---

### 代码位置（单一权威入口）

- **Evidence 公开入口**：`src/domains/evidence/index.ts`
- **生产装配入口**：`src/domains/evidence/evidenceDomain.ts`；只在这里把文件系统
  repository/writer 与领域用例绑定，对外签名不暴露存储实现
- **Citation ref 公开入口**：`src/domains/citation/index.ts`
- **权威 Resolver 用例**：`src/domains/evidence/features/ref-resolution/orchestration/resolveEvidenceFromBundles.ts`
  - 内部接收 repository port；调用方仍从 domain public contract 使用
    `resolveEvidenceFromBundles({ conversationId, instanceId, refs, max_units, max_chars })`

- **EvidenceStore live 写入**：`src/domains/evidence/features/bundle-store/orchestration/saveEvidenceBundle.ts`
- **Bundle repository port / 文件系统 adapter**：`src/domains/evidence/features/bundle-store/{ports,adapters}`；
  ref resolver 与 list 不再理解目录、路径或 JSON 文件读取
- **resolve 稳定合同**：`src/domains/evidence/features/ref-resolution/definitions/evidenceResolution.ts`
- **bundle wire admission**：`src/domains/evidence/features/ref-resolution/functions/parseEvidenceBundleItems.ts`；
  同时接纳 live bundle 与历史 `assemble_evidence`，但不从 Evidence 顶层公开
- **ref 列表编排**：`src/domains/evidence/features/ref-resolution/orchestration/listEvidenceRefs.ts`
- **ToolContext adapter**：`src/tools/evidence/evidenceBundleToolContextAdapter.ts`
- **工具接入点**：
  - `web_search/web_read`：Web 只生成 owner-owned capture DTO；`src/app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator.ts` 在 Host 组合边界映射 Evidence command 并注入 conversation scope
  - Workspace `write_file/edit_file` 与插件 citation source resolver 的 Evidence fallback
  - `knowledge_read`：由 `src/tools/knowledgebase/reader/knowledgeReadEvidenceAdapter.ts` 交付 Knowledge owner capture，不向 Agent 返回 bundle 身份
  - `knowledge_search/search_in_knowledgebase`：交付 Agent 实际看到的 snippet 或 deep reading view 完整块
  - `src/tools/knowledgebase/evidence/knowledgeEvidenceBundleAdapter.ts` 是上述 Knowledge capture 到 Evidence command 的唯一映射点
  - `evidence_resolve`：`src/tools/evidence/EvidenceResolveTool.ts`（模型可直接读取 EvidenceStore）
    - `mode="resolve_refs"`：按 `refs=[...]` 解析证据预览
    - `mode="list_refs"`：浏览当前 instance 下已有的 `[@ref]` 列表（推荐给模型使用，不需要 bundle_id）

---

### 文档树（Document Tree）

> 中文备注：历史记录已通过 git 追溯；此处只维护“当前权威口径”，避免文档漂移。

#### 1) 规范与说明文档（文档侧）

- **本 README（权威）**：`src/domains/evidence/README.md`
- **历史记录入口**：请通过 git history 追溯（不再保留单独的历史记录文件）
- **引用数据契约**：`packages/schemas/src/citation.ts`（`ref` 为 6 位裸 token）
- **对话引用合同与链路**：`apps/renderer/domains/conversation/docs/citation.md`

#### 2) Evidence domain 与 host adapter（核心链路）

- `src/domains/evidence/definitions/evidence.ts`：Knowledge/Web Evidence 的稳定判别联合
- `src/domains/evidence/features/ref-resolution/definitions/evidenceResolution.ts`：跨领域可见的 resolve result；不包含 repository 或 bundle wire
- `src/domains/evidence/features/ref-resolution/functions/parseEvidenceBundleItems.ts`：Evidence 内部的 live/历史 bundle 接纳规则
- `src/domains/evidence/features/ref-resolution/functions/selectEvidenceCandidate.ts`：同 ref 的质量升级与真正冲突判定
- `src/domains/evidence/features/ref-resolution/functions/materializeResolvedEvidenceItem.ts`：中英单位预算与字符硬上限
- `src/domains/evidence/evidenceDomain.ts`：生产 composition，只在这一层绑定文件系统 read/write adapter
- `src/domains/evidence/features/ref-resolution/orchestration/resolveEvidenceFromBundles.ts`：只编排 repository port、admission 与纯规则
- `src/domains/evidence/features/ref-resolution/orchestration/listEvidenceRefs.ts`：模型友好的 ref 分页列表；磁盘布局不泄漏给 Tool facade
- `src/domains/evidence/features/bundle-store/definitions/evidenceBundleWrite.ts`：live write command、scope 与 audit
- `src/domains/evidence/features/bundle-store/definitions/evidenceBundleRecord.ts`：live persistence record 与历史 record，均不从 domain 顶层公开
- `src/domains/evidence/features/bundle-store/functions/createEvidenceBundleRecord.ts`：确定性 bundle ID 与 persistence record 构建
- `src/domains/evidence/features/bundle-store/ports/evidenceBundleRepository.ts`：resolver/list 消费的窄 snapshot repository 合同；返回类型化存储身份，不把文件名交给上层重复解析
- `src/domains/evidence/features/bundle-store/adapters/fileSystemEvidenceBundleRepository.ts`：唯一负责跨 instance 目录枚举、文件名 admission 与 JSON 文件读取的 adapter
- `src/domains/evidence/features/bundle-store/ports/evidenceBundleWriter.ts`：live record 持久化窄 port
- `src/domains/evidence/features/bundle-store/adapters/fileSystemEvidenceBundleWriter.ts`：路径解析与原子 JSON 写入
- `src/domains/evidence/features/bundle-store/orchestration/saveEvidenceBundle.ts`：scope admission、record 构建与 writer 编排
- `src/tools/evidence/evidenceBundleToolContextAdapter.ts`：把 Linnya ToolContext 窄化为 domain 所需的 scope/audit；domain 不依赖 Linnkit runtime
- `src/app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator.ts`：Web owner DTO → Evidence write command 的唯一组合层 adapter
- `src/tools/evidence/EvidenceResolveTool.ts`：模型可见 facade，只负责 scope 适配与 wire 序列化
- `src/domains/markdown/features/document-write/`：通过 Citation 公开 source resolver 完成 Markdown Mark 与 pending revision hydration；不读取 Evidence 内部存储
- `src/tools/web/websearch/WebSearchTool.ts` / `src/tools/web/webread/WebReadTool.ts`：Web 证据适配器（成功即写入 `web_evidence` bundle）

#### 3) Conversation presentation：引用 token、依赖闭包与引用卡片

- `src/domains/citation/conversation-presentation.ts`
- `apps/renderer/domains/conversation/features/citation-presentation/`
- `apps/renderer/domains/conversation/ui/message/components/stream/ConversationMarkdownRenderer.ts`
- `apps/renderer/domains/conversation/ui/message/components/citation/ConversationCitationNode.vue`
- `apps/renderer/domains/conversation/services/messageProjection/projectors/tool.ts`

Host window 和 live/Subrun projection 复用 Citation domain 的 strict admission 与 scoped workspace，最终只把
正文实际使用的 dependency snapshot 交给 UI。EvidenceStore 不承担 Conversation hover registry 职责。

#### 4) Deep Research Workspace 协作（conversation + instance）

- `src/tools/types.ts`：`ToolContext.research.instanceId`
- `src/shared/utils/pathManager.ts`：Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/... 目录规则
- `src/app-hosts/linnya/agent-registry/agents/deep_research/README.md`：Deep Research 引用规范与角色分工

---

### Resolver 输出结构（可观测性/错误分层）

`resolveEvidenceFromBundles(...)` 返回（关键字段）：

- **resolved**：`Record<ref, ResolvedEvidenceItem>`（key 为裸 ref）
- **missing_refs**：请求的 ref 在 EvidenceStore 中找不到（真的缺）
- **conflicts**：同一 ref 映射到多个不同的证据指针（不同 doc_id/block_id）（数据异常，必须 fail-fast）
- **incomplete_refs**：ref 在 bundle 中出现，但缺必要字段（如 `doc_id/block_id/url/content_text`）导致不可回放（必须 fail-fast）
- **scanned_bundle_count / scanned_bundle_files / hit_sources**：调试统计

> 中文备注：**“解析不到”不等价于“不存在”**。`incomplete_refs` 专门用于避免误诊。

---

### Deep Research 与 Workspace Citation

旧 Writer pre-hook 曾把 board/outline 中的 refs 再从 EvidenceStore 物化成
`/research-evidence-snapshot.md`。Citation Track A 完成后，这条重复阅读链已删除：协作文档写入时就把
owner-admitted Knowledge/Web 来源保存为 CitationMark；Leader 用普通 `read_file` 回读即可获得 canonical
token、来源锚点、预算摘录和明确状态。EvidenceStore 仍服务生产期审计、回放与写入 fallback，不再是
最终文档阅读的前置条件。

---

### 工具侧行为（失败语义必须可解释）

- **`evidence_resolve` Agent observation**：
  - 只使用 canonical `[@XXXXXX]` 展示身份；宽松输入格式只属于参数 admission；
  - 每条来源明确标记 `snapshot_status=persisted source_status=not_checked`；
  - ref、来源类型、`doc_id + block_id` 或 canonical URL、截断状态属于可信骨架；
  - 标题与正文属于不可信来源数据，逐条进入动态 `BEGIN/END_UNTRUSTED_EVIDENCE_SOURCE` 边界；
  - `list_refs` 不把来源标题注入 observation，bundle id 只留在结构化诊断和内部审计。
  - Evidence bundle 不再通过 Knowledge HTTP route 或 ToolContext bundle-id facade 直读；live 读取统一按
    canonical ref 进入 resolver，历史 wire 只由内部 admission/projector 解释。

- **Workspace 协作文档**：
  - 新建与更新统一复用 Markdown normalization 和 citation hydration；
  - 标准 Markdown serializer 可能输出 `\[@XXXXXX\]`，权威提取器把它与 `[@XXXXXX]` 视为同一引用；
  - 写入对 missing/conflict/incomplete 来源 fail-fast，不从文档层伪造引用。
- **web_search / web_read**：
  - 工具成功时把 Web 自有 capture DTO 交给窄 writer port，不 import Evidence persistence 类型或 concrete writer
  - Host 平台 decorator 在每次 producer 执行前绑定 writer，映射并写入 `web_evidence` bundle
  - `web_read` 会把本次读取到的正文快照一并落盘，避免后续仅靠 history citation 无法回放正文
  - `web_read` 的模型长文本续读独立走 ToolOutputStore；Evidence 中同一正文的存在不等于它是分页仓库
- **knowledge_read**：
  - builder 通过 strict owner result 构建 Knowledge capture DTO，唯一工具组合 adapter 再构建 `knowledge_evidence`；Knowledge domain 不依赖 Evidence domain
  - 同一 ref 与同一 `doc_id + block_id` 下，`knowledge_document_chunk` 单向覆盖 search/glance 快照，不允许反向降级
  - Agent observation 只以 canonical `[@XXXXXX]` 作为引用身份，capture kind 与 bundle id 只服务内部解析和审计
- **knowledge_search / search_in_knowledgebase**：
  - shallow 结果先构建 Knowledge owner capture，再保存模型实际看到的 citation snippet；空结果不制造 bundle
  - deep formatter 显式返回实际发射块，只有未被 observation 总预算截掉的完整块才按 `knowledge_document_chunk` 保存
  - 不从 observation 反解析来源，也不后台保存 Agent 没看见的 SoT 块

### `evidence_resolve` 退出条件

以下条件必须全部由真实任务验证，才能删除 live facade、白名单、Prompt 和 canonical UI：

1. Web 完整抓取正文可通过既有 `tool_output_read` 续读（已完成）。
2. Knowledge 当前事实可通过 `knowledge_read` 重读，持久快照由项目 CitationMark 或正式交接承载。
3. Deep Research 角色不再需要独立 ref snapshot 读取；Default、General subagent、已退役的 Researcher subagent、Slides 和 SupplyStrata 已完成退出。
4. 减少工具后，真实任务中的引用正确率、全文可达性和跨 subrun 成功率不下降。

旧事件不随 live facade 删除，继续由 strict historical schema/projector 回放。未满足全部条件前，不用 alias、fallback 或新的通用读取工具掩盖迁移缺口。

---

### 如何测试（推荐入口）

1) Workspace citation 写入与跨会话重读：

```bash
cd /path/to/linnya
pnpm vitest run src/domains/markdown/features/document-write/__tests__/markdownCitationHydration.test.ts src/tools/workspace/__tests__/fileTools.test.ts
```

2) Web Evidence 写入与 ref 回读：

```bash
cd /path/to/linnya
npx vitest run src/tools/web/__tests__/webEvidenceStore.test.ts --reporter=verbose
```

3) Citation source admission 与 Evidence ref 质量选择：

```bash
cd /path/to/linnya
pnpm vitest run src/app-hosts/linnya/adapters/tools/citation-source-resolution/__tests__/citationSourceResolver.test.ts src/domains/evidence/features/ref-resolution/orchestration/__tests__/evidenceResolution.test.ts --reporter=verbose
```

---

### 相关文档

- Deep Research 角色与引用规范：`src/app-hosts/linnya/agent-registry/agents/deep_research/README.md`
- Agent facade 的剩余退出条件：见本文“`evidence_resolve` 退出条件”
- 历史设计与推进记录：请通过 git history 追溯
