/**
 * 书架：把「作品」显示成一本本可以点开的书。
 *
 * 这里只做纯数据整理（buildShelfItems / pickWorkDocument / shelfDate …）和
 * 一段不依赖全局状态的 DOM 渲染，方便单测，也方便工作台在侧栏窄宽度下复用。
 */

const displayName = name => String(name ?? '').replace(/^《(.*)》$/u, '$1');

export function workHue(name) {
  return [...String(name ?? '')].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) % 360;
}

/** 书名越长字越小，让封面上的标题始终能在 2~4 行内放稳。 */
export function workTitleSize(name) {
  const length = [...displayName(name)].length;
  if (length <= 4) return 24;
  if (length <= 5) return 19;
  if (length <= 7) return 16;
  if (length <= 9) return 14;
  if (length <= 12) return 12;
  return 11;
}

/** 按北京时间显示「10-31」或跨年的「2025-10-31」。 */
export function shelfDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = type => parts.find(part => part.type === type)?.value ?? '';
  const year = read('year');
  const month = read('month');
  const day = read('day');
  if (!year || !month || !day) return '';
  const currentYear = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric'})
    .formatToParts(new Date()).find(part => part.type === 'year')?.value ?? '';
  return year === currentYear ? `${month}-${day}` : `${year}-${month}-${day}`;
}

function latestUpdate(files) {
  let latest = '';
  for (const file of files) {
    const value = typeof file?.updatedAt === 'string' ? file.updatedAt : '';
    if (value && value > latest) latest = value;
  }
  return latest;
}

/** 同一天里按最近更新时间挑一篇；没有时间戳时按文件路径稳定排序。 */
export function pickLatestDocument(files) {
  return [...files].sort((a, b) => {
    const left = typeof a?.updatedAt === 'string' ? a.updatedAt : '';
    const right = typeof b?.updatedAt === 'string' ? b.updatedAt : '';
    return right.localeCompare(left) || String(a?.path ?? '').localeCompare(String(b?.path ?? ''), 'zh-CN', {numeric: true});
  })[0] ?? null;
}

/** 点开一本作品时进入的文稿：优先「正文」里最近更新的一篇，没有正文再退到设定/草稿。 */
export function pickWorkDocument(files, workPath) {
  if (typeof workPath !== 'string' || workPath === '') return null;
  const prefix = workPath + '/';
  const documents = files.filter(file => typeof file?.path === 'string' && file.path.startsWith(prefix));
  if (!documents.length) return null;
  const body = documents.filter(file => file.path.slice(prefix.length).split('/')[0] === '正文');
  return pickLatestDocument(body.length ? body : documents);
}

/**
 * 作品 → 书架条目。没有归入任何作品的文件会合成一本「散篇文稿」，
 * 这样旧版直接放在「文稿/」里的章节也还能从书架上打开。
 * 还没有另存为文稿的「未命名草稿」也会占一本书，避免草稿在书架里失联。
 */
export function buildShelfItems({works = [], files = [], covers = new Map(), draft = null} = {}) {
  const known = works.filter(work => work && typeof work.path === 'string' && work.path !== '');
  const items = [];
  if (draft && typeof draft.body === 'string' && draft.body.trim() !== '') {
    items.push({
      kind: 'draft',
      path: '',
      name: String(draft.title || '未命名草稿').trim() || '未命名草稿',
      count: 0,
      updatedAt: '',
      cover: '',
      hue: 32,
      size: 16,
      detail: '草稿 · 继续写',
    });
  }
  for (const work of known) {
    const prefix = work.path + '/';
    const documents = files.filter(file => typeof file?.path === 'string' && file.path.startsWith(prefix));
    const title = work.name || work.path;
    const cover = typeof covers?.get === 'function' ? String(covers.get(work.path) || '') : '';
    items.push({
      kind: 'work',
      path: work.path,
      name: displayName(title),
      count: documents.length,
      updatedAt: latestUpdate(documents),
      cover,
      hue: workHue(title),
      size: workTitleSize(title),
    });
  }
  const loose = files.filter(file => typeof file?.path === 'string' && file.path !== ''
    && !known.some(work => file.path.startsWith(work.path + '/')));
  if (loose.length) {
    items.push({
      kind: 'loose',
      path: '',
      name: '散篇文稿',
      count: loose.length,
      updatedAt: latestUpdate(loose),
      cover: '',
      hue: 206,
      size: 20,
    });
  }
  return items;
}

export function shelfSummary(items) {
  if (!items.length) return '书架还是空的，从一本空白的书开始。';
  const works = items.filter(item => item.kind === 'work').length;
  const loose = items.find(item => item.kind === 'loose');
  const draft = items.find(item => item.kind === 'draft');
  if (!works) {
    const parts = [];
    if (draft) parts.push('1 篇草稿');
    if (loose) parts.push(`${loose.count} 篇散篇`);
    return `${parts.join(' · ')} · 点击继续写`;
  }
  return `${works} 部作品${loose ? ` · ${loose.count} 篇散篇` : ''} · 点击封面继续写`;
}

function shelfDetail(item) {
  if (!item.count) return '还没有文稿';
  const date = shelfDate(item.updatedAt);
  return `${item.count} 篇文稿${date ? ` · ${date}` : ''}`;
}

function bookArt(doc, item) {
  const art = doc.createElement('span');
  art.className = 'book-art';
  const kicker = doc.createElement('span');
  kicker.className = 'book-kicker';
  kicker.textContent = item.kind === 'draft' ? '草稿' : item.kind === 'loose' ? '散篇' : '作品';
  const name = doc.createElement('strong');
  name.className = 'book-name';
  name.textContent = item.name;
  const rule = doc.createElement('i');
  rule.className = 'book-rule';
  art.append(kicker, name, rule);
  return art;
}

