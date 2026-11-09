# designDirection

新建整稿时由程序发出的视觉方向：方向池、发放规则、给 Agent 的说明，以及 deck.js 声明回来的
`theme.direction` 合同。它解决的是“同一题目、不同用户做出的稿子长得一样”：方法（手法、配色逻辑、
色相、字体与图片策略、封面构图、内容母题）由程序随机给出，具体颜色值、字体、构图仍由 Agent 按内容决定。

用户界面上这一步只叫“找灵感”；方向如何产生不对用户展示。

## 结构

```text
designDirection/
├── definitions/
│   ├── coverComposition.ts        # 封面构图编号（不进 build Worker）
│   ├── directionContract.ts       # 场景、大胆度、各轴 id、手法卡类型、发放请求与 theme.direction 声明 schema
│   └── directionToolContract.ts   # ppt_direction 参数、轻量 data 与结果 schema
├── pool/
│   ├── techniqueCards.ts          # 手法卡（按 8 个家族）：借用的体裁、适用场景权重、兼容的轴、贯彻办法与常见失败
│   └── axes.ts                    # 配色逻辑、字体策略、图片策略、封面构图、12 档色相；同质化吸引子与大胆度权重
├── functions/
│   ├── drawDirection.ts           # 种子随机发放：场景 × 大胆度 × 本机历史降权 × 吸引子降权，批内去重
│   ├── buildDirectionHistory.ts   # 最近用过的方向 → 卡片与色相历史
│   ├── formatDirectionDraw.ts     # 给 Agent 的方向说明（不出现“签”“抽取”）
│   └── resolveDeckDirection.ts    # 只有生成稿把 theme.direction 交给 inspect
└── __tests__/
```

## 规则

- 方向只决定“用什么方法表达”。内容要求、数据核对、字号下限与 Skill 的手艺底线不变。
- 发放是可复现的：同一 `seed`、同一历史得到同一方向。正常调用不传 `seed`，由工具随机生成；provider
  参数目录不暴露 `seed`，只有基准与 CLI 直接调用时使用。
- 权重：
  - 卡片按场景权重（0 不进入该场景）乘以大胆度权重；
  - 本机最近 5 份用过的卡片乘 0.15，6–15 份乘 0.5；
  - 色相按场景适配：商务（投研、汇报）不发梅紫、胭脂，紫色乘 0.3；学术的梅紫、胭脂乘 0.3；
  - 湖蓝/靛蓝色相乘 0.35，染纸底配墨色乘 0.5，最近 3 份用过的色相乘 0.4；
  - 封面构图（标题与主体的位置）：左题右图乘 0.25；图片策略基本无图时不发多格拼贴；
  - 母题越常见越不容易被选中（`(1 − typicality)² + 0.05`）。
- 一次发多个方向时，任意两个至少在家族、配色逻辑、图片策略中两项不同。
- Agent 传 `requireImages`（用户要求配图，或内容离不开图片）时，不发“只用图解”“以字为画”，也不发只有这两种图片策略的卡。
- “生成插画”只在明确有生图模型时进入；当前工具上下文拿不到这项能力，第 1 期一律不发。
- 卡片、轴或权重变化时递增 `DIRECTION_POOL_VERSION`，基准按版本对账。

## 与其他模块的关系

- `backend/tools/PptDirectionTool.ts` 调用 `drawDirections`，本机历史来自
  `PresentationRepository.listRecentDirectionUses`（按新建时间读最近文稿 `deck_spec_json` 里的
  `theme.direction`）。历史读取失败按无历史处理，不阻断建稿。
- deck.js 在 `compose({ theme: { direction } })` 声明方向；`styleParsers` 用
  `DirectionDeclarationSchema` 严格校验，存入 `ThemeSpec.direction`，不写入 PPTX。
- inspect 用 `resolveDeckDirection` 取得声明，交给 quality 的方向贯彻检查
  （`direction_background_off`、`direction_font_undeclared`、`direction_color_off_palette`、
  `direction_color_excluded_hue`、`direction_image_palette_missing`），
  见 [quality README](../../backend/engine/quality/README.md)。
- 依赖方向：本目录只依赖 `zod`，不依赖 backend、renderer 或 Core。
