use crate::inline::parse_inline_markdown_to_fragments;
use crate::model::{BlockEvent, BlockType};
use crate::table::{
    is_alignment_line, looks_like_table_body_row, looks_like_table_header_line,
    parse_table_markdown_to_model,
};
use crate::{
    CODE_BLOCK_END_RE, CODE_BLOCK_START_RE, HEADING_RE, HR_RE, LATEX_START_BRACKET_RE,
    LATEX_START_DOLLAR_RE, LATEX_START_EQUATION_RE, LIST_ITEM_RE, QUOTE_RE,
    HTML_COMMENT_START_RE,
    parse_language_from_line,
};

mod state;

use state::{BlockState, DelimMatcher, LatexType};

/// 纯 Rust 的流式解析核心结构。
/// 对外由 wasm 层的 `StreamingParser` 包一层，统一做 JsValue 序列化。
pub(crate) struct StreamingParserCore {
    pub(crate) buffer: String,
    current_block_state: BlockState,
}

impl StreamingParserCore {
    fn html_comment_event(raw: &str) -> BlockEvent {
        BlockEvent {
            block_type: BlockType::HtmlComment,
            raw_content_fallback: Some(raw.trim().to_string()),
            structured_content: None,
            language: None,
            level: None,
            list_type: None,
            list_level: None,
            attrs: None,
        }
    }

    /// 返回 CommonMark type 2 HTML block 的完整行长度（不含换行符）。
    /// `-->` 后同一行的内容仍属于 HTML block，必须一并保留。
    fn complete_html_comment_line_len(input: &str) -> Option<usize> {
        let closing_end = input.find("-->")? + 3;
        input[closing_end..]
            .find('\n')
            .map(|relative| closing_end + relative)
    }

    pub(crate) fn new() -> Self {
        StreamingParserCore {
            buffer: String::new(),
            current_block_state: BlockState::Idle,
        }
    }

    /// 处理一个文本 chunk，返回新增产生的 BlockEvent 列表。
    pub(crate) fn process_chunk(&mut self, chunk: &str) -> Vec<BlockEvent> {
        self.buffer.push_str(chunk);
        self.extract_blocks_from_buffer()
    }

