function caretBounds(range) {
  const {startContainer, startOffset} = range;
  // A collapsed rect before a preserved newline can point to the preceding line.
  if (startContainer.nodeType === Node.TEXT_NODE && startContainer.data[startOffset] === '\n') {
    const newline = range.cloneRange();
    newline.setEnd(startContainer, startOffset + 1);
    const bounds = newline.getClientRects()[0];
    if (bounds?.height) return bounds;
  }
  const bounds = range.getBoundingClientRect();
  if (bounds.height) return bounds;

  // At an empty line or a block boundary Chromium can return an empty caret rect.
  const next = startContainer.childNodes[startOffset];
  const previous = startContainer.childNodes[startOffset - 1];
  const node = next ?? previous ?? startContainer;
  const probe = document.createRange();
  probe.selectNodeContents(node);
  probe.collapse(Boolean(next) || !previous);
  const boundary = probe.getBoundingClientRect();
  if (boundary.height) return boundary;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.getClientRects()[0];
}

export function attachProposalCaret(editor) {
  const caret = document.createElement('span');
  caret.className = 'pen-proposal-caret';
  caret.hidden = true;
  caret.setAttribute('aria-hidden', 'true');
  document.body.append(caret);

  let owner;
  let frame = 0;
  function hide() {
    owner?.removeAttribute('data-visible-caret');
    owner = null;
    caret.hidden = true;
  }
  function update() {
    frame = 0;
    const focused = document.activeElement;
    const selection = document.getSelection();
    if (!document.hasFocus() || !editor.contains(focused) ||
        !focused.matches('.pen-proposal-text[contenteditable="true"]') ||
        !selection?.rangeCount || !selection.isCollapsed || !focused.contains(selection.focusNode)) {
      hide();
      return;
    }

    const bounds = caretBounds(selection.getRangeAt(0));
    const view = editor.getBoundingClientRect();
    const top = Math.max(bounds?.top ?? 0, view.top, 0);
    const bottom = Math.min(bounds?.bottom ?? 0, view.bottom, innerHeight);
    const x = bounds?.left;
    if (bottom <= top || x === undefined || x < Math.max(0, view.left) || x >= Math.min(innerWidth, view.right)) {
      hide();
      return;
    }
    if (owner !== focused) {
      owner?.removeAttribute('data-visible-caret');
      owner = focused;
      owner.setAttribute('data-visible-caret', '');
    }
    caret.style.left = Math.round(x) + 'px';
    caret.style.top = Math.round(top) + 'px';
    caret.style.height = Math.round(bottom - top) + 'px';
    caret.hidden = false;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  const listeners = new AbortController();
  for (const event of ['focusin', 'focusout', 'selectionchange', 'input', 'scroll']) {
    document.addEventListener(event, schedule, {capture:true, signal:listeners.signal});
  }
  for (const event of ['focus', 'blur', 'resize']) {
    window.addEventListener(event, schedule, {signal:listeners.signal});
  }
  const resize = new ResizeObserver(schedule);
  resize.observe(editor);
  return () => {
    listeners.abort();
    resize.disconnect();
    cancelAnimationFrame(frame);
    hide();
    caret.remove();
  };
}
