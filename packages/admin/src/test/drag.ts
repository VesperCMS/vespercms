import { act } from '@testing-library/react';
import { vi } from 'vitest';

/*
 * jsdom has neither drag and drop nor layout. These stand in for both, enough
 * for React Aria's useDrag and useDrop: a DataTransfer that keeps its strings,
 * and lists whose rows are 40px tall with 8px between them.
 */

const ROW = 40;
const STEP = 48;

class FakeDataTransfer {
  dropEffect = 'none';
  effectAllowed = 'uninitialized';
  readonly #data = new Map<string, string>();
  readonly items = {
    add: (data: string, type: string) => {
      this.#data.set(type, data);
    },
    [Symbol.iterator]: () =>
      [...this.#data.keys()].map((type) => ({ kind: 'string', type }))[Symbol.iterator](),
  };
  get types(): string[] {
    return [...this.#data.keys()];
  }
  getData(type: string): string {
    return this.#data.get(type) ?? '';
  }
  clearData(): void {
    this.#data.clear();
  }
  setDragImage = vi.fn();
}

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    bottom: top + height,
    right: 600,
    width: 600,
    height,
    toJSON: () => ({}),
  };
}

/**
 * Gives every list a layout: each starts at the top of the page, its items one
 * under another. `vi.restoreAllMocks()` takes it away.
 */
export function layOutLists(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const parent = this.parentElement;
    if (this.tagName === 'OL') return rect(0, this.children.length * STEP - (STEP - ROW));
    if (this.tagName === 'LI' && parent?.tagName === 'OL') {
      return rect([...parent.children].indexOf(this) * STEP, ROW);
    }
    return rect(0, 0);
  });
}

/** Where a row's top is, in the layout above: the middle of row `index` is `rowTop(index) + 20`. */
export const rowTop = (index: number) => index * STEP;

function fire(target: Element, type: string, dataTransfer: FakeDataTransfer, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => {
    target.dispatchEvent(event);
  });
}

/**
 * Starts dragging `handle` and moves the pointer to `clientY` over `over`, as
 * a browser would. Then `drop()` lets go there, or `cancel()` gives up.
 */
export async function dragFrom(handle: Element, over: Element, clientY: number) {
  const data = new FakeDataTransfer();
  fire(handle, 'dragstart', data, 0);
  // React Aria marks the row as dragged a frame later, once the browser has its picture.
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  fire(over, 'dragenter', data, clientY);
  // A move that changes nothing isn't reported, so the pointer moves on by a pixel.
  fire(over, 'dragover', data, clientY + 1);
  return {
    data,
    drop: () => {
      fire(over, 'drop', data, clientY + 1);
      fire(handle, 'dragend', data, clientY + 1);
    },
    cancel: () => {
      fire(handle, 'dragend', data, clientY + 1);
    },
  };
}
