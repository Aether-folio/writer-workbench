import {paragraphDiff, textDiff} from './text-diff.mjs';

export function attachFileComparison(dialog, {workspace, callTool}) {
  const $ = id => dialog.querySelector('#'+id);
  const viewport = $('pen-compare-scroll'), table = viewport.querySelector('table');
  const body = table.tBodies[0], counter = $('pen-compare-count');
  const previous = $('pen-compare-prev'), next = $('pen-compare-next');
  const form = $('compare-file-form'), leftPath = $('compare-left-path'), rightPath = $('compare-right-path');
  const compareFiles = $('compare-files-run');
  const status = $('pen-compare-status');
  const close = $('pen-compare-close');
  const fileButton = document.getElementById('compare-files-open');
  let changes = [], index = -1, session;

  function updateNavigation() {
    previous.disabled = index <= 0;
    next.disabled = index >= changes.length-1;
    counter.textContent = !changes.length ? '没有差异' : index < 0
      ? `${changes.length} 处差异` : `第 ${index+1} / ${changes.length} 处差异`;
  }

  function jump(to) {
    if (!changes[to]) return;
    changes[index]?.classList.remove('pen-compare-current');
    index = to;
    const row = changes[index];
    row.classList.add('pen-compare-current');
    viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - table.tHead.offsetHeight - viewport.clientTop;
    updateNavigation();
    if (document.activeElement?.disabled) (next.disabled ? previous.disabled ? viewport : previous : next).focus();
  }

  previous.onclick = () => jump(index-1);
  next.onclick = () => jump(index+1);
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const returnFocus=session?.returnFocus;
    session = null;
    changes = [];
    body.replaceChildren();
    (returnFocus?.isConnected?returnFocus:fileButton).focus({preventScroll:true});
  });

  function cell(row, line, value, parts, side) {
    const td = row.insertCell();
    if (value === null) {
      td.className = 'pen-compare-gap';
      return;
    }
    const number = document.createElement('span'), text = document.createElement('span');
    number.className = 'pen-compare-line';
    number.setAttribute('aria-hidden','true');
    number.textContent = line;
    text.className = 'pen-compare-text';
    td.append(number, text);
    if (!parts) {
      text.textContent = value;
      return;
    }
    td.className = 'pen-compare-'+side;
    for (const part of parts) {
      if (part.type === 'same') text.append(part.text);
      else if (part.type === side) {
        const mark = document.createElement(side === 'remove' ? 'del' : 'ins');
        mark.className = 'diff-'+side;
        mark.textContent = part.text;
        text.append(mark);
      }
    }
  }

  function render() {
    const {rows} = session;
    const scroll = viewport.scrollTop;
    index = -1;
    changes = [];
    const fragment = document.createDocumentFragment();
    let inChange = false;
    for (const part of rows) {
      const row = document.createElement('tr');
      const left = part.before;
      const changed = left !== part.after;
      const parts = changed ? textDiff(left ?? '', part.after ?? '') : null;
      if (changed && !inChange) {
        row.className = 'pen-compare-change-start';
        changes.push(row);
      }
      inChange = changed;
      cell(row, part.oldLine, left, parts, 'remove');
      cell(row, part.newLine, part.after, parts, 'add');
      fragment.append(row);
    }
    body.replaceChildren(fragment);
    updateNavigation();
    viewport.scrollTop = scroll;
  }

  fileButton.onclick = () => {
    if (dialog.open) return;
    session = {rows:[]};
    form.hidden = false;
    compareFiles.disabled = false;
    viewport.hidden = counter.parentElement.hidden = true;
    status.textContent = '';
    dialog.showModal();
    const options = workspace.files.map(file => new Option(file.path, file.path));
    $('compare-paths').replaceChildren(...options);
    leftPath.value = workspace.path || leftPath.value;
    (leftPath.value ? rightPath : leftPath).focus();
  };
  compareFiles.onclick = async () => {
    const current = session;
    const paths = [leftPath, rightPath].map(input => input.value.trim().replaceAll('\\','/'));
    if (paths.some(path => !path)) {
      status.textContent = '请输入两个文稿路径。';
      return;
    }
    compareFiles.disabled = true;
    viewport.hidden = counter.parentElement.hidden = true;
    status.textContent = '正在读取文稿…';
    try {
      if (paths.includes(workspace.path)) await workspace.flushDocument();
      const [left, right] = await Promise.all(paths.map(path => callTool('read_document',{path})));
      if (session !== current || !dialog.open) return;
      current.rows = paragraphDiff(left.body.replace(/\r\n?/g,'\n'), right.body.replace(/\r\n?/g,'\n'));
      $('compare-left-label').textContent = left.path;
      $('compare-right-label').textContent = right.path;
      viewport.hidden = counter.parentElement.hidden = false;
      render();
      status.textContent = '';
      viewport.scrollTop = 0;
    } catch (error) {
      if (session === current) status.textContent = error.message;
    } finally {
      if (session === current) compareFiles.disabled = false;
    }
  };
  function showSuggestion({before,after,returnFocus}) {
    if(dialog.open)return;
    session = {rows:paragraphDiff(before,after),returnFocus};
    form.hidden = true;
    $('compare-left-label').textContent = '原文';
    $('compare-right-label').textContent = '改稿';
    status.textContent = '';
    viewport.hidden = counter.parentElement.hidden = false;
    render();
    dialog.showModal();
    viewport.scrollTop = 0;
  }

  form.onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      compareFiles.click();
    }
  };
  return showSuggestion;
}
