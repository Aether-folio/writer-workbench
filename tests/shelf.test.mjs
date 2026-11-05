import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShelfItems,
  pickLatestDocument,
  pickWorkDocument,
  shelfDate,
  shelfSummary,
  workHue,
  workTitleSize,
} from '../src/shelf.mjs';

const files = [
  {path: '第二部作品/正文/第一章.md', updatedAt: '2026-10-01T02:00:00.000Z'},
  {path: '第二部作品/正文/第二章.md', updatedAt: '2026-10-02T02:00:00.000Z'},
  {path: '第二部作品/设定/人物设定.md', updatedAt: '2026-09-30T02:00:00.000Z'},
  {path: '文稿/旧稿.md', updatedAt: '2026-09-20T02:00:00.000Z'},
];
const works = [
  {name: '《第二部作品》', path: '第二部作品'},
  {name: '空作品', path: '空作品'},
];

test('作品变成书架上的书，带上文稿数、最近更新与封面', () => {
  const covers = new Map([['第二部作品', 'data:image/png;base64,xx']]);
  const items = buildShelfItems({works, files, covers});
  assert.equal(items.length, 3);
  const [first, second, loose] = items;
  assert.equal(first.kind, 'work');
  assert.equal(first.path, '第二部作品');
  assert.equal(first.name, '第二部作品', '封面上的作品名应去掉《》');
  assert.equal(first.count, 3);
  assert.equal(first.updatedAt, '2026-10-02T02:00:00.000Z');
  assert.equal(first.cover, 'data:image/png;base64,xx');
  assert.equal(first.size, 19);
  assert.ok(first.hue >= 0 && first.hue < 360);
  assert.equal(second.count, 0);
  assert.equal(second.cover, '');
  assert.equal(loose.kind, 'loose');
  assert.equal(loose.count, 1);
});

test('尚未另存的草稿也占一本书，空草稿不占', () => {
  const withDraft = buildShelfItems({works, files, draft: {title: '未命名草稿', body: '一段草稿'}});
  assert.equal(withDraft[0].kind, 'draft');
  assert.equal(withDraft[0].name, '未命名草稿');
  assert.equal(withDraft[0].detail, '草稿 · 继续写');
  const empty = buildShelfItems({works, files, draft: {title: '未命名草稿', body: '  \n '}});
  assert.equal(empty.some(item => item.kind === 'draft'), false);
});

test('点开作品时优先「正文」里最近更新的一篇', () => {
  assert.equal(pickWorkDocument(files, '第二部作品').path, '第二部作品/正文/第二章.md');
  assert.equal(pickWorkDocument([{path: '空作品/设定/大纲.md'}], '空作品').path, '空作品/设定/大纲.md');
  assert.equal(pickWorkDocument(files, '空作品'), null);
  assert.equal(pickWorkDocument(files, ''), null);
  assert.equal(pickWorkDocument(files, '不存在'), null);
});

test('同一时间戳时按文件名稳定排序', () => {
  const same = [
    {path: '文稿/第10章.md', updatedAt: '2026-10-02T02:00:00.000Z'},
    {path: '文稿/第2章.md', updatedAt: '2026-10-02T02:00:00.000Z'},
  ];
  assert.equal(pickLatestDocument(same).path, '文稿/第2章.md');
});

test('书架日期按北京时间显示，跨年才带年份', () => {
  const year = Number(new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric'}).format(new Date()));
  assert.equal(shelfDate(`${year}-11-02T03:00:00.000Z`), '11-02');
  assert.equal(shelfDate(`${year - 1}-11-02T03:00:00.000Z`), `${year - 1}-11-02`);
  assert.equal(shelfDate(''), '');
  assert.equal(shelfDate('不是日期'), '');
});

test('书架副标题区分作品、散篇与草稿', () => {
  assert.match(shelfSummary([]), /书架还是空的/);
  assert.equal(shelfSummary(buildShelfItems({works, files})), '2 部作品 · 1 篇散篇 · 点击封面继续写');
  assert.equal(shelfSummary(buildShelfItems({works: [], files, draft: null})), '4 篇散篇 · 点击继续写');
  assert.equal(shelfSummary(buildShelfItems({works: [], files: [], draft: {title: '未命名草稿', body: 'x'}})), '1 篇草稿 · 点击继续写');
});

test('封面标题字号随书名长度收敛', () => {
  assert.equal(workTitleSize('短名'), 24);
  assert.equal(workTitleSize('《第二部作品》'), 19);
  assert.equal(workTitleSize('稍微长一些的书名'), 14);
  assert.equal(workTitleSize('这是一个特别特别特别长的书名'), 11);
  assert.ok(workHue('空作品') !== workHue('第二部作品'));
});

