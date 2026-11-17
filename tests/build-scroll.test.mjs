import test from 'node:test';
import assert from 'node:assert/strict';
import { bindBuildScroll, buildScrollOffset } from '../js/build-scroll.js';

test('switching categories resets items but preserves the category row and same-tab selection', () => {
  const offsets = { items: 420, tabs: 80 };
  assert.equal(buildScrollOffset('items', false, offsets), 0);
  assert.equal(buildScrollOffset('items', true, offsets), 420);
  assert.equal(buildScrollOffset('tabs', false, offsets), 80);
  assert.equal(buildScrollOffset('items', true, {}), 0);
});

class Row extends EventTarget {
  constructor(width = 300, content = 900) {
    super();
    this.clientWidth = width;
    this.scrollWidth = content;
    this.position = 0;
    this.ownerDocument = new EventTarget();
    this.children = [{}, {}];
    this.classes = new Set();
    this.classList = { add: k => this.classes.add(k), remove: k => this.classes.delete(k) };
    this.left = { style: {}, hidden: true };
    this.right = { style: {}, hidden: true };
    this.parentElement = { querySelector: s => s.endsWith('-left') ? this.left : this.right };
  }
  get scrollLeft() { return this.position; }
  set scrollLeft(v) { this.position = Math.max(0, Math.min(v, this.scrollWidth - this.clientWidth)); }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}

function fire(target, type, values = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, detail: 1,
    shiftKey: false, deltaX: 0, deltaY: 0, deltaMode: 0, ...values });
  target.dispatchEvent(e);
  return e;
}

function fixture(t, width, content) {
  const original = globalThis.ResizeObserver;
  let observer;
  globalThis.ResizeObserver = class {
    constructor(update) { this.update = update; this.observed = []; observer = this; }
    observe(node) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
  };
  const row = new Row(width, content), dispose = bindBuildScroll(row);
  globalThis.ResizeObserver = original;
  t.after(dispose);
  return { row, observer, dispose };
}

test('fades track the start, middle and end of an overflowing row', t => {
  const { row } = fixture(t);
  assert.equal(row.left.hidden, true);
  assert.equal(row.right.hidden, false);
  assert.equal(row.right.style.opacity, 1);
  row.scrollLeft = 150; fire(row, 'scroll');
  assert.equal(row.left.hidden, false);
  assert.equal(row.right.hidden, false);
  assert.equal(row.left.style.opacity, 0.25);
  assert.equal(row.right.style.opacity, 0.75);
  row.scrollLeft = 600; fire(row, 'scroll');
  assert.equal(row.left.hidden, false);
  assert.equal(row.left.style.opacity, 1);
  assert.equal(row.right.hidden, true);
  row.scrollLeft = 0; fire(row, 'scroll');
  assert.equal(row.left.hidden, true);
  assert.equal(row.right.hidden, false);
});

test('fitted content hides both fades and resize updates their visibility', t => {
  const { row, observer } = fixture(t, 300, 300);
  assert.equal(row.left.hidden, true);
  assert.equal(row.right.hidden, true);
  assert.equal(observer.observed.length, 3);
  row.scrollWidth = 900; observer.update();
  assert.equal(row.right.hidden, false);
  row.scrollLeft = 200; observer.update();
  assert.equal(row.left.hidden, false);
});

test('shift wheel scrolls in either direction and supports line and page deltas', t => {
  const { row } = fixture(t);
  assert.equal(fire(row, 'wheel', { shiftKey: true, deltaY: 50 }).defaultPrevented, true);
  assert.equal(row.scrollLeft, 50);
  fire(row, 'wheel', { shiftKey: true, deltaY: -20 });
  assert.equal(row.scrollLeft, 30);
  fire(row, 'wheel', { shiftKey: true, deltaY: 2, deltaMode: 1 });
  assert.equal(row.scrollLeft, 62);
  fire(row, 'wheel', { shiftKey: true, deltaY: 1, deltaMode: 2 });
  assert.equal(row.scrollLeft, 362);
});

test('horizontal trackpad and browser zoom gestures retain native behavior', t => {
  const { row } = fixture(t);
  for (const values of [{ deltaX: 20 }, { shiftKey: true, deltaX: 20 },
    { ctrlKey: true, shiftKey: true, deltaY: 20 }, { metaKey: true, shiftKey: true, deltaY: 20 }]) {
    assert.equal(fire(row, 'wheel', values).defaultPrevented, false);
  }
  assert.equal(row.scrollLeft, 0);
});

test('mouse drag scrolls, captures only after movement, and suppresses the drag click', t => {
  const { row } = fixture(t);
  fire(row, 'pointerdown');
  assert.equal(row.hasPointerCapture(1), false);
  fire(row.ownerDocument, 'pointermove', { clientX: 96 });
  assert.equal(row.scrollLeft, 0);
  fire(row.ownerDocument, 'pointermove', { clientX: 20 });
  assert.equal(row.scrollLeft, 80);
  assert.equal(row.hasPointerCapture(1), true);
  assert.equal(row.classes.has('dragging'), true);
  fire(row.ownerDocument, 'pointerup');
  assert.equal(row.hasPointerCapture(1), false);
  assert.equal(row.classes.has('dragging'), false);
  assert.equal(fire(row, 'click').defaultPrevented, true);
  fire(row, 'pointerdown');
  fire(row.ownerDocument, 'pointerup');
  assert.equal(fire(row, 'click').defaultPrevented, false);
});

test('touch stays native and cancellation or disposal clears capture and listeners', t => {
  const { row, observer, dispose } = fixture(t);
  fire(row, 'pointerdown', { pointerType: 'touch' });
  fire(row.ownerDocument, 'pointermove', { clientX: 10 });
  assert.equal(row.scrollLeft, 0);
  fire(row, 'pointerdown');
  fire(row.ownerDocument, 'pointermove', { clientX: 10 });
  fire(row.ownerDocument, 'pointercancel');
  assert.equal(row.hasPointerCapture(1), false);
  assert.equal(fire(row, 'click', { detail: 0 }).defaultPrevented, false);
  dispose();
  assert.equal(observer.disconnected, true);
  const before = row.scrollLeft;
  fire(row, 'wheel', { shiftKey: true, deltaY: 100 });
  assert.equal(row.scrollLeft, before);
});
