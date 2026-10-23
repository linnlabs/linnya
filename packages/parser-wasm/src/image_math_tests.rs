use crate::{BlockType, streaming::StreamingParserCore};

fn parse(chunks: &[&str]) -> Vec<crate::BlockEvent> {
    let mut core = StreamingParserCore::new();
    let mut events = Vec::new();
    for chunk in chunks { events.extend(core.process_chunk(chunk)); }
    events.extend(core.finalize_parsing());
    events
}

#[test]
fn images_and_unicode_math_survive_every_character_boundary() {
    let text = "![中文 &#91;说明&#93;](<linnya-image://one>)\n\n$$\n\\text{中文研究} + α + 🐱\n$$\n\n![第二张](conversation:/plot.png)";
    let expected = parse(&[text]);
    assert_eq!(expected.len(), 3);
    assert_eq!(expected[0].block_type, BlockType::ImageBlock);
    assert_eq!(expected[0].attrs.as_ref().unwrap()["caption"], "中文 [说明]");
    assert_eq!(expected[1].raw_content_fallback.as_deref(), Some("\\text{中文研究} + α + 🐱"));
    for (split, _) in text.char_indices() {
        let actual = parse(&[&text[..split], &text[split..]]);
        assert_eq!(serde_json::to_value(actual).unwrap(), serde_json::to_value(&expected).unwrap(), "split {split}");
    }
}

#[test]
fn empty_caption_is_an_image_and_mixed_images_remain_visible_to_admission() {
    let events = parse(&["![](<linnya-image://one>)\n\n文字 ![题注](conversation:/plot.png)"]);
    assert_eq!(events[0].block_type, BlockType::ImageBlock);
    assert_eq!(events[1].block_type, BlockType::BaseBlock);
    assert!(events[1].structured_content.as_ref().unwrap().iter().any(|item| item.r#type == "image"));
}
