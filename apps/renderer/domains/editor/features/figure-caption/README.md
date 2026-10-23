# 图题注

图片 caption 与图表 title/description 共用图下居中题注，位于图形、图例、量尺脚注和临时阅读提示之后；空值不保留占位，不生成图号。图片 alt/title 不参与显示题注。图表标题/图片题注最多 200 字，图表说明最多 1000 字，编辑器提交单行纯文本并自然折行。

`FigureCaptionField` 使用公共 CustomTextarea；组合输入期间 Enter 和失焦不会提前提交，结束组合后处理延迟失焦。Enter/blur 提交、Esc 取消，无变化不产生事务。提交前比较整个节点的版本，Pending、历史只读或源码面板期间不能覆盖内容。NodeView 保留 Tiptap 默认 stopEvent；题注容器隔离自身按键/鼠标事件。

NodeView 拥有字段与块的映射，通过一次独立历史分组的属性事务提交，形成一步撤销；共享组件不访问文档 store。编辑期间请求虚拟化 keep-alive，图注进入初始估高，最终由真实尺寸测量校正。HTML figcaption、图表 PNG 和 PDF 均保持图下位置。

验证包括输入法/并发草稿测试、图片原子 Pending 与复制测试，以及真实 Electron 中的 ChartBlock/ImageBlock 提交、单步撤销、取消、只读和明暗窄屏检查。
