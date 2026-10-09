use crate::model::{BlockEvent, BlockType};

/// 围栏只在解析期间保留；持久化层只需要语言与字面正文。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CodeFence {
    marker: u8,
    length: usize,
    indent: usize,
    language: Option<String>,
}

impl CodeFence {
    pub(crate) fn open(line: &str) -> Option<Self> {
        let indent = line.bytes().take_while(|byte| *byte == b' ').count();
        if indent > 3 {
            return None;
        }
        let rest = &line[indent..];
        let marker = *rest.as_bytes().first()?;
        if marker != b'`' && marker != b'~' {
            return None;
        }
        let length = rest.bytes().take_while(|byte| *byte == marker).count();
        if length < 3 {
            return None;
        }
        let info = &rest[length..];
        if marker == b'`' && info.contains('`') {
            return None;
        }
        let language = info.split_whitespace().next().map(str::to_string);
        Some(Self {
            marker,
            length,
            indent,
            language,
        })
    }

    pub(crate) fn closes(&self, line: &str) -> bool {
        let indent = line.bytes().take_while(|byte| *byte == b' ').count();
        if indent > 3 {
            return false;
        }
        let rest = &line[indent..];
        let length = rest.bytes().take_while(|byte| *byte == self.marker).count();
        length >= self.length
            && rest[length..]
                .bytes()
                .all(|byte| byte == b' ' || byte == b'\t')
    }

    pub(crate) fn append_line(&self, content: &mut String, line: &str, has_newline: bool) {
        // Tab 按四列停靠点参与缩进；只展开被 opener 缩进去掉一部分的 tab。
        let mut consumed_bytes = 0;
        let mut columns = 0;
        for byte in line.bytes() {
            if columns >= self.indent {
                break;
            }
            match byte {
                b' ' => columns += 1,
                b'\t' => columns += 4 - columns % 4,
                _ => break,
            }
            consumed_bytes += 1;
        }
        for _ in self.indent..columns {
            content.push(' ');
        }
        content.push_str(&line[consumed_bytes..]);
        if has_newline {
            content.push('\n');
        }
    }

    pub(crate) fn event(&self, content: &str) -> BlockEvent {
        // 编辑器文本不存围栏前的一个结构性换行；其余空白与空行必须原样保留。
        BlockEvent {
            block_type: BlockType::CodeBlock,
            raw_content_fallback: Some(content.strip_suffix('\n').unwrap_or(content).to_string()),
            structured_content: None,
            language: self.language.clone(),
            level: None,
            list_type: None,
            list_level: None,
            attrs: None,
        }
    }
}

/// 尚未完成的行不能判为 opener/closer，否则后续 chunk 会改变已经发出的块边界。
pub(crate) fn first_line(input: &str, is_final: bool) -> Option<(&str, usize)> {
    if let Some(end) = input.find('\n') {
        let line = input[..end].strip_suffix('\r').unwrap_or(&input[..end]);
        Some((line, end + 1))
    } else if is_final && !input.is_empty() {
        Some((input, input.len()))
    } else {
        None
    }
}

pub(crate) fn find_open(input: &str, is_final: bool) -> Option<(usize, usize, CodeFence)> {
    let mut offset = 0;
    while let Some((line, consumed)) = first_line(&input[offset..], is_final) {
        if let Some(fence) = CodeFence::open(line) {
            return Some((offset, consumed, fence));
        }
        offset += consumed;
    }
    None
}
