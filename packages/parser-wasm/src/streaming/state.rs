/// 流式块解析内部状态相关的类型定义。
/// 这些类型只在 streaming 模块内部使用，对外不暴露到 wasm 接口。

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum BlockState {
    Idle,
    /// 代码块内部状态：(语言, 累积的代码内容)
    InCodeBlock(Option<String>, String),
    /// 引用块内部状态：累积引用内容
    InQuoteBlock(String),
    /// 标题块内部状态：(级别, 累积内容)
    InHeadingBlock(u8, String),
    /// CommonMark type 2 HTML block 的原文。
    ///
    /// 不能在看到 `-->` 时立即结束：CommonMark 把终止符所在整行都算入
    /// HTML block，因此流式输入必须等到行尾或 finalize。
    InHtmlComment(String),
    /// LaTeX 块内部状态
    InLatexBlock {
        latex_type: LatexType,
        matcher: DelimMatcher,
        accumulated_content: String,
    },
    /// 表格块内部状态：缓存完整的 Markdown 表头、对齐行和数据行文本，待结束时统一解析。
    InTableBlock {
        header_line: String,
        align_line: String,
        body_lines: Vec<String>,
    },
}

/// LaTeX 块类型
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LatexType {
    Dollar,   // $$..$$
    Bracket,  // \\[..\]
    Equation, // \begin{equation}..\end{equation}
}

/// 结束定界符匹配器，简化版 KMP。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DelimMatcher {
    pub(crate) pattern: &'static [u8],
    pub(crate) current_match_pos: usize,
    pub(crate) end_marker_len: usize,
}

impl DelimMatcher {
    pub(crate) fn new(pattern_bytes: &'static [u8]) -> Self {
        DelimMatcher {
            pattern: pattern_bytes,
            current_match_pos: 0,
            end_marker_len: pattern_bytes.len(),
        }
    }

    pub(crate) fn feed_byte(&mut self, byte: u8) -> bool {
        if self.current_match_pos < self.end_marker_len && self.pattern[self.current_match_pos] == byte
        {
            self.current_match_pos += 1;
            if self.current_match_pos == self.end_marker_len {
                return true; // 完全匹配
            }
        } else {
            if self.current_match_pos > 0 {
                if byte == self.pattern[0] {
                    self.current_match_pos = 1;
                } else {
                    self.current_match_pos = 0;
                }
            } else if byte == self.pattern[0] {
                self.current_match_pos = 1;
            }
        }
        false
    }

    pub(crate) fn reset_after_match(&mut self) {
        self.current_match_pos = 0;
    }

    #[allow(dead_code)]
    pub(crate) fn matched_prefix_len(&self) -> usize {
        self.current_match_pos
    }

    #[allow(dead_code)]
    pub(crate) fn is_matching_prefix(&self) -> bool {
        self.current_match_pos > 0 && self.current_match_pos < self.end_marker_len
    }
}

