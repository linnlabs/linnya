# Linnya charts in Markdown

A chart is a fenced block with the language `linnya-chart` whose body is **one strict JSON object**. Linnya renders it as an interactive chart, keeps it editable, and writes it back to Markdown in one canonical form. Use it when a reader needs to compare, follow change, see composition, or see a relationship, and the numbers come from material you actually obtained or computed. Use a table when exact lookup matters or there are only a few values.

Only the language `linnya-chart` is a chart. `chart`, `echarts`, `json`, `yaml` and every other fence stay ordinary code and are never inspected. To show chart source as code (documentation, examples), use a `json` or `text` fence, or wrap the whole example in a longer outer fence as this file does.

## Writing a chart

- The body must be one JSON object. No YAML, no JSON5, no comments, no trailing commas.
- Put the chart where the reader needs it, next to the paragraph it supports. Say the unit, period, population, denominator and processing method in that prose; cite sources in the paragraph right after the chart with normal citations. The chart has no separate source field.
- Write numbers as numbers. Missing data cannot be written as `0` or `null`: leave that category out, or split the chart and say so.
- Keep estimates, forecasts and scenarios apart from observations: name them as such in the series name or title (for example `2026E (forecast)`).
- The look is chosen for you. Leave colors out unless one carries meaning; see [Color](#color).

## Fields

Unknown fields and fields that do not apply to the chosen `chartType` are rejected, not ignored. Text fields are single-line plain text.

| Field | Applies to | Meaning |
| --- | --- | --- |
| `chartType` | all | Required: `bar`, `line`, `area`, `pie`, `doughnut`, `scatter`, `radar`, `combo`. |
| `categories` | all | Required. Labels (text or numbers). For `scatter` these are the numeric X values. For `radar` they are the dimension names: at least 3, all different. |
| `series` | all | Required list. Each series has a unique `name` and `values`, one finite number per category. `pie` and `doughnut` take exactly one series; `combo` takes at least two. |
| `title`, `description` | all | Optional. Title up to 200 characters, description up to 1000. The description is also read out as the accessible description. |
| `size` | all | `small`, `medium` (default) or `large`: three fixed plot heights. |
| `legendPosition` | all | `top`, `bottom`, `left`, `right` or `none`. Default: `bottom` for two or more series and for `pie`/`doughnut`, none for a single series; `line` and `area` with up to five series label each line at its end instead of showing a legend. Setting it explicitly brings the legend back. |
| `palette` | all | `verdant` (greens, default), `warm` or `aqua`: the color family of the whole chart. Colors you set on a series or a point win. |
| `version` | all | Optional, only `1`. |
| `barDirection` | `bar` | `vertical` (default) or `horizontal`. Prefer `horizontal` for long labels. |
| `stacking` | `bar` | `none` (default), `stacked`, or `percent` (shares of each category total). |
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

## Color

The default look is calm: soft, low-saturation colors that follow the light and dark themes. Series take colors in a fixed order, and a series keeps its color when another one is hidden. Leave colors out unless they carry meaning.

- **Pick a family.** `palette` colors the whole chart: `verdant` (greens, the default), `warm` (brick, apricot, rose, cream) or `aqua` (blues and teals). Choose one to match the tone of the document, and never mix families inside one chart.
- **Emphasize one thing.** When one series or one bar is the point, color only that one and let the rest recede in a mid gray. Use `color` on a series, or `pointColors` for single bars and slices. A gray such as `#A0A4A8` stays quiet in both light and dark themes.
- **Custom colors are fills.** `color` and `pointColors` take `#RRGGBB`. Linnya derives a matching outline for each (deeper in light mode, brighter in dark mode), so choose soft mid tones rather than vivid ones. They do not switch with the theme.
- **Line and area charts label their ends.** With up to five series and no `legendPosition`, each line carries its name and last value at its right end instead of a legend.

### Emphasis example

````markdown
```linnya-chart
{
  "chartType": "bar",
  "title": "2025 年主要城市新能源汽车销量",
  "categories": ["上海", "北京", "深圳", "杭州", "广州"],
  "series": [
    { "name": "销量", "values": [20.5, 12.4, 15.2, 9.3, 8.1], "pointColors": ["#5B9279", "#A0A4A8", "#A0A4A8", "#A0A4A8", "#A0A4A8"] }
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
