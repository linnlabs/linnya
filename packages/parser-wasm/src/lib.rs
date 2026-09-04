#![allow(dead_code)]
#![allow(unused_variables)]
#![allow(unused_imports)]

use serde::Serialize;
use wasm_bindgen::prelude::*;
use pulldown_cmark::{html as pulldown_html, Options as PulldownOptions, Parser as PulldownParser};
use regex::Regex;
use once_cell::sync::Lazy;
use std::collections::HashSet; // For language list

mod model;
mod inline;
mod streaming;
mod table;

use crate::inline::parse_inline_markdown_to_fragments;
use crate::model::{BlockEvent, BlockType, ContentFragment, Mark};

// --------- Regex 定义 ---------
static HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(?P<level>#{1,6})\s+(?P<content>.+)").unwrap());
static CODE_BLOCK_START_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*```(?P<lang>\S*)\s*$").unwrap());
static CODE_BLOCK_END_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*```\s*$").unwrap());
static QUOTE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*>\s*(?P<content>.*)").unwrap());
// Basic list item regex, does not handle indentation or complex nesting here.
// That level of detail might be better handled by pulldown_cmark on the extracted block content if needed.
// 支持：
// - 无序列表：-, *, +
// - 有序列表：1. / 1)
static LIST_ITEM_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?P<indent>\s*)(?P<marker>[-*+]|\d+[.)])\s+(?P<content>.*)").unwrap());
static HR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(?:-{3,}|_{3,}|\*{3,})\s*$").unwrap());
static HTML_COMMENT_START_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?m)^[ ]{0,3}<!--").unwrap());
// LaTeX Block: For $$...$$ or \\[...\]
// Using (?s) for DOTALL to match across newlines.
// Using non-greedy .*? for the content.

// LaTeX 块的正则表达式定义
static BLOCK_LATEX_RE_DOLLAR: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)^\s*\$\$(?P<content>.*?)\$\$").unwrap());
static BLOCK_LATEX_RE_BRACKET: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)^\s*\\\[(?P<content>.*?)\\\]").unwrap());
static BLOCK_LATEX_EQUATION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)^\s*\\begin\{equation\}(?P<content>.*?)\\end\{equation\}").unwrap());

// LaTeX块开始标记的正则表达式
static LATEX_START_DOLLAR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*\$\$").unwrap());
static LATEX_START_BRACKET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*\\\[").unwrap());
static LATEX_START_EQUATION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*\\begin\{equation\}").unwrap());

// LaTeX块结束标记的正则表达式
static LATEX_END_DOLLAR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\$\$\s*").unwrap());
static LATEX_END_BRACKET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\\]\s*").unwrap());
static LATEX_END_EQUATION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\end\{equation\}\s*").unwrap());

// --------- Language Detection Helper ---------
static COMMON_LANGUAGES: Lazy<HashSet<String>> = Lazy::new(|| {
    [
        "python", "py", "javascript", "js", "typescript", "ts", "html", "css", 
        "java", "c", "cpp", "c++", "csharp", "c#", "go", "golang", "rust", "php", 
        "ruby", "swift", "kotlin", "sql", "json", "xml", "yaml", "yml", "bash", 
        "shell", "sh", "markdown", "md", "plaintext", "text",
    ].iter().map(|s| s.to_string()).collect()
});

fn parse_language_from_line(line: &str) -> Option<String> {
    let trimmed_line = line.trim();
    // Basic checks: not too long, no internal whitespace, not empty
    if trimmed_line.is_empty() || trimmed_line.len() > 20 || trimmed_line.contains(char::is_whitespace) {
        return None;
    }
    let lang_candidate_lower = trimmed_line.to_lowercase();
    if COMMON_LANGUAGES.contains(&lang_candidate_lower) {
        return Some(lang_candidate_lower); // Return the standardized lowercase version
    }
    None
}

// BlockState / LatexType / DelimMatcher 已迁移到 streaming 模块，由 StreamingParserCore 内部使用。

// --------- StreamingParser 结构体 ---------
#[wasm_bindgen]
pub struct StreamingParser {
    core: crate::streaming::StreamingParserCore,
}

#[wasm_bindgen]
impl StreamingParser {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        StreamingParser {
            core: crate::streaming::StreamingParserCore::new(),
        }
    }

    pub fn process_chunk(&mut self, chunk: &str) -> Result<JsValue, JsValue> {
        let events = self.core.process_chunk(chunk);
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        events.serialize(&serializer).map_err(|e| e.into())
    }

    pub fn finalize_parsing(&mut self) -> Result<JsValue, JsValue> {
        let events = self.core.finalize_parsing();
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        events.serialize(&serializer).map_err(|e| e.into())
    }
}

