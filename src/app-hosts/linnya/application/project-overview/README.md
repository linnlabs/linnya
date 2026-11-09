# Project Overview

回答“这个项目里有哪些文档，各自从哪来、最近谁改过、还有什么待处理”。共享合同位于
`packages/schemas/src/project-overview.ts`，channel 为 `project-overview:list`。

- 文档：[VFS](../../../../features/workspace/vfs/README.md) 一次查询列出项目里全部可见文档和所在文件夹；资源库、
  父节点已删除的残留节点不出现，与逐级列目录看到的一致。
- 来源与最近修改：[行动账本](../../../../domains/action-ledger/README.md) 每份文档给首尾两条。最早一条是新建时给出新建者；
  主运行和子运行都显示为 `linnya_ai`，`external` 是经外部控制入口直接写入的改动，`plugin` 是插件后台自动化。
- 最近修改时间取账本与节点时间中较晚的一个。只有账本那条足以解释最近这次改动时才给出“谁改的”，
  否则只给时间：插件文档里用户自己的编辑目前不进账本，改名和移动也只更新节点时间。
- 生成于哪个对话：新建者的对话，标题由对话持久化给出；对话已删除或不属于本项目时不给。
- 待处理：内建 Markdown 给当前待审阅修订数，其他类型为 `null`。插件文档的待处理状态由插件自己提供，尚未接入。
- 增量刷新：带 `document_ids` 时只读这几份文档，不给文件夹数；结构变化（新建、删除、移动）由调用方整表重读。

不负责：筛选、排序、搜索和列配置，它们是界面状态；属性、标签和保存的面板属于后续的查询合同。

```bash
pnpm exec vitest run src/app-hosts/linnya/application/project-overview
```

5,000 个节点、深 6 层、9,200 条账本时，整表读取约 18ms（Apple Silicon 开发机，内存库）。
