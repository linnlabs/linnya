const compactRoles = new Set(`
  button link textbox searchbox combobox menuitem menuitemcheckbox menuitemradio tab checkbox radio switch
  slider spinbutton treeitem option row columnheader heading dialog menu listbox tree grid table navigation
  main banner complementary region toolbar tablist alert status
`.trim().split(/\s+/));
const states = new Set(['focused', 'expanded', 'selected', 'checked', 'disabled', 'pressed']);

export function renderSnapshot(nodes, { all, limit }) {
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const children = new Set(nodes.flatMap(node => node.childIds ?? []));
  const entries = [];
  const visit = (node, depth) => {
    const role = node.role?.value;
    const name = String(node.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const keep = !node.ignored && (compactRoles.has(role) || (all && role === 'StaticText' && name));
    if (keep) {
      entries.push({
        depth, role, name,
        ref: node.backendDOMNodeId && role !== 'StaticText' ? `@n${node.backendDOMNodeId}` : undefined,
        value: node.value?.value === undefined ? undefined : String(node.value.value).slice(0, 60),
        states: Object.fromEntries((node.properties ?? []).filter(property => states.has(property.name))
          .map(property => [property.name, property.value.value])),
      });
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child) visit(child, keep ? depth + 1 : depth);
    }
  };
  for (const node of nodes) {
    if (!children.has(node.nodeId)) visit(node, 0);
  }
  const visible = entries.slice(0, limit);
  const text = visible.map(entry => {
    const state = Object.entries(entry.states).map(([key, value]) => value === true ? key : `${key}=${value}`);
    return [
      `${'  '.repeat(entry.depth)}- ${entry.role}`,
      entry.name && JSON.stringify(entry.name), entry.ref,
      entry.value !== undefined && `value=${JSON.stringify(entry.value)}`, ...state,
    ].filter(Boolean).join(' ');
  }).join('\n');
  return { entries: visible, text, total: entries.length, truncated: entries.length > limit };
}
