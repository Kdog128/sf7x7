export function buildScrollOffset(name, sameTab, offsets) {
  return name === 'tabs' || sameTab ? offsets[name] || 0 : 0;
}

export function bindBuildScroll(row) {
  const strip = row.parentElement;
  const left = strip.querySelector('.scroll-fade-left');
  const right = strip.querySelector('.scroll-fade-right');
  const events = new AbortController();
  const options = { signal: events.signal };
  let drag = null, suppressClick = false;

  function update() {
    const progress = row.scrollLeft / (row.scrollWidth - row.clientWidth);
    left.style.opacity = progress;
    right.style.opacity = 1 - progress;
  }

  function finish(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    suppressClick = drag.moved;
    const id = drag.id;
    drag = null;
    if (row.hasPointerCapture(id)) row.releasePointerCapture(id);
    row.classList.remove('dragging');
  }

  row.addEventListener('scroll', update, { ...options, passive: true });
  row.addEventListener('wheel', (e) => {
    if (!e.shiftKey || e.deltaX || e.ctrlKey || e.metaKey) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? row.clientWidth : 1;
    row.scrollLeft += e.deltaY * unit;
    e.preventDefault();
    update();
  }, { ...options, passive: false });
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    suppressClick = false;
    if (row.scrollWidth <= row.clientWidth) return;
    drag = { id: e.pointerId, x: e.clientX, scroll: row.scrollLeft, moved: false };
  }, options);
  row.ownerDocument.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const distance = e.clientX - drag.x;
    if (!drag.moved && Math.abs(distance) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      row.setPointerCapture(drag.id);
      row.classList.add('dragging');
    }
    row.scrollLeft = drag.scroll - distance;
    e.preventDefault();
    update();
  }, options);
  row.ownerDocument.addEventListener('pointerup', finish, options);
  row.ownerDocument.addEventListener('pointercancel', finish, options);
  row.addEventListener('lostpointercapture', finish, options);
  row.addEventListener('click', (e) => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { ...options, capture: true });
  row.addEventListener('dragstart', (e) => e.preventDefault(), options);

  const observer = new ResizeObserver(update);
  observer.observe(row);
  for (const child of row.children) observer.observe(child);
  update();
  return () => {
    finish();
    events.abort();
    observer.disconnect();
  };
}
