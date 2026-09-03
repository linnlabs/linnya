use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use pulldown_cmark::{
    Event as PulldownEvent, Options as PulldownOptions, Parser as PulldownParser, Tag as PulldownTag,
};
use serde_json::Value as JsonValue;

use crate::model::{ContentFragment, Mark};

// 内联元素 ID 生成器，用于生成唯一的 inlineLatex 等节点 id
static INLINE_ELEMENT_ID_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn generate_inline_element_id(prefix: &str) -> String {
    let count = INLINE_ELEMENT_ID_COUNTER.fetch_add(1, AtomicOrdering::SeqCst);
    format!("{}-{}", prefix, count)
}

/// 使用 pulldown-cmark 将一段 markdown 文本解析为内联片段序列。
/// 这里只处理行内级元素（粗体、斜体、链接、删除线、代码、行内公式等），
/// 块级结构（表格、标题、列表等）由外层块解析器负责。
pub(crate) fn parse_inline_markdown_to_fragments(markdown_text: &str) -> Vec<ContentFragment> {
    let mut fragments = Vec::new();
    let mut current_marks: Vec<Mark> = Vec::new();

    let mut options = PulldownOptions::empty();
    options.insert(PulldownOptions::ENABLE_STRIKETHROUGH);
    options.insert(PulldownOptions::ENABLE_TASKLISTS); // Task lists are also inline
    options.insert(PulldownOptions::ENABLE_MATH); // RESTORED: Confirmed ENABLE_MATH is correct for 0.13.0

    let parser = PulldownParser::new_ext(markdown_text, options);

    for event in parser {
        match event {
            PulldownEvent::Text(text_cow) => {
                if !text_cow.is_empty() {
                    fragments.push(ContentFragment {
                        r#type: "text".to_string(),
                        text: Some(text_cow.into_string()),
                        marks: current_marks.clone(),
                        attrs: None,
                    });
                }
            }
            PulldownEvent::Start(tag) => match tag {
                PulldownTag::Emphasis => current_marks.push(Mark {
                    r#type: "italic".to_string(),
                    attrs: None,
                }),
                PulldownTag::Strong => current_marks.push(Mark {
                    r#type: "bold".to_string(),
                    attrs: None,
                }),
                PulldownTag::Strikethrough => current_marks.push(Mark {
                    r#type: "strike".to_string(),
                    attrs: None,
                }),
                PulldownTag::Link { dest_url, title, .. } => {
                    let mut attrs_map = HashMap::new();
                    attrs_map.insert("href".to_string(), JsonValue::String(dest_url.into_string()));
                    if !title.is_empty() {
                        attrs_map.insert("title".to_string(), JsonValue::String(title.into_string()));
                    }
                    current_marks.push(Mark {
                        r#type: "link".to_string(),
                        attrs: Some(JsonValue::Object(attrs_map.into_iter().collect())),
                    });
                }
                _ => {} // 其他块级 Tag 在块解析中处理
            },
            PulldownEvent::End(tag) => match tag {
                pulldown_cmark::TagEnd::Emphasis => {
                    if let Some(pos) = current_marks.iter().rposition(|m| m.r#type == "italic") {
                        current_marks.remove(pos);
                    }
                }
                pulldown_cmark::TagEnd::Strong => {
                    if let Some(pos) = current_marks.iter().rposition(|m| m.r#type == "bold") {
                        current_marks.remove(pos);
                    }
                }
                pulldown_cmark::TagEnd::Strikethrough => {
                    if let Some(pos) = current_marks.iter().rposition(|m| m.r#type == "strike") {
                        current_marks.remove(pos);
                    }
                }
                pulldown_cmark::TagEnd::Link => {
                    if let Some(pos) = current_marks.iter().rposition(|m| m.r#type == "link") {
                        current_marks.remove(pos);
                    }
                }
                _ => {}
            },
            PulldownEvent::Code(inline_code) => {
                fragments.push(ContentFragment {
                    r#type: "text".to_string(), // 行内代码用 text + code mark 表示
                    text: Some(inline_code.into_string()),
                    marks: vec![Mark {
                        r#type: "code".to_string(),
                        attrs: None,
                    }],
                    attrs: None,
                });
            }

            // 处理 pulldown-cmark 0.13.0 新增的 Math / InlineHtml 事件
            PulldownEvent::InlineMath(text) => {
                let latex_source = text.into_string();
                if !latex_source.is_empty() {
                    let mut attrs_map = HashMap::new();
                    attrs_map.insert("latexSource".to_string(), JsonValue::String(latex_source.clone()));
                    attrs_map.insert(
                        "id".to_string(),
                        JsonValue::String(generate_inline_element_id("inline-latex")),
                    );
                    let new_fragment = ContentFragment {
                        r#type: "inlineLatex".to_string(),
                        text: None,
                        marks: Vec::new(),
                        attrs: Some(JsonValue::Object(attrs_map.into_iter().collect())),
                    };
                    fragments.push(new_fragment);
                }
            }
            PulldownEvent::DisplayMath(text) => {
                // 这里属于块级公式，但在内联解析过程中仍然以 inlineLatex 形式返回，
                // 上层如果有需要可以特殊处理。
                let latex_source = text.into_string();
                if !latex_source.is_empty() {
                    let mut attrs_map = HashMap::new();
                    attrs_map.insert("latexSource".to_string(), JsonValue::String(latex_source.clone()));
                    attrs_map.insert(
                        "id".to_string(),
                        JsonValue::String(generate_inline_element_id("display-math-in-inline")),
                    );
                    let new_fragment = ContentFragment {
                        r#type: "inlineLatex".to_string(),
                        text: None,
                        marks: Vec::new(),
                        attrs: Some(JsonValue::Object(attrs_map.into_iter().collect())),
                    };
                    fragments.push(new_fragment);
                }
            }
            PulldownEvent::InlineHtml(html_content) => {
                if !html_content.is_empty() {
                    let html_str = html_content.into_string();
                    let lower_html = html_str.trim().to_lowercase();
                    // 将常见的换行标签解析为 HardBreak
                    if lower_html.starts_with("<br") && lower_html.ends_with(">") {
                        fragments.push(ContentFragment {
                            r#type: "hardBreak".to_string(),
                            text: None,
                            marks: current_marks.clone(),
                            attrs: None,
                        });
                    } else {
                        fragments.push(ContentFragment {
                            r#type: "text".to_string(), // 暂时按纯文本处理
                            text: Some(html_str),
                            marks: current_marks.clone(),
                            attrs: None,
                        });
                    }
                }
            }
            PulldownEvent::SoftBreak => {
                fragments.push(ContentFragment {
                    r#type: "text".to_string(),
                    text: Some(" ".to_string()),
                    marks: current_marks.clone(),
                    attrs: None,
                });
            }
            PulldownEvent::HardBreak => {
                fragments.push(ContentFragment {
                    r#type: "hardBreak".to_string(),
                    text: None,
                    marks: current_marks.clone(),
                    attrs: None,
                });
            }
            PulldownEvent::TaskListMarker(checked) => {
                fragments.push(ContentFragment {
                    r#type: "text".to_string(),
                    text: Some(if checked {
                        "[x] ".to_string()
                    } else {
                        "[ ] ".to_string()
                    }),
                    marks: current_marks.clone(),
                    attrs: None,
                });
            }
            PulldownEvent::Html(html_content) => {
                // 原始 HTML 暂时也按文本处理
                if !html_content.is_empty() {
                    fragments.push(ContentFragment {
                        r#type: "text".to_string(),
                        text: Some(html_content.into_string()),
                        marks: current_marks.clone(),
                        attrs: None,
                    });
                }
            }
            PulldownEvent::FootnoteReference(name) => {
                // 暂时渲染成 `[^name]` 文本，后续如需更丰富的脚注模型可以再扩展
                fragments.push(ContentFragment {
                    r#type: "text".to_string(),
                    text: Some(format!("[^{}]", name.into_string())),
                    marks: current_marks.clone(),
                    attrs: None,
                });
            }
            PulldownEvent::Rule => {
                // 水平线属于块级元素，这里不应该出现，如果出现就忽略。
            }
        }
    }

    // 过滤掉无意义的空片段，但保留 inlineLatex
    fragments.retain(|f| {
        f.r#type == "inlineLatex"
            || f.r#type == "hardBreak"
            || f.text.as_ref().map_or(false, |t| !t.is_empty())
            || (!f.marks.is_empty() && f.text.as_ref().is_some())
    });

    fragments
}

