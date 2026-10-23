# Linnya charts in Markdown

A chart is a fenced block with the language `linnya-chart` whose body is **one strict JSON object**. Linnya renders it as an interactive chart, keeps it editable, and writes it back to Markdown in one canonical form. Use it when a reader needs to compare, follow change, see composition, or see a relationship, and the numbers come from material you actually obtained or computed. Use a table when exact lookup matters or there are only a few values.

Only the language `linnya-chart` is a chart. `chart`, `echarts`, `json`, `yaml` and every other fence stay ordinary code and are never inspected. To show chart source as code (documentation, examples), use a `json` or `text` fence, or wrap the whole example in a longer outer fence as this file does.

## Writing a chart

- The body must be one JSON object. No YAML, no JSON5, no comments, no trailing commas.
- Put the chart where the reader needs it, next to the paragraph it supports. Say the unit, period, population, denominator and processing method in that prose; cite sources in the paragraph right after the chart with normal citations. The chart has no separate source field.
- Write numbers as numbers. Missing data cannot be written as `0` or `null`: leave that category out, or split the chart and say so.
- Keep estimates, forecasts and scenarios apart from observations: name them as such in the series name or title (for example `2026E (forecast)`).
- Choose the chart form from the comparison, then choose a named palette. Linnya owns the borderless appearance and ordered color assignment; do not write ECharts options. See [Chart forms](#chart-forms) and [Color](#color).

## Fields

Unknown fields and fields that do not apply to the chosen `chartType` are rejected, not ignored. Text fields are single-line plain text.

| Field | Applies to | Meaning |
| --- | --- | --- |
| `chartType` | all | Required: `bar`, `line`, `area`, `pie`, `doughnut`, `scatter`, `radar`, `combo`. |
| `categories` | all | Required. Labels (text or numbers). For `scatter` these are the numeric X values. For `radar` they are the dimension names: at least 3, all different. |
| `series` | all | Required list. Each series has a unique `name` and `values`, one finite number per category. `pie` and `doughnut` take exactly one series; `combo` takes at least two. |
| `title`, `description` | all | Optional. Title up to 200 characters, description up to 1000. Both appear below the figure as a centered caption and description, and participate in the accessible name/description. Use plain text, without manual line breaks or a figure number. |
| `size` | all | `small`, `medium` (default) or `large`: three fixed plot heights. |
| `legendPosition` | all | `top`, `bottom`, `left`, `right` or `none`. Default: `bottom` for two or more series and for `pie`/`doughnut`, none for a single series; `line` and `area` with up to five series label each line at its end instead of showing a legend. Setting it explicitly brings the legend back. |
| `palette` | all | A named eight-color palette; see [Color](#color) for the nine choices. Default `verdant`. Explicit series/point colors take precedence. |
| `version` | all | Optional, only `1`. |
| `barDirection` | `bar` | `vertical` (default) or `horizontal`. Prefer `horizontal` for long labels. |
| `stacking` | `bar` | `none` (default; multiple series form groups), `stacked`, or `percent` (shares of each category total). |
| `colorBy` | `bar` | `series` (default) or `category`. Category coloring requires one unstacked series and no series-level `color`; optional `pointColors` override individual categories. |
| `categoryAxis` | `bar`, `line`, `area`, `combo` | `title`, `labelRotation` (-90 to 90). |
| `valueAxis` | `bar`, `line`, `area`, `scatter` (Y), `combo` | `title`, `min`, `max`, `majorUnit`, `numberFormat`, `showGridlines`. |
| `xAxis` | `scatter` | Same keys as `valueAxis`, for the X values. |
| `secondaryValueAxis` | `combo` | Same keys as `valueAxis`, for series on the secondary axis. |
| `pointLabels` | `scatter` | One label per point (same length as `categories`). |
| `radarScale` | `radar` | Required `{ "min": 0, "max": N }`: one fixed scale for every dimension. |
| `showDataLabels`, `dataLabelFormat` | `bar`, `line`, `area`, `pie`, `doughnut`, `combo` | Value labels and their number format. Label a few points that matter, not every point. |
| `dataLabelContent` | all except `scatter`, `radar` | `value` (default). `pie`/`doughnut` also accept `percentage` and `category`. |

Series keys: `name`, `values` always; `color` (`#RRGGBB`, not for `pie`/`doughnut`); `pointColors` (list of `#RRGGBB` or `null`, one per category; `bar`, `pie`, `doughnut`, and `bar` series in `combo`); `lineDash` (`solid`, `dash`, `dot`) for line series; `marker` (`none`, `circle`, `square`, `diamond`, `triangle`) for line and scatter series; `showDataLabels` and `dataLabelFormat` where the chart type has labels. In `combo` each series also needs `chartType` (`bar`, `line` or `area`) and may set `axis` (`primary` default, or `secondary`).

`numberFormat` is `General` or a simple format: `0.0`, `#,##0`, `0.0%` (the value is a ratio, so `0.27` shows `27.0%`), `0.0"unit"`.

## Chart forms

Choose the form before styling. Do not switch chart types merely to make a report look varied.

| Reading task | Specification choice |
| --- | --- |
| Compare several measures within each group | `bar`, multiple series, `stacking: "none"` (or omit). Keep series in the same order in every group. |
| Compare totals and their additive, non-overlapping parts | `bar`, `stacking: "stacked"`. Parts must share a unit and be additive. |
| Compare composition across groups | `bar`, `stacking: "percent"`. Write raw counts; Linnya normalizes each full category total. Do not pre-normalize. |
| Rank categories or accommodate long labels | `bar`, `barDirection: "horizontal"`. Use one series; normally one color is enough. |
| Distinguish the categories of one measure by color | One unstacked `bar` series with `colorBy: "category"` and a named palette. Do not fake multiple series or fill `pointColors` just to select a palette. |
| Show a time trend or magnitude | `line` for change; `area` only when the zero baseline and magnitude matter. Never smooth or invent observations. |
| Show a few mutually exclusive shares of one whole | `pie` / `doughnut`; colors follow category order clockwise from the top. Prefer horizontal bars when there are many parts or close values. |
| Show association, a comparable profile, or observed-versus-target | `scatter`, `radar`, or `combo`, respectively. State units and comparison limits; prefer one shared value axis in `combo` when units match. |

## Color

Choose a palette ID, not a list of invented hex colors. All nine palettes have eight ordered colors. The default remains Linnya green; for several unrelated categories, prefer `pastel` unless the user requests another family.

| Palette | Appearance | Use |
| --- | --- | --- |
| `verdant` | Linnya green, deep to pale | General research; a single measure or a coherent sequence. Default. |
| `teal` | Mint / teal | A cool monochrome alternative. |
| `aqua` | Lake blue | Quantitative comparisons and trends. |
| `violet` | Iris purple | A monochrome alternative to green and blue. |
| `warm` | Bright apricot orange | Warm emphasis; not brick, brown or a red-green mix. |
| `mono` | Graphite gray | Neutral supporting figures or grayscale output. |
| `pastel` | Blue → apricot/yellow → peach → pink → purple | Preferred multicolor choice for distinct categories. |
| `sea` | Green → pale mint → light blue → cyan/deep blue | A restrained cool multicolor sequence. |
| `mist` | Deep mist blue → pale blue → pale pink → rose | A blue-to-rose multicolor sequence, without alternating blue and pink. |

- **Keep the color sequence.** Linnya uses palette order, selecting an ordered subset when fewer colors are needed; five-category multicolor charts use their core five colors, and eight-category charts use all eight. It never interleaves distant colors for contrast. Do not reshuffle categories to obtain colors, alternate warm/cool slots, or sort by hue. Time, ordinal meaning and the analytical comparison determine data order first.
- **Keep identities stable.** Grouped and stacked bars color by series; each group repeats the same series order. Pie/doughnut and `colorBy: "category"` bars color by category. Hiding a series or focusing a category range keeps the colors assigned from the complete specification. Across separate charts with the same entities, keep the same palette, entity count and order; if exact shared identity is necessary with different entity sets, use an explicit, consistent color mapping.
- **Limit what color must do.** Eight colors are not permission to crowd eight lines or slices into every chart. For more than eight color identities, split/facet or aggregate with a stated method. Existing larger charts remain accepted; the renderer interpolates along the same color band rather than cycling back to the first hue. Do not rely on these close colors alone: keep labels, line styles and data tables.
- **Prefer presets to custom colors.** Only use `color` / `pointColors` for a user-specified brand, a stable cross-chart mapping, or an explicit focus. Custom colors remain fixed across themes. `pointColors` has one entry per category; `null` inherits the series color for ordinary bars, or the ordered category color for category bars and pie/doughnut.
- **Emphasize one thing.** Color the focal series/bar and use a neutral gray for peers; explain the focus with text. Do not create an arbitrary red-versus-green scheme. Avoid making colors both dark and desaturated, and avoid a rainbow assembled one hex at a time.
- **Leave rendering to Linnya.** Filled marks and the chart shell have no decorative border; quiet grids, readable labels and whitespace provide structure. Thin strokes receive only the brightness adjustment needed for background contrast; no `style`, `border`, gradients, animation options or raw ECharts configuration belong in the JSON. Up to five line/area series use end labels unless `legendPosition` is explicit.

### Emphasis example

````markdown
```linnya-chart
{
  "chartType": "bar",
  "title": "2025 年主要城市新能源汽车销量",
  "categories": ["上海", "北京", "深圳", "杭州", "广州"],
  "series": [
    { "name": "销量", "values": [20.5, 12.4, 15.2, 9.3, 8.1], "pointColors": ["#347B45", "#A0A4A8", "#A0A4A8", "#A0A4A8", "#A0A4A8"] }
  ],
  "barDirection": "horizontal",
  "valueAxis": { "title": "万辆", "numberFormat": "0.0" }
}
```
````

## Rules the writer checks

- At most 20 series, 1000 categories, 5000 data points (series x categories) and 128 KiB of canonical JSON. Aggregate or split a chart that is larger.
- Every `values` list has exactly as many entries as `categories`.
- Value axes that carry bars or areas (`bar`, `area`, and a `combo` axis with a bar or area series) must include zero: do not set `min` above 0 or `max` below 0. Use `line` or `scatter` when a truncated baseline is the honest choice.
- `stacking: "percent"` needs non-negative values, a positive total in every category, and no `valueAxis.min`/`max`.
- `pie` and `doughnut` values are non-negative and sum to more than zero. They show shares of one whole, not an arbitrary comparison.
- `radar` values must lie between 0 and `radarScale.max`. Normalize unlike indicators first and state the method in the text.
- `combo`: at least one primary series; `secondaryValueAxis` exists exactly when some series uses `"axis": "secondary"`; `pointColors` only on bar series; `lineDash`/`marker` only on line series.
- `scatter` does not infer trends or causes. Do not claim a relationship from a plot alone.

## Reading it back

After a save, `read_file` returns the canonical form: fixed key order, two-space indent, one series per line, defaults omitted, uppercase colors. Your own key order and spacing are normalized, and writing the same chart in another layout is not a change. To edit a saved chart, copy the exact text from the latest read into `edit_file`. One series per line keeps edits precise: change `values` or a title, not the structure, unless the story changes.

If a write is rejected, nothing was committed. The error is `MARKDOWN_CHART_SPEC_INVALID` with one line per problem: the field path (for example `series[1].values`), a code such as `length_mismatch`, `unknown_field`, `out_of_range` or `invalid_combination`, and the fix. Correct the JSON and write again. Do not switch the fence to `json` to get past the error unless you really mean the content to be plain code.

## Examples

Each example is already in canonical form.

### bar

````markdown
```linnya-chart
{
  "chartType": "bar",
  "title": "2025 年主要城市新能源汽车销量",
  "categories": ["上海", "北京", "深圳", "杭州", "广州"],
  "series": [
    { "name": "销量", "values": [20.5, 12.4, 15.2, 9.3, 8.1] }
  ],
  "barDirection": "horizontal",
  "valueAxis": { "title": "万辆", "numberFormat": "0.0" }
}
```
````

### line

````markdown
```linnya-chart
{
  "chartType": "line",
  "title": "季度营收与成本",
  "categories": ["2024Q1", "2024Q2", "2024Q3", "2024Q4"],
  "series": [
    { "name": "营收", "values": [120, 132, 101, 134] },
    { "name": "成本", "values": [80, 90, 85, 95], "lineDash": "dash" }
  ],
  "valueAxis": { "title": "万元" }
}
```
````

### area

````markdown
```linnya-chart
{
  "chartType": "area",
  "title": "注册用户规模",
  "categories": ["2021", "2022", "2023", "2024"],
  "series": [
    { "name": "注册用户", "values": [1200, 1800, 3100, 4600] }
  ],
  "valueAxis": { "title": "万人" }
}
```
````

### pie

````markdown
```linnya-chart
{
  "chartType": "pie",
  "title": "收入构成",
  "categories": ["订阅", "广告", "增值服务", "其他"],
  "series": [
    { "name": "收入占比", "values": [58, 22, 14, 6] }
  ],
  "dataLabelContent": "percentage"
}
```
````

### doughnut

````markdown
```linnya-chart
{
  "chartType": "doughnut",
  "title": "各区域收入份额",
  "categories": ["国内", "北美", "欧洲", "亚太其他"],
  "series": [
    { "name": "收入份额", "values": [48, 24, 18, 10] }
  ],
  "dataLabelContent": "percentage"
}
```
````

### scatter

````markdown
```linnya-chart
{
  "chartType": "scatter",
  "title": "研发投入与专利数",
  "categories": [1, 2, 10, 14, 21],
  "series": [
    { "name": "样本企业", "values": [3, 5, 21, 25, 40] }
  ],
  "xAxis": { "title": "研发投入", "numberFormat": "0\"亿元\"" },
  "valueAxis": { "title": "专利数（件）" },
  "pointLabels": ["甲", "乙", "丙", "丁", "戊"]
}
```
````

### radar

````markdown
```linnya-chart
{
  "chartType": "radar",
  "title": "方案评估",
  "categories": ["性能", "成本", "体验", "生态", "安全"],
  "series": [
    { "name": "方案甲", "values": [80, 60, 70, 55, 90] },
    { "name": "方案乙", "values": [65, 85, 60, 75, 70] }
  ],
  "radarScale": { "min": 0, "max": 100 }
}
```
````

### combo

````markdown
```linnya-chart
{
  "chartType": "combo",
  "title": "营收与利润率",
  "categories": ["2022", "2023", "2024"],
  "series": [
    { "name": "营收", "values": [120, 132, 150], "chartType": "bar" },
    { "name": "利润率", "values": [0.22, 0.27, 0.31], "chartType": "line", "axis": "secondary" }
  ],
  "valueAxis": { "title": "亿元" },
  "secondaryValueAxis": { "title": "利润率", "numberFormat": "0%" }
}
```
````

## Common bar variants

### Grouped comparison

````markdown
```linnya-chart
{
  "chartType": "bar",
  "title": "三类报告的季度交付量",
  "categories": ["Q1", "Q2", "Q3", "Q4"],
  "series": [
    { "name": "研究综述", "values": [18, 24, 30, 36] },
    { "name": "行业专题", "values": [12, 18, 24, 30] },
    { "name": "数据简报", "values": [10, 14, 16, 24] }
  ],
  "valueAxis": { "title": "篇" },
  "palette": "pastel"
}
```
````

For additive totals, add `stacking: "stacked"` after `series`. For composition, use `stacking: "percent"` and label the axis as share; keep the same raw counts. With labels enabled, percent-stack labels show shares while the tooltip retains counts and shares. Hiding a series never changes the full denominator.

### Ordered category colors

````markdown
```linnya-chart
{
  "chartType": "bar",
  "title": "八类证据来源",
  "categories": ["论文", "报告", "披露", "访谈", "统计", "专利", "新闻", "档案"],
  "series": [
    { "name": "证据条数", "values": [28, 21, 15, 12, 9, 7, 5, 3] }
  ],
  "barDirection": "horizontal",
  "colorBy": "category",
  "valueAxis": { "title": "条" },
  "palette": "mist"
}
```
````

These numbers demonstrate syntax only. Replace them with obtained or computed research data; never present sample values as findings.