function bookElement(doc, item, onOpen, onContextMenu) {
  const label = item.kind === 'work' ? `《${item.name}》` : item.name;
  const detailText = item.detail || shelfDetail(item);
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'shelf-book' + (item.kind === 'work' ? '' : ` is-${item.kind}`);
  button.dataset.path = item.kind === 'work' ? item.path : item.kind;
  button.dataset.kind = item.kind;
  button.setAttribute('aria-label', item.count ? `打开${label}，${item.count} 篇文稿` : `打开${label}`);
  const hint = item.kind === 'draft' ? '点击继续写草稿' : item.count ? '点击打开' : '点击新建第一篇文稿';
  const tooltip = [label, detailText, hint];
  if (item.kind === 'work') tooltip.push('右键可重命名或更换封面');
  button.title = tooltip.join('\n');

  const cover = doc.createElement('span');
  cover.className = 'book-cover';
  cover.style.setProperty('--book-hue', String(item.hue));
  cover.style.setProperty('--book-size', String(item.size));
  cover.append(bookArt(doc, item));
  if (item.cover) {
    const image = doc.createElement('img');
    image.className = 'book-image';
    image.src = item.cover;
    image.alt = '';
    image.decoding = 'async';
    cover.append(image);
  }
  const plank = doc.createElement('span');
  plank.className = 'book-plank';
  plank.setAttribute('aria-hidden', 'true');

  const meta = doc.createElement('span');
  meta.className = 'book-meta';
  const title = doc.createElement('span');
  title.className = 'book-title';
  title.textContent = label;
  const detail = doc.createElement('span');
  detail.className = 'book-detail';
  detail.textContent = detailText;
  meta.append(title, detail);

  button.append(cover, plank, meta);
  button.addEventListener('click', () => onOpen?.(item));
  if (item.kind === 'work' && typeof onContextMenu === 'function') {
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      onContextMenu(item, button, event);
    });
  }
  return button;
}

function blankBook(doc, onCreate) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'shelf-book shelf-empty';
  button.dataset.kind = 'empty';
  button.setAttribute('aria-label', '点击创作第一个作品');
  button.title = '创建第一个作品';
  const cover = doc.createElement('span');
  cover.className = 'book-cover book-blank';
  const lines = doc.createElement('span');
  lines.className = 'book-blank-lines';
  lines.setAttribute('aria-hidden', 'true');
  const plus = doc.createElement('span');
  plus.className = 'book-blank-plus';
  plus.setAttribute('aria-hidden', 'true');
  plus.textContent = '＋';
  const label = doc.createElement('span');
  label.className = 'book-blank-label';
  label.textContent = '空白书本';
  cover.append(lines, plus, label);
  const plank = doc.createElement('span');
  plank.className = 'book-plank';
  plank.setAttribute('aria-hidden', 'true');
  const meta = doc.createElement('span');
  meta.className = 'book-meta';
  const title = doc.createElement('span');
  title.className = 'book-title';
  title.textContent = '点击创作第一个作品';
  const detail = doc.createElement('span');
  detail.className = 'book-detail';
  detail.textContent = '从一本空白的书开始';
  meta.append(title, detail);
  button.append(cover, plank, meta);
  if (typeof onCreate === 'function') button.addEventListener('click', () => onCreate());
  else button.disabled = true;
  return button;
}

function addTile(doc, onCreate) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'shelf-add';
  button.dataset.kind = 'add';
  button.setAttribute('aria-label', '添加新作品');
  button.title = '添加新作品';
  const cover = doc.createElement('span');
  cover.className = 'shelf-add-cover';
  cover.setAttribute('aria-hidden', 'true');
  cover.textContent = '＋';
  const meta = doc.createElement('span');
  meta.className = 'book-meta';
  const title = doc.createElement('span');
  title.className = 'book-title';
  title.textContent = '添加作品';
  const detail = doc.createElement('span');
  detail.className = 'book-detail';
  detail.textContent = '新开一本';
  meta.append(title, detail);
  button.append(cover, meta);
  if (typeof onCreate === 'function') button.addEventListener('click', () => onCreate());
  return button;
}

function skeletonBook(doc) {
  const shell = doc.createElement('div');
  shell.className = 'shelf-book shelf-skeleton';
  shell.setAttribute('aria-hidden', 'true');
  const cover = doc.createElement('span');
  cover.className = 'book-cover';
  const plank = doc.createElement('span');
  plank.className = 'book-plank';
  const meta = doc.createElement('span');
  meta.className = 'book-meta';
  const title = doc.createElement('span');
  title.className = 'book-title skeleton-line';
  const detail = doc.createElement('span');
  detail.className = 'book-detail skeleton-line short';
  meta.append(title, detail);
  shell.append(cover, plank, meta);
  return shell;
}

/**
 * 渲染书架。
 * @param {HTMLElement} container
 * @param {{items?: object[], ready?: boolean, canCreate?: boolean, onCreate?: Function, onOpen?: Function, onContextMenu?: Function}} options
 */
export function renderShelf(container, {items = [], ready = true, canCreate = true, onCreate, onOpen, onContextMenu} = {}) {
  if (!container) return;
  const doc = container.ownerDocument ?? globalThis.document;
  container.replaceChildren();
  container.classList.toggle('is-empty', ready && items.length === 0);
  container.classList.toggle('is-loading', !ready);
  if (!ready) {
    container.append(skeletonBook(doc));
    return;
  }
  if (!items.length) {
    container.append(blankBook(doc, canCreate ? onCreate : null));
    return;
  }
  for (const item of items) container.append(bookElement(doc, item, onOpen, onContextMenu));
  if (canCreate) container.append(addTile(doc, onCreate));
}
