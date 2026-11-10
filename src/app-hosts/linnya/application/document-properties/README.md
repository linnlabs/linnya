# 文档属性段

`read_file` 在 Workspace 文档正文前给 Agent 一段只读属性：标签、已填字段、没填的字段和被引用数。数据来自
[语义层](../../../../domains/semantic-layer/README.md)和[文档引用](../../../../domains/document-references/README.md)，
这里只负责读取、排版和写入时的识别。所有文档类型共用，插件不需要接入。

```text
[属性 · 只读，不属于正文；改用 Shell：linnya props]
标签：论文
作者：Ada
未填：年份
被 2 份文档引用（linnya links 查看）
[/属性]
```

## 什么时候出现

- 文档有标签，或被别的文档引用时才出现；两者都没有的文档不加这一段，不给每次读取加噪声。
- 只在第一页之前（普通文本 `offset` 为 1，DocumentView `offset_chars` 为 0），续读不重复。
- 放在行号正文之前、不编行号，和 `[read_file: …]` 提示同一层；`edit_file` 的行号与正文不受影响。
- 系统视图、回收站里的节点和别的项目的文档没有属性段。

## 写入时

属性段不是正文，文件工具不能改它：

- `write_file` 开头原样带回读到的属性段（行尾空白、CRLF 不算改动）时去掉它及其后一个空行，再写正文。
- `edit_file` 的 `old_string`、`new_string` 开头原样带回时同样去掉；只剩属性段可替换，或想改的文字只出现在属性段里时拒绝。
- 属性段改过、已过期（期间标签或值变了）、写在正文中间，或文档本来没有属性段时，拒绝整次写入。

拒绝时报 `DOCUMENT_PROPERTIES_READONLY`，给出 `linnya props get` 与 `linnya props set … --rev 版本` 的完整用法，
见 [Shell 内建 CLI](../core-cli/README.md#标签字段与查询)。

## 验证

```bash
pnpm exec vitest run src/app-hosts/linnya/application/document-properties packages/plugins/__tests__/workspaceFileToolsIntegration.test.ts
```