    /// 结束解析，处理缓冲区剩余内容，返回最终产生的 BlockEvent 列表。
    pub(crate) fn finalize_parsing(&mut self) -> Vec<BlockEvent> {
        let mut events = Vec::new();

        match &self.current_block_state {
            BlockState::InCodeBlock(lang, accumulated_code) => {
                if !self.buffer.is_empty() || !accumulated_code.is_empty() {
                    let lang_from_fence = lang.clone();
                    let code_block_internal_content = accumulated_code.trim_end().to_string();

                    let mut event_language = lang_from_fence;
                    let mut event_code_content = code_block_internal_content;

                    if event_language.is_none() && !event_code_content.is_empty() {
                        if let Some(newline_pos) = event_code_content.find('\n') {
                            let first_line = &event_code_content[..newline_pos];
                            if let Some(detected_lang) = parse_language_from_line(first_line) {
                                event_language = Some(detected_lang);
                                event_code_content =
                                    event_code_content[newline_pos + 1..].trim_start().to_string();
                            }
                        } else if let Some(detected_lang) = parse_language_from_line(&event_code_content)
                        {
                            event_language = Some(detected_lang);
                            event_code_content = String::new();
                        }
                    }

                    let final_trimmed_code = event_code_content.trim();
                    if !final_trimmed_code.is_empty() || event_language.is_some() {
                        events.push(BlockEvent {
                            block_type: BlockType::CodeBlock,
                            raw_content_fallback: Some(final_trimmed_code.to_string()),
                            structured_content: None,
                            language: event_language,
                            level: None,
                            list_type: None,
                            list_level: None,
                            attrs: None,
                        });
                    }
                }
            }
            BlockState::InQuoteBlock(current_quote_content_raw) => {
                let final_raw_content =
                    format!("{}{}", current_quote_content_raw, self.buffer).trim().to_string();
                if !final_raw_content.is_empty() {
                    let fragments = parse_inline_markdown_to_fragments(&final_raw_content);
                    events.push(BlockEvent {
                        block_type: BlockType::QuoteBlock,
                        raw_content_fallback: Some(final_raw_content.clone()),
                        structured_content: Some(fragments),
                        language: None,
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                } else if !current_quote_content_raw.trim().is_empty() {
                    let trimmed_quote_content = current_quote_content_raw.trim().to_string();
                    if !trimmed_quote_content.is_empty() {
                        let fragments = parse_inline_markdown_to_fragments(&trimmed_quote_content);
                        events.push(BlockEvent {
                            block_type: BlockType::QuoteBlock,
                            raw_content_fallback: Some(trimmed_quote_content.clone()),
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
            BlockState::InHeadingBlock(level, content_raw) => {
                let final_raw_content =
                    format!("{}{}", content_raw, self.buffer).trim().to_string();
                if !final_raw_content.is_empty() {
                    let fragments = parse_inline_markdown_to_fragments(&final_raw_content);
                    events.push(BlockEvent {
                        block_type: BlockType::HeadingBlock,
                        raw_content_fallback: Some(final_raw_content.clone()),
                        structured_content: Some(fragments),
                        language: None,
                        level: Some(*level),
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                }
            }
            BlockState::InHtmlComment(accumulated_comment) => {
                let final_comment = format!("{}{}", accumulated_comment, self.buffer);
                if !final_comment.trim().is_empty() {
                    events.push(Self::html_comment_event(&final_comment));
                }
            }
            BlockState::InLatexBlock {
                latex_type: _,
                matcher: _,
                accumulated_content,
            } => {
                let final_content =
                    format!("{}{}", accumulated_content, self.buffer).trim().to_string();
                if !final_content.is_empty() {
                    events.push(BlockEvent {
                        block_type: BlockType::LatexBlock,
                        raw_content_fallback: Some(final_content),
                        structured_content: None,
                        language: None,
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                }
            }
            BlockState::InTableBlock {
                header_line,
                align_line,
                body_lines,
            } => {
                // finalize 时，如果仍处于表格状态，则认为缓冲区中的剩余内容也属于最后一行
                let mut table_text = String::new();
                table_text.push_str(header_line);
                table_text.push('\n');
                table_text.push_str(align_line);
                table_text.push('\n');
                for line in body_lines {
                    table_text.push_str(line);
                    table_text.push('\n');
                }
                if !self.buffer.is_empty() {
                    table_text.push_str(&self.buffer);
                    if !self.buffer.ends_with('\n') {
                        table_text.push('\n');
                    }
                }

                if let Some(table_event) = parse_table_markdown_to_model(&table_text) {
                    events.push(table_event);
                } else if !table_text.trim().is_empty() {
                    // 如果表格解析失败，退化为普通 BaseBlock，避免丢失内容
                    let fragments = parse_inline_markdown_to_fragments(table_text.trim());
                    events.push(BlockEvent {
                        block_type: BlockType::BaseBlock,
                        raw_content_fallback: Some(table_text.trim().to_string()),
                        structured_content: Some(fragments),
                        language: None,
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                }
            }
            BlockState::Idle => {
                if !self.buffer.trim().is_empty() {
                    // 注意：不要用 trim()，它会移除段落首部缩进，从而破坏列表缩进层级。
                    // 这里只裁掉尾部空白，保留首部缩进语义。
                    let buffer_trimmed_content = self.buffer.trim_end().to_string();
                    let (block_events_from_buffer, _) = self.parse_paragraph_content(&buffer_trimmed_content);

                    if !block_events_from_buffer.is_empty() {
                        events.extend(block_events_from_buffer);
                    } else {
                        let fragments =
                            parse_inline_markdown_to_fragments(&buffer_trimmed_content);
                        events.push(BlockEvent {
                            block_type: BlockType::BaseBlock,
                            raw_content_fallback: Some(buffer_trimmed_content.clone()),
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
        }

        self.buffer.clear();
        self.current_block_state = BlockState::Idle;

        events.retain(|event| {
            event.block_type == BlockType::HorizontalRuleBlock
                || event
                    .raw_content_fallback
                    .as_ref()
                    .map_or(false, |s| !s.trim().is_empty())
                || event
                    .structured_content
                    .as_ref()
                    .map_or(false, |sc| !sc.is_empty())
        });

        events
    }

    fn flush_base_paragraph(events: &mut Vec<BlockEvent>, paragraph: &mut String) {
        let raw_text = paragraph.trim_end().to_string();
        paragraph.clear();

        if raw_text.trim().is_empty() {
            return;
        }

        let fragments = parse_inline_markdown_to_fragments(&raw_text);
        events.push(BlockEvent {
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

    /// 从当前 buffer 中提取尽可能多的完整块。
    fn extract_blocks_from_buffer(&mut self) -> Vec<BlockEvent> {
        let mut events = Vec::new();
        let mut consumed_offset = 0;

        loop {
            if consumed_offset >= self.buffer.len() {
                break;
            }

            let current_slice = &self.buffer[consumed_offset..];
            if current_slice.is_empty() {
                break;
            }

            match self.current_block_state {
                BlockState::Idle => {
                    if current_slice.starts_with('\n') {
                        consumed_offset += 1;
                        continue;
                    }
                    
                    // 0. 首先检查代码块、LaTeX 等专用块
                    // 代码块开始
                    let first_line = current_slice.lines().next().unwrap_or("");
                    if let Some(m) = CODE_BLOCK_START_RE.find(first_line) {
                        if m.start() == 0 && m.end() == first_line.len() {
                            let fence_content = &first_line[m.start()..m.end()];
                            let lang_captures =
                                CODE_BLOCK_START_RE.captures(fence_content).unwrap();
                            let lang_from_fence_capture =
                                lang_captures.name("lang").and_then(|m_lang| {
                                    if m_lang.as_str().is_empty() {
                                        None
                                    } else {
                                        Some(m_lang.as_str().to_string())
                                    }
                                });

                            consumed_offset += first_line.len();
                            if consumed_offset < self.buffer.len()
                                && self.buffer.as_bytes()[consumed_offset] == b'\n'
                            {
                                consumed_offset += 1;
                            }
                            self.current_block_state = BlockState::InCodeBlock(
                                lang_from_fence_capture,
                                String::new(),
                            );
                            continue;
                        }
                    }

                    // CommonMark type 2 HTML block 可以中断段落，且允许最多三个前导空格。
                    if let Some(comment_start) = HTML_COMMENT_START_RE.find(current_slice) {
                        if comment_start.start() > 0 {
                            let prefix = current_slice[..comment_start.start()].trim_end();
                            let (mut prefix_events, _) = self.parse_paragraph_content(prefix);
                            events.append(&mut prefix_events);
                            consumed_offset += comment_start.start();
                            continue;
                        }

                        if let Some(comment_line_len) =
                            Self::complete_html_comment_line_len(current_slice)
                        {
                            events.push(Self::html_comment_event(
                                &current_slice[..comment_line_len],
                            ));
                            consumed_offset += comment_line_len + 1;
                        } else {
                            self.current_block_state =
                                BlockState::InHtmlComment(current_slice.to_string());
                            consumed_offset += current_slice.len();
                        }
                        continue;
                    }

                    // 先检查水平分割线
                    let hr_line = current_slice.lines().next().unwrap_or("");
                    if HR_RE.is_match(hr_line) {
                        let trimmed_hr_line = hr_line.trim();
                        if HR_RE
                            .find(trimmed_hr_line)
                            .map_or(false, |m| m.as_str() == trimmed_hr_line)
                        {
                            if !trimmed_hr_line.starts_with('*') {
                                events.push(BlockEvent {
                                    block_type: BlockType::HorizontalRuleBlock,
                                    raw_content_fallback: None,
                                    structured_content: None,
                                    language: None,
                                    level: None,
                                    list_type: None,
                                    list_level: None,
                                    attrs: None,
                                });

                                let line_len_to_consume = hr_line.len();
                                consumed_offset += line_len_to_consume;
                                if consumed_offset < self.buffer.len()
                                    && self.buffer.as_bytes()[consumed_offset] == b'\n'
                                {
                                    consumed_offset += 1;
                                }
                                continue;
                            }
                        }
                    }

                    // LaTeX 块开始：$$
                    if let Some(m) = LATEX_START_DOLLAR_RE.find(current_slice) {
                        if m.start() == 0 {
                            consumed_offset += m.end();
                            self.current_block_state = BlockState::InLatexBlock {
                                latex_type: LatexType::Dollar,
                                matcher: DelimMatcher::new(b"$$"),
                                accumulated_content: String::new(),
                            };
                            continue;
                        }
                    }

                    // LaTeX 块开始：\[ \]
                    if let Some(m) = LATEX_START_BRACKET_RE.find(current_slice) {
                        if m.start() == 0 {
                            consumed_offset += m.end();
                            self.current_block_state = BlockState::InLatexBlock {
                                latex_type: LatexType::Bracket,
                                matcher: DelimMatcher::new(b"\\]"),
                                accumulated_content: String::new(),
                            };
                            continue;
                        }
                    }

                    // LaTeX 块开始：\begin{equation}
                    if let Some(m) = LATEX_START_EQUATION_RE.find(current_slice) {
                        if m.start() == 0 {
                            consumed_offset += m.end();
                            self.current_block_state = BlockState::InLatexBlock {
                                latex_type: LatexType::Equation,
                                matcher: DelimMatcher::new(b"\\end{equation}"),
                                accumulated_content: String::new(),
                            };
                            continue;
                        }
                    }

                    // 引用块开始
                    if let Some(m) = QUOTE_RE.find(current_slice) {
                        if m.start() == 0 {
                            let line_content = m.as_str();
                            let quote_captures = QUOTE_RE.captures(line_content).unwrap();
                            let quote_text =
                                quote_captures.name("content").unwrap().as_str().to_string();

                            self.current_block_state =
                                BlockState::InQuoteBlock(quote_text.clone());
                            consumed_offset += m.end();
                            if consumed_offset < self.buffer.len()
                                && self.buffer.as_bytes()[consumed_offset] == b'\n'
                            {
                                if !quote_text.trim().is_empty() {
                                    let fragments =
                                        parse_inline_markdown_to_fragments(&quote_text);
                                    events.push(BlockEvent {
                                        block_type: BlockType::QuoteBlock,
                                        raw_content_fallback: Some(quote_text.clone()),
                                        structured_content: Some(fragments),
                                        language: None,
                                        level: None,
                                        list_type: None,
                                        list_level: None,
                                        attrs: None,
                                    });
                                }
                                consumed_offset += 1;
                                self.current_block_state = BlockState::Idle;
                            }
                            continue;
                        }
                    }

                    // 1. 优先检查是否是表格开头（header 行 + 对齐行）
                    if let Some(first_newline) = current_slice.find('\n') {
                        let first_line = &current_slice[..first_newline];
                        if looks_like_table_header_line(first_line) {
                            let rest = &current_slice[first_newline + 1..];
                            if let Some(second_newline) = rest.find('\n') {
                                let second_line = &rest[..second_newline];
                                if is_alignment_line(second_line) {
                                    // 识别为表格头部：进入 InTableBlock 状态
                                    self.current_block_state = BlockState::InTableBlock {
                                        header_line: first_line.to_string(),
                                        align_line: second_line.to_string(),
                                        body_lines: Vec::new(),
                                    };
                                    consumed_offset += first_newline + 1 + second_newline + 1;
                                    continue;
                                }
                            } else {
                                // 只有 header 行完整，等待下一个 chunk 补齐对齐行
                            }
                        }
                    }

                    // 2. 检查段落（\n\n 分隔）
                    if let Some(para_end_idx) = current_slice.find("\n\n") {
                        let paragraph_slice = &current_slice[..para_end_idx];
                        // 注意：不要 trim()，避免移除段落首行的缩进（列表缩进会因此丢失）。
                        let (mut block_events_from_para, _) =
                            self.parse_paragraph_content(paragraph_slice.trim_end());

                        if !block_events_from_para.is_empty() {
                            events.append(&mut block_events_from_para);
                        } else if !paragraph_slice.trim().is_empty() {
                            let raw_para_content = paragraph_slice.trim().to_string();
                            let fragments =
                                parse_inline_markdown_to_fragments(&raw_para_content);
                            events.push(BlockEvent {
                                block_type: BlockType::BaseBlock,
                                raw_content_fallback: Some(raw_para_content.clone()),
                                structured_content: Some(fragments),
                                language: None,
                                level: None,
                                list_type: None,
                                list_level: None,
                                attrs: None,
                            });
                        }
                        consumed_offset += para_end_idx + 2;
                        continue;
                    }

                    // 3. 单行块
                    if let Some(newline_pos) = current_slice.find('\n') {
                        let line_to_check = &current_slice[..newline_pos];

                        // 如果这一行“看起来像”表格表头，则不要在这里立刻消费。
                        // 否则会把潜在的表头行当作普通段落行解析掉，导致后续
                        // 再收到对齐行时，无法拼出完整的表格结构。
                        //
                        // 这里选择“保守等待”：让表头行保留在 buffer 中，直到
                        // 下一次有新的 chunk 到达，再由前面的
                        // looks_like_table_header_line + is_alignment_line 逻辑
                        // 一并识别为表格开始。
                        if looks_like_table_header_line(line_to_check) {
                            break;
                        }

                        // 注意：不要 trim()，避免移除行首缩进（列表缩进会因此丢失）。
                        let (mut block_events_from_line, _) =
                            self.parse_paragraph_content(line_to_check.trim_end());

                        let is_plain_base_line =
                            block_events_from_line.len() == 1
                                && block_events_from_line[0].block_type == BlockType::BaseBlock;

                        if !block_events_from_line.is_empty() && !is_plain_base_line {
                            events.append(&mut block_events_from_line);
                            consumed_offset += newline_pos + 1;
                            continue;
                        }
                    }

                    // 4. 列表项
                    if let Some(m) = LIST_ITEM_RE.find(current_slice) {
                        if m.start() == 0 {
                            let list_captures = LIST_ITEM_RE.captures(m.as_str()).unwrap();
                            let indent_str = list_captures.name("indent").unwrap().as_str();
                            let marker = list_captures.name("marker").map(|m| m.as_str()).unwrap_or("");
                            let list_content =
                                list_captures.name("content").unwrap().as_str().to_string();
                            let indent_level = (indent_str.len() / 2) as u8;
                            let list_type = if marker.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                                Some("ordered".to_string())
                            } else {
                                Some("bullet".to_string())
                            };

                            if let Some(nl_pos) = current_slice[m.start()..].find('\n') {
                                let complete_item_content =
                                    &current_slice[m.start()..m.start() + nl_pos];
                                let complete_captures =
                                    LIST_ITEM_RE.captures(complete_item_content).unwrap();
                                let complete_content = complete_captures
                                    .name("content")
                                    .unwrap()
                                    .as_str()
                                    .to_string();

                                if !complete_content.trim().is_empty() {
                                    let fragments =
                                        parse_inline_markdown_to_fragments(&complete_content);
                                    events.push(BlockEvent {
                                        block_type: BlockType::ListItemBlock,
                                        raw_content_fallback: Some(complete_content.clone()),
                                        structured_content: Some(fragments),
                                        language: None,
                                        level: Some(indent_level),
                                        list_type: list_type.clone(),
                                        list_level: Some(indent_level),
                                        attrs: None,
                                    });
                                }
                                consumed_offset += nl_pos + 1;
                                continue;
                            }
                        }
                    }

                    // 5. 标题
                    if let Some(newline_pos) = current_slice.find('\n') {
                        let line_to_check = &current_slice[..newline_pos];
                        if let Some(h_match) = HEADING_RE.find(line_to_check) {
                            if h_match.start() == 0 {
                                let heading_captures =
                                    HEADING_RE.captures(h_match.as_str()).unwrap();
                                let level = heading_captures
                                    .name("level")
                                    .unwrap()
                                    .as_str()
                                    .len() as u8;
                                let heading_content = heading_captures
                                    .name("content")
                                    .unwrap()
                                    .as_str()
                                    .trim()
                                    .to_string();

                                if !heading_content.trim().is_empty() {
                                    let fragments =
                                        parse_inline_markdown_to_fragments(&heading_content);
                                    events.push(BlockEvent {
                                        block_type: BlockType::HeadingBlock,
                                        raw_content_fallback: Some(heading_content.clone()),
                                        structured_content: Some(fragments),
                                        language: None,
                                        level: Some(level),
                                        list_type: None,
                                        list_level: None,
                                        attrs: None,
                                    });
                                }
                                consumed_offset += newline_pos + 1;
                                continue;
                            }
                        }
                    }

                    // 无更多可解析内容，等待更多数据或 finalize
                    break;
                }
                BlockState::InCodeBlock(ref lang, ref mut accumulated_code) => {
                    let current_line = current_slice.lines().next().unwrap_or("");
                    if let Some(m) = CODE_BLOCK_END_RE.find(current_line) {
                        if m.start() != 0 || m.end() != current_line.len() {
                            // 不是完整的 closing fence，按普通代码行继续处理
                        } else {
                            let lang_from_fence_state = lang.clone();
                            let full_code_content_in_block =
                                accumulated_code.trim_end().to_string();
                            let mut event_language = lang_from_fence_state;
                            let mut event_code_content = full_code_content_in_block;

                            if event_language.is_none() && !event_code_content.is_empty() {
                                if let Some(newline_pos) = event_code_content.find('\n') {
                                    let first_line = &event_code_content[..newline_pos];
                                    if let Some(detected_lang) =
                                        parse_language_from_line(first_line)
                                    {
                                        event_language = Some(detected_lang);
                                        event_code_content = event_code_content
                                            [newline_pos + 1..]
                                            .trim_start()
                                            .to_string();
                                    }
                                } else if let Some(detected_lang) =
                                    parse_language_from_line(&event_code_content)
                                {
                                    event_language = Some(detected_lang);
                                    event_code_content = String::new();
                                }
                            }

                            let final_trimmed_code = event_code_content.trim();
                            if !final_trimmed_code.is_empty() || event_language.is_some() {
                                events.push(BlockEvent {
                                    block_type: BlockType::CodeBlock,
                                    raw_content_fallback: Some(final_trimmed_code.to_string()),
                                    structured_content: None,
                                    language: event_language,
                                    level: None,
                                    list_type: None,
                                    list_level: None,
                                    attrs: None,
                                });
                            }

                            consumed_offset += current_line.len();
                            if consumed_offset < self.buffer.len()
                                && self.buffer.as_bytes()[consumed_offset] == b'\n'
                            {
                                consumed_offset += 1;
                            }
                            self.current_block_state = BlockState::Idle;
                            continue;
                        }
                    }

                    if let Some(newline_pos) = current_slice.find('\n') {
                        let code_line = &current_slice[..newline_pos];
                        accumulated_code.push_str(code_line);
                        accumulated_code.push('\n');
                        consumed_offset += newline_pos + 1;
                    } else {
                        accumulated_code.push_str(current_slice);
                        consumed_offset += current_slice.len();
                    }
                    continue;
                }
                BlockState::InQuoteBlock(ref mut current_quote_content) => {
                    if let Some(newline_pos) = current_slice.find('\n') {
                        let line_part = &current_slice[..newline_pos];
                        current_quote_content.push_str(line_part);
                        let final_content = current_quote_content.trim().to_string();
                        if !final_content.is_empty() {
                            let fragments =
                                parse_inline_markdown_to_fragments(&final_content);
                            events.push(BlockEvent {
                                block_type: BlockType::QuoteBlock,
                                raw_content_fallback: Some(final_content.clone()),
                                structured_content: Some(fragments),
                                language: None,
                                level: None,
                                list_type: None,
                                list_level: None,
                                attrs: None,
                            });
                        }
                        consumed_offset += newline_pos + 1;
                        self.current_block_state = BlockState::Idle;
                    } else {
                        current_quote_content.push_str(current_slice);
                        consumed_offset += current_slice.len();
                    }
                    continue;
                }
                BlockState::InHeadingBlock(level, ref mut current_heading_content) => {
                    if let Some(newline_pos) = current_slice.find('\n') {
                        let line_part = &current_slice[..newline_pos];
                        current_heading_content.push_str(line_part);
                        let final_content = current_heading_content.trim().to_string();
                        if !final_content.is_empty() {
                            let fragments =
                                parse_inline_markdown_to_fragments(&final_content);
                            events.push(BlockEvent {
                                block_type: BlockType::HeadingBlock,
                                raw_content_fallback: Some(final_content.clone()),
                                structured_content: Some(fragments),
                                language: None,
                                level: Some(level),
                                list_type: None,
                                list_level: None,
                                attrs: None,
                            });
                        }
                        consumed_offset += newline_pos + 1;
                        self.current_block_state = BlockState::Idle;
                    } else {
                        current_heading_content.push_str(current_slice);
                        consumed_offset += current_slice.len();
                    }
                    continue;
                }
                BlockState::InHtmlComment(ref mut accumulated_comment) => {
                    let previous_len = accumulated_comment.len();
                    let combined = format!("{}{}", accumulated_comment, current_slice);
                    if let Some(comment_line_len) =
                        Self::complete_html_comment_line_len(&combined)
                    {
                        events.push(Self::html_comment_event(&combined[..comment_line_len]));
                        let consumed_from_slice = comment_line_len + 1 - previous_len;
                        consumed_offset += consumed_from_slice;
                        self.current_block_state = BlockState::Idle;
                    } else {
                        accumulated_comment.push_str(current_slice);
                        consumed_offset += current_slice.len();
                    }
                    continue;
                }
                BlockState::InLatexBlock {
                    ref latex_type,
                    ref mut matcher,
                    ref mut accumulated_content,
                } => {
                    let mut consumed_in_slice = 0;
                    let mut found_end_marker = false;

                    for (idx, byte) in current_slice.bytes().enumerate() {
                        if matcher.feed_byte(byte) {
                            if matcher.end_marker_len > 0 {
                                let chars_to_remove = matcher.end_marker_len - 1;
                                if accumulated_content.len() >= chars_to_remove {
                                    let final_len =
                                        accumulated_content.len() - chars_to_remove;
                                    accumulated_content.truncate(final_len);
                                }
                            }

                            let final_event_content =
                                accumulated_content.trim().to_string();
                            if !final_event_content.is_empty() {
                                events.push(BlockEvent {
                                    block_type: BlockType::LatexBlock,
                                    raw_content_fallback: Some(final_event_content.clone()),
                                    structured_content: None,
                                    language: None,
                                    level: None,
                                    list_type: None,
                                    list_level: None,
                                    attrs: None,
                                });
                            }

                            consumed_in_slice = idx + 1;
                            matcher.reset_after_match();
                            self.current_block_state = BlockState::Idle;
                            found_end_marker = true;
                            break;
                        } else {
                            accumulated_content.push(byte as char);
                        }
                    }

                    consumed_offset += if found_end_marker {
                        consumed_in_slice
                    } else {
                        current_slice.len()
                    };

                    if found_end_marker {
                        continue;
                    }
                }
                BlockState::InTableBlock {
                    ref header_line,
                    ref align_line,
                    ref mut body_lines,
                } => {
                    // 在表格状态下，逐行消费：只要行看起来像表格 body 行，就加入 body_lines；
                    // 一旦遇到非表格行，则结束表格，并让该非表格行交由 Idle 重新解析。
                    if let Some(newline_pos) = current_slice.find('\n') {
                        let line = &current_slice[..newline_pos];
                        if looks_like_table_body_row(line) {
                            body_lines.push(line.to_string());
                            consumed_offset += newline_pos + 1;
                        } else {
                            // 构造完整表格 markdown
                            let mut table_text = String::new();
                            table_text.push_str(header_line);
                            table_text.push('\n');
                            table_text.push_str(align_line);
                            table_text.push('\n');
                            for l in body_lines.iter() {
                                table_text.push_str(l);
                                table_text.push('\n');
                            }

                            if let Some(table_event) =
                                parse_table_markdown_to_model(&table_text)
                            {
                                events.push(table_event);
                            } else if !table_text.trim().is_empty() {
                                let fragments =
                                    parse_inline_markdown_to_fragments(table_text.trim());
                                events.push(BlockEvent {
                                    block_type: BlockType::BaseBlock,
                                    raw_content_fallback: Some(
                                        table_text.trim().to_string(),
                                    ),
                                    structured_content: Some(fragments),
                                    language: None,
                                    level: None,
                                    list_type: None,
                                    list_level: None,
                                    attrs: None,
                                });
                            }

                            // 不消费当前非表格行，让 Idle 状态重新解析
                            self.current_block_state = BlockState::Idle;
                        }
                    } else {
                        // 当前 slice 不包含完整一行，等待更多数据
                        break;
                    }
                }
            }
        }

        if consumed_offset > 0 {
            self.buffer = self.buffer[consumed_offset..].to_string();
        }

        events.retain(|event| {
            event.block_type == BlockType::HorizontalRuleBlock
                || event
                    .raw_content_fallback
                    .as_ref()
                    .map_or(false, |s| !s.trim().is_empty())
                || event
                    .structured_content
                    .as_ref()
                    .map_or(false, |sc| !sc.is_empty())
        });

        events
    }

    /// 段落级内容解析辅助方法。
    fn parse_paragraph_content(&self, content: &str) -> (Vec<BlockEvent>, usize) {
        let mut events = Vec::new();
        let mut parsed_len = 0;
        let mut base_paragraph = String::new();

        if content.trim().is_empty() {
            return (events, parsed_len);
        }

        for line in content.lines() {
            parsed_len += line.len() + 1;

            if line.trim().is_empty() {
                Self::flush_base_paragraph(&mut events, &mut base_paragraph);
                continue;
            }

            if let Some(captures) = HEADING_RE.captures(line) {
                Self::flush_base_paragraph(&mut events, &mut base_paragraph);
                let level = captures.name("level").unwrap().as_str().len() as u8;
                let heading_content =
                    captures.name("content").unwrap().as_str().to_string();

                if !heading_content.trim().is_empty() {
                    let fragments = parse_inline_markdown_to_fragments(&heading_content);
                    events.push(BlockEvent {
                        block_type: BlockType::HeadingBlock,
                        raw_content_fallback: Some(heading_content.clone()),
                        structured_content: Some(fragments),
                        language: None,
                        level: Some(level),
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                }
            } else if HR_RE.is_match(line) {
                Self::flush_base_paragraph(&mut events, &mut base_paragraph);
                if HR_RE
                    .find(line.trim())
                    .map_or(false, |m| m.as_str() == line.trim())
                {
                    events.push(BlockEvent {
                        block_type: BlockType::HorizontalRuleBlock,
                        raw_content_fallback: None,
                        structured_content: None,
                        language: None,
                        level: None,
                        list_type: None,
                        list_level: None,
                        attrs: None,
                    });
                } else {
                    let raw_text = line.to_string();
                    let fragments = parse_inline_markdown_to_fragments(&raw_text);
                    events.push(BlockEvent {
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
            } else if let Some(captures) = LIST_ITEM_RE.captures(line) {
                Self::flush_base_paragraph(&mut events, &mut base_paragraph);
                let raw_text = captures.name("content").unwrap().as_str().to_string();
                let indent_level =
                    (captures.name("indent").unwrap().as_str().len() / 2) as u8;
                let marker = captures.name("marker").map(|m| m.as_str()).unwrap_or("");
                let list_type = if marker.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    Some("ordered".to_string())
                } else {
                    Some("bullet".to_string())
                };
                let fragments = parse_inline_markdown_to_fragments(&raw_text);
                events.push(BlockEvent {
                    block_type: BlockType::ListItemBlock,
                    raw_content_fallback: Some(raw_text.clone()),
                    structured_content: Some(fragments),
                    language: None,
                    level: Some(indent_level),
                    list_type,
                    list_level: Some(indent_level),
                    attrs: None,
                });
            } else if let Some(captures) = QUOTE_RE.captures(line) {
                Self::flush_base_paragraph(&mut events, &mut base_paragraph);
                let raw_text = captures.name("content").unwrap().as_str().to_string();
                let fragments = parse_inline_markdown_to_fragments(&raw_text);
                events.push(BlockEvent {
                    block_type: BlockType::QuoteBlock,
                    raw_content_fallback: Some(raw_text.clone()),
                    structured_content: Some(fragments),
                    language: None,
                    level: None,
                    list_type: None,
                    list_level: None,
                    attrs: None,
                });
            } else {
                if !base_paragraph.is_empty() {
                    base_paragraph.push('\n');
                }
                base_paragraph.push_str(line);
            }
        }

        Self::flush_base_paragraph(&mut events, &mut base_paragraph);

        (events, parsed_len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BlockType;
    use crate::table::TableModel;

    /// 帮助函数：一次性把输入字符串喂给 StreamingParserCore，并收集全部事件。
    fn parse_with_core(input: &str) -> Vec<crate::model::BlockEvent> {
        let mut core = StreamingParserCore::new();
        let mut events = core.process_chunk(input);
        let mut tail = core.finalize_parsing();
        events.append(&mut tail);
        events
    }

    #[test]
    fn streaming_core_parses_simple_heading_and_paragraph() {
        let input = "# Title\n\nParagraph";
        let events = parse_with_core(input);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].block_type, BlockType::HeadingBlock);
        assert_eq!(
            events[0].raw_content_fallback.as_deref(),
            Some("Title")
        );
        assert_eq!(events[1].block_type, BlockType::BaseBlock);
        assert_eq!(
            events[1].raw_content_fallback.as_deref(),
            Some("Paragraph")
        );
    }

    #[test]
    fn streaming_core_parses_horizontal_rule() {
        let input = "---\n";
        let events = parse_with_core(input);
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.block_type, BlockType::HorizontalRuleBlock);
        assert!(ev.raw_content_fallback.is_none());
    }

    #[test]
    fn streaming_core_handles_chunked_input_consistently() {
        let full_input = "# Title\n\nParagraph";
        let full_events = parse_with_core(full_input);

        let mut core = StreamingParserCore::new();
        let mut events = core.process_chunk("# Title");
        events.extend(core.process_chunk("\n\nParagraph"));
        events.extend(core.finalize_parsing());

        assert_eq!(events.len(), full_events.len());
        for (e1, e2) in events.iter().zip(full_events.iter()) {
            assert_eq!(e1.block_type, e2.block_type);
            assert_eq!(e1.raw_content_fallback, e2.raw_content_fallback);
            assert_eq!(e1.language, e2.language);
            assert_eq!(e1.level, e2.level);
        }
    }

    #[test]
    fn streaming_core_preserves_comment_that_interrupts_paragraph() {
        let input = "Paragraph\n<!-- note\n\ncontinued -->\nNext";
        let events = parse_with_core(input);

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].block_type, BlockType::BaseBlock);
        assert_eq!(events[1].block_type, BlockType::HtmlComment);
        assert_eq!(
            events[1].raw_content_fallback.as_deref(),
            Some("<!-- note\n\ncontinued -->")
        );
        assert_eq!(events[2].block_type, BlockType::BaseBlock);
    }

    #[test]
    fn streaming_core_preserves_comment_across_chunk_boundaries() {
        let mut core = StreamingParserCore::new();
        let mut events = core.process_chunk("Paragraph\n<!-- linnya-annotation:v1\n{\"id\":");
        events.extend(core.process_chunk("\"annotation-1\"}\n--"));
        events.extend(core.process_chunk(">\nNext"));
        events.extend(core.finalize_parsing());

        assert_eq!(events.len(), 3);
        assert_eq!(events[1].block_type, BlockType::HtmlComment);
        assert_eq!(
            events[1].raw_content_fallback.as_deref(),
            Some("<!-- linnya-annotation:v1\n{\"id\":\"annotation-1\"}\n-->")
        );
    }

    #[test]
    fn streaming_core_parses_lists_with_list_type_and_level() {
        let input = "1. Ordered\n2) Ordered2\n- Bullet\n  - IndentBullet\n";
        let events = parse_with_core(input);
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

    #[test]
    fn streaming_core_keeps_markdown_hard_break_inside_one_base_block() {
        let input = "Line 1  \nLine 2";
        let events = parse_with_core(input);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].block_type, BlockType::BaseBlock);
        let fragments = events[0]
            .structured_content
            .as_ref()
            .expect("base block should have structured content");
        assert_eq!(fragments.len(), 3);
        assert_eq!(fragments[0].r#type, "text");
        assert_eq!(fragments[0].text.as_deref(), Some("Line 1"));
        assert_eq!(fragments[1].r#type, "hardBreak");
        assert_eq!(fragments[2].r#type, "text");
        assert_eq!(fragments[2].text.as_deref(), Some("Line 2"));
    }

    #[test]
    fn streaming_core_parses_fenced_code_block_in_mixed_content() {
        let input = "- one\n\n```ts\nconst x = 1\n```";
        let events = parse_with_core(input);

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].block_type, BlockType::ListItemBlock);
        assert_eq!(events[1].block_type, BlockType::CodeBlock);
        assert_eq!(events[1].language.as_deref(), Some("ts"));
        assert_eq!(events[1].raw_content_fallback.as_deref(), Some("const x = 1"));
    }

    #[test]
    fn streaming_core_parses_simple_table_as_table_block() {
        let input = "\
| col1 | col2 |
| :--- | ---: |
| a    | b    |
";
        let events = parse_with_core(input);
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.block_type, BlockType::TableBlock);
        // attrs 中应能还原 TableModel
        let attrs = ev.attrs.as_ref().expect("table attrs should exist");
        let model: TableModel =
            serde_json::from_value(attrs.clone()).expect("attrs should be valid TableModel");
        assert_eq!(model.header.len(), 2);
        assert_eq!(
            model.header[0].content[0].text.as_deref(),
            Some("col1")
        );
        assert_eq!(
            model.rows.len(),
            1,
            "table should have one data row in this example"
        );
    }

    #[test]
    fn streaming_core_parses_table_when_header_and_align_come_in_separate_chunks() {
        // 第一段只包含表头行（结尾带换行）
        let mut core = StreamingParserCore::new();
        let mut events = core.process_chunk("| col1 | col2 |\n");
        // 不应该立刻把这一行当作 BaseBlock 吃掉
        assert!(
            events.is_empty(),
            "header-only chunk should not be emitted as BaseBlock immediately"
        );

        // 第二段补上对齐行和一行数据
        events.extend(core.process_chunk(
            "| :--- | ---: |\n| a    | b    |\n",
        ));
        events.extend(core.finalize_parsing());

        // 现在应该能识别出一个 TableBlock
        let table_event = events
            .iter()
            .find(|ev| ev.block_type == BlockType::TableBlock)
            .expect("table block should be produced when header & align lines arrive across chunks");

        let attrs = table_event
            .attrs
            .as_ref()
            .expect("table attrs should exist for cross-chunk case as well");
        let model: TableModel =
            serde_json::from_value(attrs.clone()).expect("attrs should be valid TableModel");

        assert_eq!(model.header.len(), 2);
        assert_eq!(
            model.header[0].content[0].text.as_deref(),
            Some("col1")
        );
        assert_eq!(model.rows.len(), 1);
    }
    #[test]
    fn test_ai_table() {
        let markdown = "
> 注2：固态电池当前缺乏知识库内统一且可直接复核的现实 $/kWh 数据，因此成本栏以“趋势/定性”表述。[@bmfJHf][@LwFi4e]

| 维度 | 固态电池（SSB） | 氢燃料电池（HFC） | 钠离子电池（SIB） |
|---|---|---|---|
| 技术定位 | 液态锂电的进一步发展方向，目标是更高能量密度与安全性 [@bmfJHf] | 以燃料电池系统供能，竞争力取决于成本、寿命、基础设施和场景适配 [@MUnzrE][@zZvn9d] | 与锂电结构相似、材料体系更具资源可得性，强调低温/快充/成本与供应链优势 [@xTccHM][@8WTwEV] |
| 主要材料/路线 | 氧化物、硫化物、聚合物；Li金属/Si负极组合 [@YN8sHN] | 燃料电池系统、材料/组件/系统集成优化 [@MUnzrE] | layered oxides、PBA/Prussian white、polyanion、hard carbon [@TtxFEm] |
";
        let mut parser = StreamingParserCore::new();
        let events = parser.process_chunk(markdown);
        let mut all_events = events;
        all_events.extend(parser.finalize_parsing());

        let mut found_table = false;
        for event in all_events {
            if event.block_type == BlockType::TableBlock {
                found_table = true;
            }
        }
        assert!(found_table, "Table not found");
    }
}
