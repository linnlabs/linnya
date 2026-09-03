## Linnya Skill 设计文档

> 状态：首版已实现（Tier 1 + Tier 2 + Tier 3）
>
> 目标：让 Agent 通过渐进式能力披露，按需加载领域知识与工作流指导。

---

## 1. 背景

Linnya 当前已经具备较强的 Agent 与工具体系，但也遇到了一个会持续放大的结构性问题：

- 产品中存在多种页面类型，例如 Markdown、MindMap、Sheet。
- Chat 是项目级的，而不是页面级的；同一轮对话里，Agent 可能需要感知或编辑多个页面。
- 每种页面背后都有一组专用工具，尤其是 Sheet 工具数量较多。
- 如果把所有工具静态塞进 default agent，模型的工具选择负担、schema 体积和误用风险都会持续上升。

这意味着：**问题已经不再是"再精简几个工具"**，而是要重新设计"能力如何被发现、加载、激活"。

---

## 2. 当前 Linnya 的结构性问题

### 2.1 default agent 仍然依赖静态工具白名单

目前 default agent 的工具在定义时一次性写死。

```20:65:src/features/agent-registry/agents/default/index.ts
const DEFAULT_AGENT_TOOLS = [
  'knowledge_search',
  'list_knowledge_base',
  ...
  'skill',
] as const;
```

这有几个直接问题：

- default agent 开局就背负很多"并非每轮都需要"的能力。
- 新页面类型继续增加时，静态白名单会继续膨胀。
- 即使只是在 Markdown 页面里做简单编辑，模型也要同时面对很多无关工具。

### 2.2 当前 `availableTools` 只支持"收缩"，不支持"按需扩容"

现在的请求构建逻辑只允许调用方把默认工具集收缩成更小的子集，但不支持在运行过程中根据任务需要新增一组工具。这是一个独立的架构问题，将在 ToolPack 方案中单独解决。

### 2.3 纯靠子 Agent 也不是终局

子 Agent 很适合复杂隔离任务，但如果简单需求也一律走子 Agent，会带来启动延迟和过度编排。因此，"全靠子 Agent"只能作为部分场景方案，不能单独解决主问题。

---

## 3. 外部调研结论（基于实际验证）

### 3.1 Anthropic 的实际做法

经过对 Anthropic 官方文档、Claude Code 源码和 Agent Skills 开放规范的深入调研，核心发现是：

**Skill 在 Anthropic 体系中就是"结构化的提示词注入 + 文件读取"，不涉及工具集的运行时变更。**

Claude Code 的工具（Read/Write/Bash/Grep/Glob）始终固定不变。Skill 只是告诉模型"在这个场景下应该怎么用这些通用工具"。工具列表从头到尾没变过。

### 3.2 渐进式披露三层模型（已验证的业界共识）

| 层级 | 内容 | 加载时机 | Token 成本 |
|------|------|----------|-----------|
| Tier 1: Catalog | name + description | 会话开始时 | ~50-100 tokens/skill |
| Tier 2: Instructions | SKILL.md 正文 | Skill 被激活时 | <5000 tokens（建议） |
| Tier 3: Resources | 脚本、参考文档、资产 | 指令引用时按需 | 视文件大小 |

### 3.3 `allowed-tools` 和 `context: fork` 的现状

关键发现：**Claude Code 自己也没有实现这些扩展字段。**

