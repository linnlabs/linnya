# Project Overview

回答“这个项目里有哪些文档，各自从哪来、最近谁改过、还有什么待处理”。共享合同位于
`packages/schemas/src/project-overview.ts`，channel 为 `project-overview:list`。

- 文档：[VFS](../../../../features/workspace/vfs/README.md) 一次查询列出项目里全部可见文档和所在文件夹；
  父节点已删除的残留节点不出现，与逐级列目录看到的一致。
- 来源与最近修改：[行动账本](../../../../domains/action-ledger/README.md) 每份文档给首尾两条。最早一条是新建时给出新建者；
  主运行和子运行都显示为 `linnya_ai`，`external` 是经外部控制入口写入的改动，界面显示为 Linnya CLI（分不出调用方是人、脚本还是外部 Agent），`plugin` 是插件后台自动化。
- 最近修改时间取账本与节点时间中较晚的一个。只有账本那条足以解释最近这次改动时才给出“谁改的”，
  否则只给时间：插件文档里用户自己的编辑目前不进账本，改名和移动也只更新节点时间。
- 生成于哪个对话：新建者的对话，标题由对话持久化给出；对话已删除或不属于本项目时不给。
- 待处理：内建 Markdown 给当前待审阅修订数，其他类型为 `null`。插件文档的待处理状态由插件自己提供，尚未接入。
- 标签与字段：[语义层](../../../../domains/semantic-layer/README.md)一次读出全部文档的当前标签（ID 与名称，按打标签的先后；已删除的标签不出现）、字段版本、当前可用字段与已填的值；另给挂在标签上的字段定义（类型、选项、是否插件只读）。
- 增量刷新：带 `document_ids` 时只读这几份文档，不给文件夹数；结构变化（新建、删除、移动）由调用方整表重读。

不负责：筛选、排序、搜索和列配置的即时状态，它们在界面里。

## 保存的筛选、字段条件与看板改值

合同在 `packages/schemas/src/project-saved-filters.ts`。

- `project-overview:saved-filters`：列出、保存、改名、改条件、固定、删除、记打开时间，每次返回整份列表。存储在
  [`adapters/persistence/saved-filters`](../../adapters/persistence/saved-filters/)，表 `project_saved_filters` 随项目删除。
  定义 = 条件（类型、相对修改时间、位置、标签 ID、字段条件）+ 排序 + 布局（表格，或按单选字段分列的看板），带版本号 1；
  搜索不进定义。保存的筛选是界面配置，不进文档版本和行动账本。
- 界面保存的都是用户的，直接固定；Agent 经 `linnya query --save` 建，明确要求的固定、`--suggest` 的进“Agent 建议”。
  建议 30 天没打开在列出时清理。条件相同的判据见 `projectSavedFilterConditionKey`（不计先后，不比排序与布局），
  界面保存前用它提示复用，CLI 遇到相同条件不重复保存。
- `project-overview:match`：字段条件 → 文档 ID，经语义层 `matchSemanticQuery`，与 `linnya query` 同一套含义；
  字段已删除等无法求值时返回原因，界面明说，不当成没有结果。
- `project-overview:set-field`：看板拖动改一个字段，按期望版本写入；Renderer 请求入口把执行者绑定为用户，改动记进行动账本。

```bash
pnpm exec vitest run src/app-hosts/linnya/application/project-overview
```

5,000 个节点、深 6 层、9,200 条账本时，整表读取约 18ms（Apple Silicon 开发机，内存库）。
