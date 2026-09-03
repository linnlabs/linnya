use crate::streaming::StreamingParserCore;
use crate::model::BlockType;

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

    for event in all_events {
        println!(\"{:?}\", event.block_type);
        if event.block_type == BlockType::TableBlock {
            println!(\"Found table!\");
        }
    }
}
