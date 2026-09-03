use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::inline::parse_inline_markdown_to_fragments;
use crate::model::{BlockEvent, BlockType, ContentFragment};

/// 列对齐方式，直接对应 Markdown 表格对齐语法。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TableAlignment {
    Left,
    Center,
    Right,
    Default,
}

impl Default for TableAlignment {
    fn default() -> Self {
        TableAlignment::Default
    }
}

/// 单元格模型：目前仅包含内容片段，后续如果需要可扩展 colspan/rowspan 等。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct TableCellModel {
    pub content: Vec<ContentFragment>,
}

/// 行模型：一行由若干单元格组成。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct TableRowModel {
    pub cells: Vec<TableCellModel>,
}

/// 整张表格的结构化模型。
/// 该模型将会被序列化到 BlockEvent.attrs 中，供前端渲染层使用。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct TableModel {
    /// 是否包含表头行（当前 pipe table 解析总是 true）
    pub with_header_row: bool,
    /// 每一列的对齐方式
    pub alignments: Vec<TableAlignment>,
    /// 表头行的每个单元格（如果 with_header_row 为 true）
    pub header: Vec<TableCellModel>,
    /// 数据行
    pub rows: Vec<TableRowModel>,
}

/// 从 Markdown pipe table 文本解析出表格 BlockEvent。
/// 注意：此函数假设传入的 markdown 字符串仅包含一整张表格的文本内容（不含前后其他块）。
pub(crate) fn parse_table_markdown_to_model(markdown: &str) -> Option<BlockEvent> {
    let table_model = build_table_model(markdown)?;
    let attrs_value: JsonValue = match serde_json::to_value(&table_model) {
        Ok(v) => v,
        Err(_) => return None,
    };

    Some(BlockEvent {
        block_type: BlockType::TableBlock,
        // 表格本身的内容全部在 attrs 中描述，这里不再重复 structured_content
        structured_content: None,
        raw_content_fallback: Some(markdown.trim_end().to_string()),
        language: None,
        level: None,
        list_type: None,
        list_level: None,
        attrs: Some(attrs_value),
    })
}

/// 实际的表格解析实现，返回内部 TableModel。
fn build_table_model(markdown: &str) -> Option<TableModel> {
    let mut lines: Vec<&str> = markdown.lines().collect();

    // 去掉头尾空行，避免噪声
    while matches!(lines.first(), Some(l) if l.trim().is_empty()) {
        lines.remove(0);
    }
    while matches!(lines.last(), Some(l) if l.trim().is_empty()) {
        lines.pop();
    }

    if lines.len() < 2 {
        // 至少需要 header + 对齐行
        return None;
    }

    let header_line = lines[0];
    let align_line = lines[1];
    let body_lines = &lines[2..];

    let header_cells = split_pipe_line(header_line);
    let align_cells = split_pipe_line(align_line);

    if header_cells.is_empty() || align_cells.is_empty() {
        return None;
    }

    // 根据对齐行解析每一列的对齐方式
    let max_cols = std::cmp::max(header_cells.len(), align_cells.len());
    let mut alignments = Vec::with_capacity(max_cols);
    for i in 0..max_cols {
        let spec = align_cells.get(i).map(|s| s.as_str()).unwrap_or("");
        alignments.push(parse_alignment_spec(spec));
    }

    // 构造表头 cells
    let mut header = Vec::with_capacity(max_cols);
    for i in 0..max_cols {
        let cell_text = header_cells.get(i).cloned().unwrap_or_default();
        let fragments = parse_inline_markdown_to_fragments(&cell_text);
        header.push(TableCellModel { content: fragments });
    }

    // 构造数据行
    let mut rows: Vec<TableRowModel> = Vec::new();
    for &line in body_lines {
        if line.trim().is_empty() {
            continue;
        }
        let cells = split_pipe_line(line);
        if cells.is_empty() {
            continue;
        }
        let mut row_cells = Vec::with_capacity(max_cols);
        for i in 0..max_cols {
            let cell_text = cells.get(i).cloned().unwrap_or_default();
            let fragments = parse_inline_markdown_to_fragments(&cell_text);
            row_cells.push(TableCellModel { content: fragments });
        }
        rows.push(TableRowModel { cells: row_cells });
    }

    Some(TableModel {
        with_header_row: true,
        alignments,
        header,
        rows,
    })
}

