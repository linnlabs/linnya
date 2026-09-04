use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use wasm_bindgen::prelude::*;

/// 块级节点类型枚举。
/// 该枚举会被序列化为前端可消费的结构，同时也通过 wasm_bindgen 暴露给 JS。
#[wasm_bindgen]
#[derive(Serialize, Debug, Clone, PartialEq)]
pub enum BlockType {
    BaseBlock,
    HeadingBlock,
    CodeBlock,
    QuoteBlock,
    ListItemBlock,
    HorizontalRuleBlock,
    LatexBlock,
    /// CommonMark type 2 HTML block（`<!-- ... -->`）。
    ///
    /// 解析器只负责保留原始 comment；是否属于 Linnya Annotation 由上层
    /// Markdown 规范化流程按 profile 判定。
    HtmlComment,
    /// 表格块：用于承载整张表格的数据结构（表头、行、列对齐等）。
    TableBlock,
}

/// 行内标记（粗体、斜体、链接等）的描述结构。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Mark {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attrs: Option<JsonValue>,
}

/// 行内内容片段，包含文本、本身的 marks 以及可选属性。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ContentFragment {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(default)]
    pub marks: Vec<Mark>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attrs: Option<JsonValue>, // inlineLatex 等需要附带属性
}

/// 块级事件：Streaming / legacy 解析统一输出这个结构。
#[derive(Serialize, Debug, Clone)]
pub struct BlockEvent {
    pub block_type: BlockType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Vec<ContentFragment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_content_fallback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    /// 列表元信息：列表类型（bullet / ordered 等）。
    ///
    /// 设计说明：
    /// - 前端编辑器需要区分无序/有序列表（listType），并且列表项在本项目中是“一个块一行”的结构；
    /// - legacy / streaming 两套解析器都应输出该字段，避免前端只能猜测。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_type: Option<String>,
    /// 列表元信息：列表缩进层级（0,1,2,3...），与前端 listItemBlock.attrs.level 对齐。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_level: Option<u8>,
    /// 预留的扩展属性，用于携带块级结构化信息（例如表格模型、列表元数据等）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attrs: Option<JsonValue>,
}

