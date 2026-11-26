/** 旧式门户常用命名 region 和布局表发布公告。只保留在同一行明确对应的标题、地址和日期。 */
export function extractDatedRegionList(document: Document): Element | undefined {
  let best = new Map<string, { title: string; date: string }>();
  for (const region of document.querySelectorAll('[role="region"][aria-label], [role="region"][aria-labelledby]')) {
    const entries = new Map<string, { title: string; date: string }>();
    for (const row of region.querySelectorAll('tr, li')) {
      // 页头的日期和另一行的菜单链接不能拼成一条公告；外层布局行也不能重复捕获内层条目。
      if (row.querySelector('tr, li') || row.closest('[role="region"]') !== region
        || row.closest('header, [role="banner"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) continue;
      const links = row.querySelectorAll('a[href]');
      const link = links[0];
      if (links.length !== 1 || !link) continue;
      const title = link.textContent?.trim();
      const href = link.getAttribute('href');
      if (!title || !href || entries.has(href)) continue;
      const date = (row.textContent ?? '').replace(title, '').trim();
      if (/^(?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(date)) entries.set(href, { title, date });
    }
    if (entries.size > best.size) best = entries;
  }
  if (best.size < 3) return undefined;
  const list = document.createElement('ul');
  for (const [href, { title, date }] of best) {
    const link = document.createElement('a');
    link.setAttribute('href', href);
    link.textContent = title;
    const item = document.createElement('li');
    item.append(link, ` ${date}`);
    list.appendChild(item);
  }
  return list;
}