- [GitHub #18837](https://github.com/anthropics/claude-code/issues/18837)：`allowed-tools` 没有被强制执行
- [GitHub #17283](https://github.com/anthropics/claude-code/issues/17283)：`context: fork` 和 `agent:` 字段也未被实现

因此 Linnya 首版不做这些字段，等上游稳定后再考虑。

### 3.4 对 Linnya 的启示

**Skill 与 ToolPack 是两个独立问题：**

- **Skill**（已实现）：元数据发现 + 正文按需加载 + 资源按需读取 = 纯提示词层
- **ToolPack 运行时扩容**（待研究）：这是 Linnya 独有需求（因为有大量领域专用工具），是 graph-engine 层面的架构升级

---

## 4. 首版实现方案

### 4.1 设计原则

1. **Skill 的运行时产物走标准工具输出通道**——activate 返回的正文作为 tool_output 自然留在对话历史中
2. **不引入新的上下文管道**——不需要"hidden working context"机制
3. **不改主链路**——通过 RequestEnricher + 新增工具完成，零侵入
4. **标准兼容**——SKILL.md 格式遵循 Agent Skills 开放规范

### 4.2 Skill 的三种来源

Skill 有三种来源，统一由 `discoverSkills()` 合并后提供给 Catalog 和 SkillTool：

| 来源 | 位置 | 部署方式 | 适用场景 |
|------|------|----------|----------|
| **内置 Skill**（`builtin`） | `src/features/skills/builtin/skills/<name>/SKILL.md` | 随代码发布 | 平台级通用 Skill（如 mckinsey-research） |
| **插件 Skill**（`plugin`） | `<pluginDir>/resources/skills/<name>/SKILL.md` 或官方 inline contribution 声明的资源根 | 随 enabled 插件 artifact 分发 | 官方 runtime 插件自带的领域 Skill（如 Slides、Sheet） |
| **用户 Skill**（`user`） | `AppData/skills/<name>/SKILL.md` | 用户手动创建 | 用户自定义、第三方 Skill |

**三者完全同构**——都是标准的 SKILL.md 文件 + 可选资源文件，扫描逻辑完全一致。

**优先级规则：** 内置 Skill 优先级最高，不可覆盖、不可删除；插件 Skill 次之，随插件启停/升级收缩；用户 Skill 仅作补充。同名低优先级 Skill 会被忽略。

#### 内置 Skill

标准 SKILL.md 文件，放在代码仓库的 `src/features/skills/builtin/skills/` 下：

```text
src/features/skills/builtin/skills/
└── mckinsey-research/
    ├── SKILL.md              ← 标准入口（与用户 Skill 格式完全一致）
    └── references/
        └── prompts.md        ← 参考文档（对齐规范推荐目录结构）
```

新增内置 Skill 只需在此目录下创建 `<name>/SKILL.md`，无需修改任何代码。

**打包分发：**

路径解析由 `builtin/index.ts` 的 `getBuiltinSkillsRoot()` 统一管理，按目录存在性依次尝试以下候选路径（首个存在的即为结果）：

| 优先级 | 候选路径 | 适用场景 |
|--------|----------|----------|
| 1 | `__dirname/skills`（本文件旁） | 源码编译输出保留目录结构时 |
| 2 | `<projectRoot>/src/features/skills/builtin/skills` | 开发模式：运行 dist/ 但工作区有 src/ |
| 3 | `<projectRoot>/dist/builtin-skills` | 生产构建：`copy-files.js` 复制后 |
| 4 | `<projectRoot>/dist_build/dist/builtin-skills` | 打包准备目录 |
| 5 | `process.resourcesPath/.../dist/builtin-skills` | Electron asar 打包后 |

> 关键设计：**不依赖单一环境变量或单一 `__dirname` 形态**，避免开发链路因 env 未注入导致 Skill 扫描为空。

#### 插件 Skill

插件 Skill 放在插件 artifact 内的 `resources/skills/`：

```text
<pluginDir>/
└── resources/
    └── skills/
        └── slides-design/
            ├── SKILL.md
            └── references/
                └── api-reference.md
```

插件运行态同步时，已启用磁盘插件的 `<pluginDir>/resources/skills` 与官方 inline backend contribution 的 `skillResourceRoots` 会注册为 `plugin` 来源；禁用、卸载或升级后会刷新 Skill cache。插件来源会自动补充 `metadata.pluginId`，因此 availability rule 可以统一按插件运行态过滤；`SkillTool` 只通过 catalog 读取，不直接理解插件目录结构。

#### 用户 Skill

存放在 AppData 下的 `skills/` 子目录（用户级配置/扩展，非用户文档）：

```
开发模式：<项目根>/_dev_data/skills/
生产 Electron：<userData>/AIService/skills/
生产 non-Electron：~/.linnya/AIService/skills/
```

路径由 `pathManager.getSkillsPath()` 统一管理。

```text
skills/
└── my-custom-skill/
    ├── SKILL.md              ← 入口文件（必需）
    ├── scripts/              ← 可执行脚本（可选）
    ├── references/           ← 参考文档（可选）
    │   └── REFERENCE.md
    └── assets/               ← 静态资源（可选）
```

### 4.3 SKILL.md 格式（对齐 agentskills.io/specification）

```yaml
---
name: sheet-analyst
description: Analyze, clean, and transform sheet documents. Use when working with spreadsheets, tabular data, metrics, or sheet cleanup tasks.
license: Apache-2.0
compatibility: Designed for Linnya
metadata:
  author: linnya
  version: "1.0"
allowed-tools: sheet_query_sqlite sheet_write_range
disable-model-invocation: false
---

# Sheet Analyst

## 工作流程
1. 先读取表格结构...
2. 分析数据特征...
3. ...

## 注意事项
- ...

See [the reference guide](references/REFERENCE.md) for the complete tool list.
```

#### 字段说明

| 字段 | 类型 | 必需 | 约束 | 说明 |
|------|------|------|------|------|
| `name` | string | **必需** | 1-64 字符，小写+数字+连字符，不以连字符开头/结尾，无连续连字符，**必须与父目录名匹配** | 唯一标识 |
| `description` | string | **必需** | 1-1024 字符 | 发现入口，需同时表达"做什么"和"什么时候用" |
| `license` | string | 否 | - | 许可证名称或引用 |
| `compatibility` | string | 否 | 1-500 字符 | 环境兼容性说明 |
| `metadata` | map | 否 | string→string 键值对 | 自定义元数据 |
| `allowed-tools` | string | 否 | 空格分隔（实验性） | 预批准的工具列表 |
| `disable-model-invocation` | boolean | 否 | - | 为 true 时不出现在 catalog 中（⚠️ 非标准规范字段，Claude Code 扩展） |

#### name 校验规则

解析器（`frontmatter.ts`）严格执行以下校验，不合规的 SKILL.md 会被跳过：

1. 非空，1-64 字符
2. 只允许小写字母 (`a-z`)、数字 (`0-9`)、连字符 (`-`)
3. 不能以连字符开头或结尾
4. 不能包含连续连字符 (`--`)
5. 必须与父目录名完全一致

#### 推荐目录结构（对齐规范）

```text
skill-name/
├── SKILL.md              ← 必需入口
├── scripts/              ← 可执行脚本（可选）
├── references/           ← 参考文档（可选）
│   └── REFERENCE.md
└── assets/               ← 静态资源（可选）
```

#### 资源文件约束

| 约束 | 限制值 | 说明 |
|------|--------|------|
| 资源文件数量 | ≤ 20（推荐），50（硬上限） | 过多资源说明 Skill 不够内聚，应拆分 |
| 目录嵌套深度 | ≤ 3 层 | SKILL.md 所在目录为第 0 层 |
| 单个资源文件大小 | ≤ 512KB | 超出会被 `readSkillResource` 拒绝 |

> **设计原则**：Skill 的资源文件天然就不多（通常 5-10 个以内）。如果一个 Skill 需要 50+ 资源文件，说明 SKILL.md 正文不够自包含、过度依赖外部资源——应该重新设计 Skill 结构或拆分为多个 Skill，而不是放宽工具限制。
>
> `activate` 时会顺带返回完整资源列表，模型无需额外调用 `list_resources`。这确保了"一次调用即可感知全部可用资源"，符合"用最少 token 传递最多信息"的工具设计思想。

### 4.4 架构与数据流

```
AgentDefinition.config.skill.enabled === true 时：
  → GenericAgentTask 调用 buildSkillCatalogXml()
    → discoverSkills()
      → scanDirectory(builtinRoot, 'builtin')  扫描内置 Skill 目录
      → scanDirectory(pluginRoot, 'plugin')     扫描已启用插件 Skill 目录
      → scanDirectory(userRoot, 'user')         扫描用户 Skill 目录
      → 合并去重（内置 > 插件 > 用户）
    → 构建极简 <available_skills> XML 并追加到 system prompt
  → 同时要求 availableTools 包含 'skill'

模型看到 catalog 后，判断 Skill 相关：
  模型调用 → skill(action="activate", skill_name="sheet-analyst")
    → SkillTool.handleActivate()
    → catalog.loadSkillContent("sheet-analyst")
      → 读取 SKILL.md → 解析 body + 扫描资源列表
    → SkillTool 格式化为 <skill_content> 包裹的正文 + 资源列表
    → tool_output 自然留在对话历史

模型需要更多资料时：
  模型调用 → skill(action="read_resource", skill_name="sheet-analyst", resource_path="references/REFERENCE.md", offset=1, limit=120)
    → SkillTool.handleReadResource()
    → catalog.readSkillResource("sheet-analyst", "references/REFERENCE.md")  // 支持按 1-based 行号窗口读取
      → 安全校验路径 → 读取文件
    → SkillTool 返回 <skill_resource> 包裹的内容
```

### 4.5 模块结构

```text
src/features/skills/
├── README.md                           ← 本文档
├── types.ts                            ← 核心类型（对齐 agentskills.io 规范）
├── agentSkillExposure.ts               ← Agent 级 Skill 暴露公共逻辑（available_skills 追加 + 配置校验）
├── frontmatter.ts                      ← SKILL.md 解析器（含 name 格式校验 + metadata 嵌套支持）
├── discovery.ts                        ← 三来源发现与合并（内置 + 插件 + 用户，统一扫描逻辑）
├── pluginSkillSources.ts               ← 插件 Skill 根目录只读快照
├── catalog.ts                          ← 统一查询入口（Tier 1 Catalog + Tier 2 Body + Tier 3 Resources）
├── functions/
│   └── sliceSkillResourceWindow.ts     ← Skill 资源专属的 1-based 行窗口规则
├── builtin/                            ← 内置 Skill
│   ├── index.ts                        ← 目录定位（getBuiltinSkillsRoot，多候选路径自适配）
│   └── skills/                         ← 标准 SKILL.md 目录（与用户 Skill 同构）
│       └── sheet-analyst/
│           ├── SKILL.md                ← 标准入口
│           └── references/REFERENCE.md ← 参考文档

src/tools/skill/
├── SkillTool.ts                        ← 薄编排层（参数校验 + 调用 catalog + 格式化返回）
└── index.ts                            ← 导出
```

> **职责边界**：所有文件读取/目录遍历/路径安全校验集中在 `catalog.ts`；`SkillTool.ts` 不直接碰 `fs`，只做参数解析与 StructuredToolResult 格式化（遵循 `src/tools/README.md` 工具规范）。

### 4.6 如何新增内置 Skill

1. 在 `src/features/skills/builtin/skills/` 下创建 `<name>/SKILL.md`
2. 完成——无需修改任何代码文件

扫描逻辑自动发现新目录。

### 4.7 接入点

| 接入点 | 文件 | 改动 |
|--------|------|------|
| 路径管理 | `src/shared/utils/pathManager.ts` | 新增 `getSkillsPath()` |
| 工具注册 | `src/tools/index.ts` | 导入并注册 `skillToolClasses` |
| Agent 配置 | `src/features/agent-registry/agents/*/index.ts` | 对需要 Skill 的 agent：配置 `config.skill.enabled = true` 且在 `availableTools` 中包含 `'skill'` |
| System prompt 拼接 | `src/app-hosts/linnya/agent-registry/GenericAgentTask.ts` | Skill-enabled agent 在 system prompt 末尾追加极简 `<available_skills>` |
| 配置校验 | `src/features/agent-registry/builtin/builtin-agent-definitions.ts` | 校验所有开启 Skill 暴露的 agent 都具备 `'skill'` 工具 |

### 4.8 Agent 级 Skill 暴露配置（2026-03）

- 由 `AgentDefinition.config.skill.enabled` 控制是否向模型暴露 Skill 能力
- 开启时，`availableTools` 必须同时包含 `'skill'`
- 当前已启用：`default`、`subagent_general` 以及各类 `subagent_*` 专用子 agent

---

## 5. 统一 `skill` 工具

### 5.1 工具参数

```json
{
  "action": "activate | read_resource | list_resources",
  "skill_name": "sheet-analyst",
  "resource_path": "references/REFERENCE.md"  // 仅 read_resource 需要
}
```

### 5.2 动作语义

| 动作 | 语义 | 返回内容 |
|------|------|----------|
| `activate` | 加载 SKILL.md 正文 | `<skill_content>` 包裹的 markdown + 资源列表 |
| `read_resource` | 读取 Skill 目录下的资源文件（Skill 的正式读取动作；支持 `offset`/`limit` 按 1-based 行窗口读取） | `<skill_resource>` 包裹的文件内容 |
| `list_resources` | 列出 Skill 目录下的可用文件 | 资源路径列表 |

参数和三种 action 结果由 `packages/schemas/src/tools/skill.ts` 严格定义。SkillTool 返回前与 Conversation live/reload admission 使用同一合同。Renderer 的轻量卡片只消费 action 与 Skill 身份的 presentation，不读取 raw `args/result`，也不复制 SKILL.md 正文或资源内容。Skill 资源读取不再通过通用 `resource_read` 公开给模型；历史 `skill://` 结果仅由 replay/迁移链路保留。

### 5.3 安全约束

- 资源文件路径经过 `path.resolve` + 前缀校验，防止目录逃逸
- 资源文件大小上限 512KB
- 资源列表上限 50 条
- 目录遍历最大深度 3 层

---

## 6. Skill 如何影响上下文？

基于 Anthropic 的实际验证和我们的实现，一个典型 Skill 在上下文中的演进过程：

```
初始状态
────────────────────────────────────────
tools:
  [...现有工具, skill]

system prompt:
  <available_skills>
    <skill name="sheet-analyst">Analyze, clean, and transform...</skill>
    <skill name="writing-coach">Improve writing quality...</skill>
  </available_skills>

conversation: []


用户发起请求
────────────────────────────────────────
conversation:
  [{ role: "user", content: "帮我分析这个表格" }]


模型激活 Skill
────────────────────────────────────────
conversation:
  [
    { role: "user", content: "帮我分析这个表格" },
    { role: "assistant", tool_calls: [skill(activate, "sheet-analyst")] },
    { role: "tool", content: "<skill_content name='sheet-analyst'>...正文...</skill_content>" }
  ]

注意：工具列表没变！Skill 正文作为普通 tool_output 存在。


继续读取资源
────────────────────────────────────────
conversation:
  [
    ...,
    { role: "assistant", tool_calls: [skill(read_resource, "sheet-analyst", "references/REFERENCE.md")] },
    { role: "tool", content: "<skill_resource>...参考文档...</skill_resource>" }
  ]


上下文压缩后
────────────────────────────────────────
compacted conversation:
  [summary: 之前激活了 sheet-analyst skill，读取了参考文档...]

文件系统仍有完整 Skill 目录 → 需要时可再次激活/读取
```

**核心结论：Skill 就是标准的工具调用，不需要特殊的上下文管理机制。**

---

## 7. 未来规划

### 7.1 ToolPack 运行时扩容（独立架构升级）

**这是 Linnya 独有的需求**——因为 Linnya 有大量领域专用工具（Sheet/MindMap 等），而 Anthropic 不需要解决此问题（Claude Code 的工具是通用的、数量固定的）。

核心挑战：当前 `availableTools` 只能收缩不能扩容（`assertToolsSubset` 强制）。需要在 graph-engine 层面设计 run 内动态扩容机制。

可能的方案方向：
- 在 `executorLocal` 中维护 `activeToolPacks`
- `GraphAgentExecutor.tick()` 合并基础工具 + 动态工具
- 引入 `ToolPackRegistry` 管理 pack → 工具名映射

**此方案需要独立研究和设计，不在 Skill 首版范围内。**

### 7.2 `context: fork` 与 `agent` 字段

等 Anthropic/Claude Code 上游实现稳定后再考虑。届时可复用现有 `task` / `internalAgentInvoker` 机制。

### 7.3 脚本执行

涉及安全边界（路径逃逸、网络访问、权限升级），需要单独设计。不应在 Skill 基础框架尚未稳定时推进。

### 7.4 项目级 Skill

首版只做内置级和用户级。未来如需支持项目级（随仓库分发），需增加：
- 项目目录扫描
- 优先级与覆盖规则（内置级 > 项目级 > 用户级）
- 信任检查（项目级 Skill 可能来自不受信任的仓库）

---

## 8. 主要风险

### 8.1 误激活

如果 `description` 写得过宽，模型可能频繁误触发不相关 Skill。应对：
- 在 Skill 编写指南中强调 description 质量
- 首版 Skill 数量有限，风险可控

### 8.2 上下文膨胀

多个 Skill 同时激活可能快速消耗上下文窗口。应对：
- SKILL.md 正文建议控制在 5000 tokens 以内
- 模型应避免同时激活大量 Skill
- 上下文压缩机制会自然处理过期的 Skill 内容

### 8.3 资源膨胀

如果 Skill 目录下资源文件过多或单文件过大，会导致 `activate` 返回的资源列表和 `read_resource` 的内容占用过多上下文。应对：
- 资源文件数量推荐 ≤ 20，硬上限 50（超出截断）
- 单文件大小硬上限 512KB（超出拒绝读取）
- 根本解决：Skill 应保持内聚，正文自包含，资源只作为"补充参考"而非"核心依赖"

### 8.4 缓存一致性

Skill 文件修改后，缓存可能在 TTL（5分钟）内不刷新。应对：
- 提供 `invalidateSkillCache()` 手动刷新接口
- 未来可考虑 fs.watch 实时监听
