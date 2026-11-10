const compactRoles = new Set(`
  button link textbox searchbox combobox menuitem menuitemcheckbox menuitemradio tab checkbox radio switch
  slider spinbutton treeitem option row columnheader heading dialog menu listbox tree grid table navigation
  main banner complementary region toolbar tablist alert status
`.trim().split(/\s+/));
const states = new Set(['focused', 'expanded', 'selected', 'checked', 'disabled', 'pressed']);

function matcher({ grep, roles }) {
  if (!grep && !roles) return null;
  const needle = grep?.toLowerCase();
  return entry => (!roles || roles.has(entry.role)) &&
    (!needle || `${entry.name} ${entry.value ?? ''}`.toLowerCase().includes(needle));
}

/** 过滤时只保留命中项及其祖先链，层级上下文还在，输出却只有几行。 */
function keepMatches(entries, matches) {
  const kept = new Set();
  entries.forEach((entry, index) => {
    if (!matches(entry)) return;
    for (let at = index; at !== undefined && !kept.has(at); at = entries[at].parent) kept.add(at);
  });
  return entries.filter((_entry, index) => kept.has(index));
}

export function renderSnapshot(nodes, { all, limit, grep, roles }) {
  const matches = matcher({ grep, roles });
  // 按文字过滤时正文也要参与匹配，否则只命中控件名。
  const withText = all || Boolean(grep);
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const children = new Set(nodes.flatMap(node => node.childIds ?? []));
  const entries = [];
  const visit = (node, depth, parent) => {
    const role = node.role?.value;
    const name = String(node.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    // 按钮名通常就是其中的文字，正文行与上层同名时不重复列出。
    const echoesParent = parent !== undefined && entries[parent].name.includes(name);
    const keep = !node.ignored && (compactRoles.has(role) || (withText && role === 'StaticText' && name && !echoesParent));
    const index = entries.length;
    if (keep) {
      entries.push({
        depth, parent, role, name,
        ref: node.backendDOMNodeId && role !== 'StaticText' ? `@n${node.backendDOMNodeId}` : undefined,
        value: node.value?.value === undefined ? undefined : String(node.value.value).slice(0, 60),
        states: Object.fromEntries((node.properties ?? []).filter(property => states.has(property.name))
          .map(property => [property.name, property.value.value])),
      });
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child) visit(child, keep ? depth + 1 : depth, keep ? index : parent);
    }
  };
  for (const node of nodes) {
    if (!children.has(node.nodeId)) visit(node, 0);
  }
  const selected = matches ? keepMatches(entries, matches) : entries;
  const visible = selected.slice(0, limit).map(entry => {
    const { parent, ...rest } = entry;
    void parent;
    return rest;
  });
  const text = visible.map(entry => {
    const state = Object.entries(entry.states).map(([key, value]) => value === true ? key : `${key}=${value}`);
    return [
      `${'  '.repeat(entry.depth)}- ${entry.role}`,
      entry.name && JSON.stringify(entry.name), entry.ref,
      entry.value !== undefined && `value=${JSON.stringify(entry.value)}`, ...state,
    ].filter(Boolean).join(' ');
  }).join('\n');
  return { entries: visible, text, total: selected.length, truncated: selected.length > limit };
}
