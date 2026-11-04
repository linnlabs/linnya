# 风格索引

要做的稿子有明确的场景与读者时，在这里找对应的指南和页型示例，学这类稿子的页型、信息组织和机械做法。颜色、字体和图片处理来自本稿的视觉方向（有 `ppt_direction` 时由它给出），不从指南或示例里取；示例里的颜色都是中性占位值。同一份指南用在不同题材上，配色、字体搭配和版面都应该不同。

| 风格 | 什么时候用 | 主要特征 | 指南 | 页型示例 |
|---|---|---|---|---|
| 专业研究 / 咨询 | 投资研究、行业研究、咨询建议、董事会或投委会材料 | 结论型标题、来源脚注、可核对的表与图、克制的双色 | [`style-consulting-report.md`](./style-consulting-report.md) | [`style-consulting.js`](./examples/style-consulting.js) |
| 图录阅读稿 | 讲义、调研、藏品介绍，图、表、长文要同页放下 | 12 栏网格、编号图版与图注、统一的表格写法 | [`style-catalog-handout.md`](./style-catalog-handout.md) | [`style-catalog.js`](./examples/style-catalog.js) |
| 人文展示稿 | 文化、历史、非遗、博物馆题材的演讲或商业稿 | 书法大字、去背实物压版面、少量朱印 | [`style-cultural-imagery.md`](./style-cultural-imagery.md) | [`style-cultural.js`](./examples/style-cultural.js) |

产品发布、品牌提案、教学培训、极简演讲等场景暂时没有专门指南，按 [`design.md`](./design.md) 的“风格方向”一节判断。

## 怎么用

1. 先读指南，再看示例。示例只演示页型和机械做法（对齐、手排表格、箭头段、居中的提示条），颜色和字体从顶部的 `direction` 对象读取，字号和版面是一次性选择，换题材时要换。
2. 计划里的 `visualDirection` 写清四个变化轴：配色、字体搭配、页型集合、图片处理。有 `ppt_direction` 给出的方向时按它取值；没有时，同一份指南下不同题材至少要有两个轴不同，不要沿用上一份稿的取值。
3. 页型按内容选，不按页序套。做完把全部页缩略图排成一排，三页以上骨架相同，就换页型或合并内容。
4. 某个风格里反复出现的问题，优先交给 `inspect` 的检查或产品功能解决，指南里只留判断和取舍。