/// 将一条 pipe table 行拆分为若干单元格文本，做适度空白修剪。
pub(crate) fn split_pipe_line(line: &str) -> Vec<String> {
    // 去掉首尾空白
    let mut s = line.trim().to_string();

    // 去掉行首/行尾多余的竖线
    if s.starts_with('|') {
        s.remove(0);
    }
    if s.ends_with('|') {
        s.pop();
    }

    s.split('|')
        .map(|cell| cell.trim().to_string())
        .collect::<Vec<_>>()
}

/// 解析对齐说明单元格（例如 `---`, `:---`, `---:`, `:---:`）为 TableAlignment。
pub(crate) fn parse_alignment_spec(spec: &str) -> TableAlignment {
    let trimmed = spec.trim();
    // 必须包含至少一个 '-' 才视为有效对齐语法，否则返回 Default
    if !trimmed.chars().any(|c| c == '-') {
        return TableAlignment::Default;
    }

    let starts_with_colon = trimmed.starts_with(':');
    let ends_with_colon = trimmed.ends_with(':');

    match (starts_with_colon, ends_with_colon) {
        (true, true) => TableAlignment::Center,
        (true, false) => TableAlignment::Left,
        (false, true) => TableAlignment::Right,
        (false, false) => TableAlignment::Default,
    }
}

/// 判断给定行是否符合“表头 + 对齐行”的表头行（header）特征。
/// 这里的判断相对宽松：只要能按 `|` 切成至少 1 个单元格，并且这一行不是纯空白，就认为有潜力。
pub(crate) fn looks_like_table_header_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let cells = split_pipe_line(trimmed);
    !cells.is_empty() && line.contains('|')
}

/// 判断是否为合法的对齐行（第二行），要求每个单元格只由 `:` 和 `-` 组成，且至少包含一个 `-`。
pub(crate) fn is_alignment_line(line: &str) -> bool {
    let cells = split_pipe_line(line);
    if cells.is_empty() {
        return false;
    }

    fn cell_is_alignment_spec(cell: &str) -> bool {
        let trimmed = cell.trim();
        if trimmed.is_empty() {
            return false;
        }
        if !trimmed.chars().any(|c| c == '-') {
            return false;
        }
        trimmed
            .chars()
            .all(|c| c == '-' || c == ':')
    }

    cells.iter().all(|c| cell_is_alignment_spec(c))
}

/// 判断一行是否看起来像表格的数据行：只要能拆成至少 1 个单元格即可。
pub(crate) fn looks_like_table_body_row(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let cells = split_pipe_line(trimmed);
    !cells.is_empty() && line.contains('|')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_pipe_table_model() {
        let markdown = "\
| col1 | col2 |
| :--- | ---: |
| a    | b    |
| c    | d    |
";

        let model = build_table_model(markdown).expect("table should parse");
        assert!(model.with_header_row);
        assert_eq!(model.alignments.len(), 2);
        assert_eq!(model.alignments[0], TableAlignment::Left);
        assert_eq!(model.alignments[1], TableAlignment::Right);

        assert_eq!(model.header.len(), 2);
        assert_eq!(
            model.header[0].content[0].text.as_deref(),
            Some("col1")
        );
        assert_eq!(
            model.header[1].content[0].text.as_deref(),
            Some("col2")
        );

        assert_eq!(model.rows.len(), 2);
        assert_eq!(
            model.rows[0].cells[0].content[0].text.as_deref(),
            Some("a")
        );
        assert_eq!(
            model.rows[0].cells[1].content[0].text.as_deref(),
            Some("b")
        );
    }

    #[test]
    fn parse_table_block_event_shape() {
        let markdown = "\
| col |
| --- |
| v   |
";

        let event = parse_table_markdown_to_model(markdown).expect("should produce BlockEvent");
        assert_eq!(event.block_type, BlockType::TableBlock);
        assert!(event.structured_content.is_none());
        assert!(event.raw_content_fallback.as_ref().unwrap().contains("col"));

        let attrs = event.attrs.expect("attrs should be present");
        let model: TableModel =
            serde_json::from_value(attrs).expect("attrs should deserialize into TableModel");
        assert_eq!(model.header.len(), 1);
        assert_eq!(
            model.header[0].content[0].text.as_deref(),
            Some("col")
        );
        assert_eq!(model.rows.len(), 1);
    }
}