// --------- Legacy parse_markdown & helper ---------
#[wasm_bindgen]
pub fn parse_markdown(markdown_input: &str, mode: &str) -> Result<JsValue, JsValue> {
    if mode == "html" {
        let mut options = PulldownOptions::empty();
        options.insert(PulldownOptions::ENABLE_STRIKETHROUGH);
        options.insert(PulldownOptions::ENABLE_TABLES);
        options.insert(PulldownOptions::ENABLE_TASKLISTS);
        let mut html_output = String::new();
        let parser = PulldownParser::new_ext(markdown_input, options);
        pulldown_html::push_html(&mut html_output, parser);
        Ok(JsValue::from_str(&html_output))
    } else if mode == "blocks" {
        let events = legacy_parse_lines_to_block_events(markdown_input);
        serde_wasm_bindgen::to_value(&events).map_err(|e| e.into())
    } else {
        Err(JsValue::from_str("Invalid mode specified. Use 'html' or 'blocks'."))
    }
}

fn legacy_parse_lines_to_block_events(markdown_input: &str) -> Vec<BlockEvent> {
    let mut block_events: Vec<BlockEvent> = Vec::new();
    let mut in_code_block_mode = false;
    let mut current_code_language_for_mode: Option<String> = None;
    let mut current_code_content = String::new();
    let mut current_html_comment: Option<String> = None;

    for line_content in markdown_input.lines() {
        let mut event_generated_by_special_rule = false;
        if let Some(comment) = current_html_comment.as_mut() {
            if !comment.is_empty() {
                comment.push('\n');
            }
            comment.push_str(line_content);
            if line_content.contains("-->") {
                block_events.push(BlockEvent {
                    block_type: BlockType::HtmlComment,
                    raw_content_fallback: current_html_comment.take(),
                    structured_content: None,
                    language: None,
                    level: None,
                    list_type: None,
                    list_level: None,
                    attrs: None,
                });
            }
            event_generated_by_special_rule = true;
        } else if in_code_block_mode {
            if CODE_BLOCK_END_RE.is_match(line_content) {
                if !current_code_content.trim().is_empty() {
                    block_events.push(BlockEvent {
                        block_type: BlockType::CodeBlock,
                        raw_content_fallback: Some(current_code_content.trim_end().to_string()),
                        structured_content: None,
                        language: current_code_language_for_mode.clone(),
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                }
                current_code_content = String::new();
                in_code_block_mode = false;
                current_code_language_for_mode = None;
                event_generated_by_special_rule = true;
            } else {
                if !current_code_content.is_empty() {
                    current_code_content.push('\n');
                }
                current_code_content.push_str(line_content);
                event_generated_by_special_rule = true;
            }
        } else {
            if HTML_COMMENT_START_RE.is_match(line_content) {
                if line_content.contains("-->") {
                    block_events.push(BlockEvent {
                        block_type: BlockType::HtmlComment,
                        raw_content_fallback: Some(line_content.trim().to_string()),
                        structured_content: None,
                        language: None,
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                } else {
                    current_html_comment = Some(line_content.trim_start().to_string());
                }
                event_generated_by_special_rule = true;
            } else if let Some(caps) = CODE_BLOCK_START_RE.captures(line_content) {
                let lang_str = caps.name("lang").map_or("", |m| m.as_str());
                current_code_language_for_mode = if lang_str.is_empty() { None } else { Some(lang_str.to_string()) };
                in_code_block_mode = true;
                event_generated_by_special_rule = true;
            } else if let Some(caps) = HEADING_RE.captures(line_content) {
                let level = caps.name("level").unwrap().as_str().len() as u8;
                let raw_text = caps.name("content").unwrap().as_str().to_string();
                let fragments = parse_inline_markdown_to_fragments(&raw_text);
                block_events.push(BlockEvent { 
                    block_type: BlockType::HeadingBlock, 
                    raw_content_fallback: Some(raw_text.clone()), 
                    structured_content: Some(fragments), 
                    language: None, 
                        level: Some(level),
                        list_type: None,
                        list_level: None,
                        attrs: None,
                });
                event_generated_by_special_rule = true;
            } else if HR_RE.is_match(line_content) {
                 if HR_RE.find(line_content.trim()).map_or(false, |m| m.as_str() == line_content.trim()){
                    block_events.push(BlockEvent { 
                        block_type: BlockType::HorizontalRuleBlock, 
                        raw_content_fallback: None, 
                        structured_content: None, 
                        language: None, 
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                    event_generated_by_special_rule = true;
                 } else { // Not a pure HR line, treat as BaseBlock
                    let raw_text = line_content.to_string();
                    let fragments = parse_inline_markdown_to_fragments(&raw_text);
                    block_events.push(BlockEvent {
                        block_type: BlockType::BaseBlock,
                        raw_content_fallback: Some(raw_text.clone()),
                        structured_content: Some(fragments),
                        language: None,
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                    event_generated_by_special_rule = true; // still true, as it was processed
                 }
            } else if let Some(captures) = LIST_ITEM_RE.captures(line_content) {
                let raw_text = captures.name("content").unwrap().as_str().to_string();
                let indent_level = (captures.name("indent").unwrap().as_str().len() / 2) as u8;
                let marker = captures.name("marker").map(|m| m.as_str()).unwrap_or("");
                let list_type = if marker.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    Some("ordered".to_string())
                } else {
                    Some("bullet".to_string())
                };
                let fragments = parse_inline_markdown_to_fragments(&raw_text);
                block_events.push(BlockEvent { 
                    block_type: BlockType::ListItemBlock, 
                    raw_content_fallback: Some(raw_text.clone()), 
                    structured_content: Some(fragments), 
                    language: None, 
                    level: Some(indent_level), // Using level for indent here
                    list_type,
                    list_level: Some(indent_level),
                    attrs: None,
                });
                event_generated_by_special_rule = true;
            } else if let Some(captures) = QUOTE_RE.captures(line_content) {
                let raw_text = captures.name("content").unwrap().as_str().to_string();
                let fragments = parse_inline_markdown_to_fragments(&raw_text);
                block_events.push(BlockEvent { 
                    block_type: BlockType::QuoteBlock, 
                    raw_content_fallback: Some(raw_text.clone()), 
                    structured_content: Some(fragments), 
                    language: None, 
                    level: None,
                    list_type: None,
                    list_level: None,
                    attrs: None,
                });
                event_generated_by_special_rule = true;
            }
        }

        if !event_generated_by_special_rule {
            if !line_content.trim().is_empty() {
                let raw_text = line_content.to_string();
                let fragments = parse_inline_markdown_to_fragments(&raw_text);
                block_events.push(BlockEvent {
                    block_type: BlockType::BaseBlock,
                    raw_content_fallback: Some(raw_text.clone()),
                    structured_content: Some(fragments),
                    language: None,
                    level: None,
                    list_type: None,
                    list_level: None,
                    attrs: None,
                });
            }
        }
    }

    if in_code_block_mode && !current_code_content.trim().is_empty() {
        block_events.push(BlockEvent {
            block_type: BlockType::CodeBlock,
            raw_content_fallback: Some(current_code_content.trim_end().to_string()),
            structured_content: None,
            language: current_code_language_for_mode,
            level: None,
            list_type: None,
            list_level: None,
            attrs: None,
        });
    }

    if let Some(comment) = current_html_comment {
        block_events.push(BlockEvent {
            block_type: BlockType::HtmlComment,
            raw_content_fallback: Some(comment),
            structured_content: None,
            language: None,
            level: None,
            list_type: None,
            list_level: None,
            attrs: None,
        });
    }

    block_events
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    // 设置 panic hook 以便在 WASM panic 时将错误输出到 JS console
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    log("parser-wasm: Rust module successfully started via main_js().");
    Ok(())
}

#[allow(unused)]
fn console_log(message: &str) {
    log(message);
}

#[cfg(test)]
mod tests {
    use super::*;

    // 基础块解析测试：验证 legacy 行级解析不会 panic，且能解析出一个 HeadingBlock
    #[test]
    fn legacy_blocks_parse_simple_heading() {
        let input = "# Title";
        let events = legacy_parse_lines_to_block_events(input);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].block_type, BlockType::HeadingBlock);
        assert_eq!(events[0].raw_content_fallback.as_deref(), Some("Title"));
    }

    #[test]
    fn legacy_blocks_preserve_multiline_html_comment() {
        let input = "Paragraph\n<!-- note\nwith blank lines\n-->";
        let events = legacy_parse_lines_to_block_events(input);

        assert_eq!(events.len(), 2);
        assert_eq!(events[1].block_type, BlockType::HtmlComment);
        assert_eq!(
            events[1].raw_content_fallback.as_deref(),
            Some("<!-- note\nwith blank lines\n-->")
        );
    }

    // 列表解析测试：验证 legacy 解析能区分有序/无序列表，并输出 list_type/list_level
    #[test]
    fn legacy_blocks_parse_lists_set_list_type_and_level() {
        let input = "1. Ordered\n2) Ordered2\n- Bullet\n  - IndentBullet";
        let events = legacy_parse_lines_to_block_events(input);
        assert_eq!(events.len(), 4);

        assert_eq!(events[0].block_type, BlockType::ListItemBlock);
        assert_eq!(events[0].list_type.as_deref(), Some("ordered"));
        assert_eq!(events[0].list_level, Some(0));

        assert_eq!(events[1].block_type, BlockType::ListItemBlock);
        assert_eq!(events[1].list_type.as_deref(), Some("ordered"));
        assert_eq!(events[1].list_level, Some(0));

        assert_eq!(events[2].block_type, BlockType::ListItemBlock);
        assert_eq!(events[2].list_type.as_deref(), Some("bullet"));
        assert_eq!(events[2].list_level, Some(0));

        assert_eq!(events[3].block_type, BlockType::ListItemBlock);
        assert_eq!(events[3].list_type.as_deref(), Some("bullet"));
        assert_eq!(events[3].list_level, Some(1));
    }

    // 内联解析测试骨架：验证粗体 + 斜体 + 代码不会产生空片段
    #[test]
    fn inline_parse_basic_marks() {
        let input = "**bold** *italic* `code`";
        let fragments = crate::inline::parse_inline_markdown_to_fragments(input);
        assert!(!fragments.is_empty());
        // 这里不做更细粒度断言，只验证不会产生空的结果，后续可以再扩充
    }
}
