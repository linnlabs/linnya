# 操作合同 v1

一批最多500个原始动作；临时ref以`$`和字母开头。字段严格校验，未知字段不会被忽略。

arrange算一个原始动作，其展开的坐标更新不另占原始动作配额。300次add加末尾一次arrange共301个动作，可在同一事务中新增并整理本批ref，避免先保存长横排再单独排布。局部排布仍须显式限定新卡的elementIds，保留旧卡位置。

| op | 主要字段 |
| --- | --- |
| add | text，或type=document+document，或type=image+file；可选ref/near/after/in/side/width/color |
| update | id/revision；可选text或append、color、locked、width、图片caption/alt、连线label/direction/lineStyle/linePattern；省略字段保持原值 |
| delete | id、revision（show读取的版本）；连在被删卡上的线一起删除 |
| connect | from/to，可选ref/label/direction(none/forward/both)/lineStyle(curve/straight)/linePattern(solid/dashed) |
| disconnect | 线id、revision（show读取的版本） |
| arrange | algorithm(tree/grid/layered)，可选elementIds/direction/columns/groups；只可放最后 |

图文归纳：先添加来源文档卡，再用文字卡记录结论，通过connect标明来源；文字中的证据链接使用当前workspace文档路径或普通外部网页链接。研究联网由既有工具完成，Canvas不自造搜索能力。

局部修改：show读取revision后用update；只加新段落时优先append，原标签与图片节点保持原身份。出现reference_path_changed先重新读取，不按同路径新文档猜原目标。

多幕故事：用groups明确每幕的卡集合，grid+columns=1使每幕为一列；用顺序connect表达场景。为场景补草稿使用新ref与near/after，不改原卡正文。

groups必须是二维卡片ID/ref数组，不是包含elementIds、columns的对象；columns属于整次grid。文档add只接受document来源路径，不附text；需要自己的分析时另建文字卡。已有线的样式使用带revision的update，不删除再建新线；方向/样式按既有后写规则生效，标签仍受版本保护。
