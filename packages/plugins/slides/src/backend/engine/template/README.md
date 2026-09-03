# Slides Engine Template

`template/` 负责导入 PPTX 模板并保存其真实主题、母版和版式元数据：

- `TemplateManager.ts` 编排 PPTX 解析、`TemplateSpec` 组装和模板仓储 port；
- `TemplateRepositoryPort` 只暴露模板保存、读取与列表能力；
- 不从 Theme 猜测另一套无人消费的 design token。未来若要增加模板设计合同，必须先明确生产消费者。

template 不是插件公开 SDK。新增导入规则时同步补 `template/__tests__` 的业务回归。
