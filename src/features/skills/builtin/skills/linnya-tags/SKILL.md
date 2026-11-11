---
name: linnya-tags
description: Classify and track Workspace documents with Linnya tags and fields through the linnya CLI. Use when collecting material into a project, sorting a messy project (drafts vs finals, kinds of material), tracking progress (status, board), saving a filter the user wants to keep, answering questions by document type or status, or managing the tags themselves (merge, rename, delete, change a field's type or options, undo). Not for topics — search covers what a document is about.
compatibility: Linnya agents with Shell (built-in linnya CLI) and Workspace file tools.
metadata:
  author: linnya
  version: "1.2.0"
---

# Linnya 标签

标签说明一份文档**是什么**（论文、访谈纪要、草稿合同），字段说明它**到哪一步**（状态：待读 / 在读 / 读完）。
标签不表示文档**讲什么**：主题、关键词、人名地名交给搜索（`grep`、正文搜索），不建成标签。
用户在项目概览的文件页按标签筛选、按单选字段看看板；标签少而准，筛选才有用。

## 什么时候打

只在这三种场景打，其他时候不打：

| 场景 | 用户会说 | 做法 |
|---|---|---|
| 收集资料 | “帮我收集 XX 的资料” | 新建资料文档时顺手打类型标签（如“论文”“新闻”“报告”）；标签有“来源”“作者”等字段就一并填 |
| 整理项目 | “把这个项目理一理，哪些是草稿、哪些定稿” | 先看清全部文档，再一次性批量打类型标签、填状态字段 |
| 跟踪进度 | “帮我跟踪这几个选题写到哪了” | 建一个单选“状态”字段挂在类型标签上，填好当前状态；用户之后在看板上拖动改 |

一次性问题（“哪些论文还没读？”）直接查完回答：已有标签就用 `linnya query`，没有就搜索和读文件。
不为回答一个问题去打标签，也不保存筛选。用户没要求整理时，不顺手给已有文档补标签。

## 打之前

1. `linnya schema` 看已有的标签和字段。意思相同就复用，哪怕名字不完全一样；不新建“文献”去重复“论文”。
2. 确实要新建时，名字用用户一看就懂的类别名，2–6 个字，不带项目名、日期或主题。
3. 新建报 `similar_name` 时，候选里多半就是要用的那个；只有确认不是同一类，才加 `--allow-similar`。
4. 一份文档通常一个类型标签；进度、阶段、是否已读这类会变的状态用字段，不建成“草稿”“定稿”两个标签。
   需要分列看板的状态用单选（`select`），选项按先后排（待读,在读,读完）。
5. 字段是工作区级的，可以挂在多个标签上：论文和报告都要“状态”时，用同一个“状态”字段。
6. 字段只挂在真正需要它的类型上。“写到哪一步”属于自己在写的文稿；收集来的论文、新闻没有这个阶段，
   除非用户要跟踪阅读进度（那是“待读 / 在读 / 读完”，另一个字段）。

```bash
linnya schema
linnya schema add-field 状态 --type select --option 草稿,修改中,定稿
linnya schema add-tag 文稿 --field 状态 --field 作者
linnya schema set-fields 论文 --field 作者 --field 年份 --field 状态   # 整体替换，先列出原有字段
```

## 写入

写入先预览：不带 `--rev` 时只试一遍，列出当前版本和将要发生的变化，最后一行是带好 `--rev` 的完整命令。
核对无误再执行那一行。多份文档一次给齐，全部成功才生效，任一份失败整体回滚。

```bash
linnya props tag workspace:/资料/a.md workspace:/资料/b.md --tag 论文
linnya props set workspace:/资料/a.md 状态=在读 作者=Ada
linnya props get workspace:/资料/a.md
```

- 只能写文档当前标签带来的字段；报 `field_not_available` 时先打上带这个字段的标签。
- 报 `revision_conflict` 说明用户刚改过：重新 `props get`，按新版本判断还要不要改，不要盲目覆盖。
- 值留空即清除；多选用逗号分隔；勾选写 `true` / `false`。
- 正文里看不出的值就不填，不写“待确认”“未知”这类占位值；需要用户补的，在回复里点名。

## 文件工具与 CLI 的边界

- 正文用 `write_file`、`edit_file`；标签和字段只用 `linnya props`。
- `read_file` 开头的“属性 · 只读”段不是正文。原样带回可以，改了会被拒绝；不要在正文里写 `#标签`、YAML 头或“标签：”行来代替。

## 查询与保存筛选

```bash
linnya query --tag 论文 --where 已读=false --sort -年份
linnya query --tag 论文 --group 状态          # 各状态多少份
```

- 条件：`=` `!=` `>` `>=` `<` `<=` `~`（包含）`!~`（不包含）；`字段=` 为空，`字段!=` 不为空。内建字段 name、type、created、updated。
- 结果有上限，首行给出总数；截断时如实说明，不要自己数。

只有用户想**留着反复看**时才保存：

- 用户明确要（“做个待读列表”“以后我要看这些”）：`linnya query … --save 待读论文`，直接出现在文件页那一排。
- 你判断这个视图以后会常用、但用户没要：最多加一个 `--save 名称 --suggest`，放进“Agent 建议”，用户点“固定”才上那一排。
- 一次性问题不保存。按单选字段 `--group` 保存会成为按它分列的看板。
- 之前放过建议、用户现在要留着看时，用同一个名字 `--save`：那条建议会被固定，不会多出一个同名的。

## 管理标签和字段

用户要求整理标签本身时才做（“把‘研究论文’并到‘论文’”“删掉没用的标签”“年份改成数字”），不顺手清理。
标签和字段整个工作区共用：改动影响所有项目，也会改写用户保存的筛选。

```bash
linnya schema merge-tags 研究论文 论文          # 先预览
linnya schema merge-tags 研究论文 论文 --yes    # 核对后执行
linnya schema rename-tag 文献 论文
linnya schema delete-tag 待核实
linnya schema rename-field 年代 年份
linnya schema retype-field 年份 --type number
linnya schema set-options 状态 --option 待读,在读=正在读,读完
linnya schema changes
linnya schema undo 改动编号 --yes
```

- 不加 `--yes` 只预览：受影响的文档数、合并要补上的字段、改类型时每个值能不能转、要改写的保存的筛选。核对后再加 `--yes`。
- 意思相同的两个标签用合并，不要删掉一个再给文档重新打：合并保留字段值，也能整批撤回。
- 改类型会清除转不了的值（原值记在改动里）。预览里转不了的不少时，先把例子告诉用户，等确认再执行。
- 选项按给出的顺序排；`旧名=新名` 改名，没列出的选项被删除，用到它的值清除。
- 执行后在回复里说清改了什么和改动编号。用户要撤回时 `linnya schema undo 改动编号 --yes`，
  标签、字段、文档上的标签与值和保存的筛选一起恢复。

## 改完告诉用户

在回复里用一两句话说清：

- 新建了哪些标签和字段（名称、选项）；没新建就不提；
- 给多少份文档打了什么、改了什么，有例外就点名；
- 去哪里看：项目概览的文件页，按“标签：xx”筛选，或切到看板按“状态”分列。

改的是标签和字段本身（合并、删除、改名、改类型、改选项）时，用 `linnya schema changes` 找到改动编号再 `linnya schema undo`。
给文档打标签、填值不满意要撤回时，用 `linnya changes`（`--run <运行ID>` 或 `--day today`）找出改过的文档，`linnya props get` 看当前版本，
再用 `linnya props restore 路径 --to 改前版本` 恢复。
