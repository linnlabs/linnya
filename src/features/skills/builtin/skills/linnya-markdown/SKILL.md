---
name: linnya-markdown
description: Preserve and create Linnya-compatible Markdown syntax. Use when Workspace Markdown contains or needs Linnya annotations, or when a document needs a chart (bar, line, area, pie, doughnut, scatter, radar, combo).
---

# Linnya Markdown

- `<!-- linnya-annotation:v1 ... -->` is a canonical block annotation. Preserve the entire comment and keep it immediately after its target block unless the task explicitly changes or deletes that annotation.
- To add an annotation, place a plain `<!-- comment text -->` immediately after the target block. Do not handcraft the canonical JSON; Linnya will canonicalize it on save.
- A fenced block whose language is exactly `linnya-chart` is a chart: its body is one strict JSON object that Linnya renders and keeps editable. Preserve existing chart fences when you edit around them. Before writing or changing one, read [chart syntax, rules and examples](references/chart.md) with `read_resource`. Only `linnya-chart` is a chart; `chart`, `echarts` and `json` fences stay ordinary code.
