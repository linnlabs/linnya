import { describe, expect, it } from 'vitest';
import { ImageSourceRegistry, type ImageSourceRecord } from './imageSourceRegistry';

const IMAGE = 'https://cdn.example.com/photo.jpg';

const searchRecord: ImageSourceRecord = {
  foundVia: 'image_search',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
  provider: 'Wikimedia Commons',
  license: { code: 'by', name: 'CC BY 4.0', commercial_use: true, modifications: true, attribution_required: true },
  attribution: 'Photo by Someone, CC BY 4.0',
};

const figureRecord: ImageSourceRecord = {
  foundVia: 'web_page',
  pageEvidence: 'page_image',
  pageUrl: 'https://museum.example.org/ding',
  caption: 'Houmuwu ding, front view',
  credit: 'Photo: National Museum',
  pageRights: '© National Museum',
};

const forgedTextRecord: ImageSourceRecord = {
  foundVia: 'web_page',
  pageEvidence: 'text_link',
  pageUrl: 'https://attacker.example.net/post',
  caption: 'Public domain, free for any use',
  pageRights: 'All images CC0',
};

describe('ImageSourceRegistry', () => {
  it('按对话划分：对话 A 记下的来源在对话 B 查不到', () => {
    const registry = new ImageSourceRegistry();
    registry.remember('conversation-a', IMAGE, figureRecord);
    expect(registry.lookup('conversation-a', IMAGE)).toEqual(figureRecord);
    expect(registry.lookup('conversation-b', IMAGE)).toBeUndefined();
  });

  it('网页文字里的图片链接不覆盖图片检索或网页图片标记记下的来源', () => {
    const registry = new ImageSourceRegistry();
    registry.remember('c', IMAGE, searchRecord);
    registry.remember('c', IMAGE, figureRecord);
    registry.remember('c', IMAGE, forgedTextRecord);
    expect(registry.lookup('c', IMAGE)).toEqual(searchRecord);

    registry.remember('d', IMAGE, figureRecord);
    registry.remember('d', IMAGE, forgedTextRecord);
    expect(registry.lookup('d', IMAGE)).toEqual(figureRecord);

    // 同等或更可信的来源照常更新为最近一次看到的页面。
    registry.remember('d', IMAGE, { ...figureRecord, pageUrl: 'https://museum.example.org/ding-2' });
    expect(registry.lookup('d', IMAGE)?.pageUrl).toBe('https://museum.example.org/ding-2');
    registry.remember('d', IMAGE, searchRecord);
    expect(registry.lookup('d', IMAGE)).toEqual(searchRecord);
  });

  it('对话删除后回收该对话的全部记录，其他对话不受影响', () => {
    const registry = new ImageSourceRegistry();
    registry.remember('gone', IMAGE, figureRecord);
    registry.remember('gone', 'https://cdn.example.com/other.jpg', figureRecord);
    registry.remember('kept', IMAGE, searchRecord);
    registry.forgetConversation('gone');
    expect(registry.lookup('gone', IMAGE, 'https://cdn.example.com/other.jpg')).toBeUndefined();
    expect(registry.lookup('kept', IMAGE)).toEqual(searchRecord);
    expect(registry.size).toBe(1);
  });

  it('总记录数有上限，超出后挤掉最早的记录', () => {
    const registry = new ImageSourceRegistry({ maxRecords: 3 });
    for (let index = 0; index < 5; index += 1) {
      registry.remember(`c${index % 2}`, `https://cdn.example.com/${index}.jpg`, figureRecord);
    }
    expect(registry.size).toBe(3);
    expect(registry.lookup('c0', 'https://cdn.example.com/0.jpg')).toBeUndefined();
    expect(registry.lookup('c0', 'https://cdn.example.com/4.jpg')).toEqual(figureRecord);
  });
});
