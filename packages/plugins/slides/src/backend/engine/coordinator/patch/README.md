# `coordinator/patch/` —— DeckSpecPatchApplier 子模块

> 上层入口：[`../DeckSpecPatchApplier.ts`](../DeckSpecPatchApplier.ts)（薄编排，<130 行）。
> 包级边界与测试入口见 [`../../../../../README.md`](../../../../../README.md)。

`DeckSpecPatchApplier` 把 `PatchSpec`（AI 产出的可逆 patch 计划）应用到 `DeckSpec` 上。
本目录把历史上 670 行的单类按"structured / freeform 双链 + slide-level 编排"拆成 5 个文件，
主类只保留唯一入口 `apply()` 与 element op 二分派。

```
coordinator/DeckSpecPatchApplier.ts   ← 薄编排：apply() + 二分派
coordinator/patch/
├── types.ts                          ← FreeformTransform / FreeformElementMatch / ElementPatchOperation
├── shared.ts                         ← findSourceElementInfo / positionScore / mergeBox / reorderItem / round3
├── structuredApplier.ts              ← structured slide 链：findStructuredElementIndex + 7 个 op handler
├── freeformApplier.ts                ← freeform slide 链：visit + transform + match + 7 个 op handler
└── slidePlan.ts                      ← slide-level：collectDeletedSlides / collectInsertions / resolveOriginalSlideOrder / pushInsertedSlides
```

## 模块边界（单一职责）

| 模块 | 职责 | 不允许 |
|------|------|--------|
| `types.ts` | 内部类型契约（不引入业务实现，避免循环依赖） | 任何函数 |
| `shared.ts` | 两条主链都用的纯工具：source 元素查找 / 位置打分 / Box 合并 / reorder / 三位小数 | 任何 spec.type 特定逻辑 |
| `structuredApplier.ts` | structured slide 的 element-level patch：候选打分 + 7 个 op handler | 跨 slide 操作 / freeform 元素 |
| `freeformApplier.ts` | freeform slide 的 element-level patch：递归 visit + transform 累计 + match + 7 个 op handler | 跨 slide 操作 / structured 元素 |
| `slidePlan.ts` | slide-level：收集 delete / insert / reorder，输出"序"，不直接 mutate deck | element-level 操作 |
| `DeckSpecPatchApplier.ts` | 薄编排：深拷贝 → element op 二分派 → slide-level 拼接 + 重编号 | 任何具体 op 实现 |

## Patch op 全景图

```
PatchOperation
├── element-level（按 spec.type 二分派到 structuredApplier / freeformApplier）
│   ├── modify_text       ← 改文本 / textStyle
│   ├── modify_style      ← 改 shape style
│   ├── modify_geometry   ← 改 position（freeform 链会反算成局部坐标）
│   ├── replace_image     ← 换图片 src
│   ├── update_chart      ← 改图表 data（仅 structured）
│   ├── update_table      ← 改表格 rows（仅 structured）
│   └── reorder_layer     ← 在所属父数组里重排（front/back/forward/backward）
└── slide-level（统一由 slidePlan 处理，不进 element 链）
    ├── insert_slide      ← splice index = slideNumber - 1
    ├── delete_slide      ← 1-based 位置
    └── reorder_slides    ← 完整 1-based 序列覆盖默认
```

## 加新 patch op 的 checklist

1. **加 schema**：在 `domain/SlideSpec.ts` 的 `PatchOperation` union 里加一项；让 TS 编译期发散到所有 switch。
2. **判断层级**：是 element-level 还是 slide-level？
   - element-level → 同时去 `structuredApplier.ts` 和 `freeformApplier.ts` 的 `switch (operation.op)` 里加分支；如果新 op 仅 structured 可用，freeform 那侧也要加 case 显式 no-op（注释说明原因），避免 fallthrough。
   - slide-level → 去 `slidePlan.ts` 加一个 `collectXxx` / `resolveXxx`，并在 `DeckSpecPatchApplier.apply()` 中按"insert/delete/reorder 已有顺序"挂上。
3. **更新 ElementPatchOperation**：如果是 element-level，在 `types.ts` 的 `ElementPatchOperation` 的 `Extract` 里把新 op 加上；同时在 `DeckSpecPatchApplier` 的 `isElementPatchOperation` 里加 case。
4. **加测试**：在 `__tests__/ppt-phase3.integration.test.ts` 加端到端 case；如果是几何/transform 相关，再去 `coordinator/__tests__/` 加 freeform transform 单元 case。

## 设计纪律

- **顶层深拷贝一次**：`apply()` 第一行 `JSON.parse(JSON.stringify(deckSpec))`，之后所有 mutate 都在 draft 上做；子模块不要再做拷贝，避免引用混乱。
- **两条主链对元素归类一致**：`structuredApplier.elementCategory` 与 `freeformApplier.freeformElementCategory` 都把 `shape+text → 'text'`、其余按 `element.type`，保持打分时对"同一个元素"的分类一致；改一处必须同步另一处。
- **freeform 透视换算单点收敛**：`applyFreeformTransform` / `toLocalFreeformBox` / `buildFreeformGroupTransform` 集中在 `backend/engine/shared/freeformTransform.ts`；任何路径不许在外部手算 transform，否则下次 patch 几何就错位。
- **slide-level 不直接 mutate deck**：`slidePlan` 只输出"序"和"插入桶"，由主类按序拼接 originalSlideMap + insertions——便于未来加"undo / preview" 时复用纯函数计算结果。
- **找不到元素静默 no-op**：所有 op 在找不到目标时返回 0/空，不抛错——AI patch 经常因为重新生成而 target 不再存在，抛错会让整段 patch 失败；记录在 inspect tool 里即可。

## 关联模块

- 迁移期 host `PptCoordinator`：调用方，串联 PatchPlanBuilder → DeckSpecPatchApplier → DeckAssembler。
- [`../../patch/PatchPlanBuilder.ts`](../../patch/PatchPlanBuilder.ts)：从 inspect 后的 deck + AI 输入产出 PatchSpec。
- 迁移期 host `presentationEditEngineTargets.ts`：tooling 入口侧消费同一份 PatchSpec。
