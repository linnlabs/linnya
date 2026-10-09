use crate::{
    fenced_code::CodeFence,
    model::{BlockEvent, BlockType},
    streaming::StreamingParserCore,
};

fn parse(chunks: &[&str]) -> Vec<BlockEvent> {
    let mut parser = StreamingParserCore::new();
    let mut events = Vec::new();
    for chunk in chunks {
        events.extend(parser.process_chunk(chunk));
    }
    events.extend(parser.finalize_parsing());
    events
}

fn assert_same_events(actual: &[BlockEvent], expected: &[BlockEvent]) {
    assert_eq!(
        serde_json::to_value(actual).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
}

#[test]
fn fenced_payload_survives_every_two_chunk_split_and_character_stream() {
    let cases = [
        (
            "Before\n````text\nBEGIN\n```\n# literal\n```\nEND\n`````\nAfter",
            "BEGIN\n```\n# literal\n```\nEND",
        ),
        (
            "Before\n~~~text\n```\n<!-- literal -->\n[@ABC234]\n~~~ \t\nAfter",
            "```\n<!-- literal -->\n[@ABC234]",
        ),
        (
            "Before\n\n~~~text\n\n```\n<!-- literal -->\n[@ABC234]\n\n~~~\n\nAfter",
            "\n```\n<!-- literal -->\n[@ABC234]\n",
        ),
        ("Before\n```\njson\n  { }  \n```\nAfter", "json\n  { }  "),
        (
            "Before\n   ```text\n\n     中文 \t\n  x\n\tlast\n \n  ```\nAfter",
            "\n  中文 \t\nx\n last\n",
        ),
        ("Before\n```text\r\n  x \t\r\n\r\n```\r\nAfter", "  x \t\n"),
        (
            "Before\n````text\n```\n~~~\n```` suffix\n    ````\n``` `\n````\nAfter",
            "```\n~~~\n```` suffix\n    ````\n``` `",
        ),
    ];
    for (markdown, content) in cases {
        let expected = parse(&[markdown]);
        assert_eq!(expected.len(), 3, "{markdown}");
        assert_eq!(expected[1].block_type, BlockType::CodeBlock);
        assert_eq!(expected[1].raw_content_fallback.as_deref(), Some(content));
        assert_eq!(expected[2].raw_content_fallback.as_deref(), Some("After"));
        for (offset, _) in markdown.char_indices() {
            assert_same_events(
                &parse(&[&markdown[..offset], &markdown[offset..]]),
                &expected,
            );
        }
        let chunks: Vec<&str> = markdown
            .char_indices()
            .map(|(offset, ch)| &markdown[offset..offset + ch.len_utf8()])
            .collect();
        assert_same_events(&parse(&chunks), &expected);
    }
}

#[test]
fn empty_whitespace_and_unclosed_fences_are_real_blocks() {
    for (markdown, content) in [
        ("```\n```", ""),
        ("```", ""),
        ("~~~text\n", ""),
        ("```\n \t\n\n```", " \t\n"),
        ("```\npython", "python"),
        ("```\n  last \t", "  last \t"),
        ("```\n\n  last \t\n\n", "\n  last \t\n"),
    ] {
        let expected = parse(&[markdown]);
        assert_eq!(expected.len(), 1, "{markdown}");
        assert_eq!(expected[0].block_type, BlockType::CodeBlock);
        assert_eq!(expected[0].raw_content_fallback.as_deref(), Some(content));
        for (offset, _) in markdown.char_indices() {
            assert_same_events(
                &parse(&[&markdown[..offset], &markdown[offset..]]),
                &expected,
            );
        }
        assert_same_events(
            &crate::legacy_parse_lines_to_block_events(markdown),
            &expected,
        );
    }
}

#[test]
fn opener_and_closer_follow_marker_indent_and_info_rules() {
    for line in ["``", "~~", "    ```", "\t~~~", "```bad`info", "``` ``"] {
        assert!(CodeFence::open(line).is_none(), "{line}");
    }
    let fence = CodeFence::open("   ```` rust metadata").unwrap();
    for line in [
        "```",
        "~~~~",
        "````suffix",
        "    ````",
        "\t````",
        "````\u{a0}",
    ] {
        assert!(!fence.closes(line), "{line}");
    }
    for line in ["````", "  ````` \t", "``````"] {
        assert!(fence.closes(line), "{line}");
    }
    let events = parse(&["~~~ lang`name metadata\npayload\n~~~"]);
    assert_eq!(events[0].language.as_deref(), Some("lang`name"));
    let events = parse(&["``` rust metadata\npayload\n```"]);
    assert_eq!(events[0].language.as_deref(), Some("rust"));
}

#[test]
fn fences_do_not_steal_content_owned_by_other_blocks() {
    let events = parse(&["<!-- note\n```\n-->\n\n~~~\nx\n~~~"]);
    assert_eq!(events[0].block_type, BlockType::HtmlComment);
    assert_eq!(events[1].raw_content_fallback.as_deref(), Some("x"));
    let events = parse(&["$$\n```\n$$\n\n~~~\nx\n~~~"]);
    assert_eq!(events[0].block_type, BlockType::LatexBlock);
    assert_eq!(events[1].raw_content_fallback.as_deref(), Some("x"));
    let events = parse(&["| a | b |\n| --- | --- |\n| c | d |\n\n~~~\nx\n~~~"]);
    assert_eq!(events[0].block_type, BlockType::TableBlock);
    assert_eq!(events[1].raw_content_fallback.as_deref(), Some("x"));
}
