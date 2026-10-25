/*
 * A field inside a closed list item is in the page but hidden (the item's
 * panel is `hidden="until-found"`). Going to it — from the error summary or
 * the notes drawer — first asks every closed item around it to open: the
 * event bubbles from the field through each list it's nested in, and each
 * list opens the item it passes through (DECISIONS.md, "Top-level groups are
 * sections, and list items are rows that open in place").
 */

export const REVEAL_EVENT = 'vesper:reveal';

/** True while `element` or something around it is hidden: a closed item or a closed Details. */
function isHidden(element: Element): boolean {
  return element.closest('[hidden]') !== null;
}

/**
 * Focuses an element as soon as it's on screen (a field inside Details
 * renders once Details opens; one inside a closed list item shows once the
 * item opens), and scrolls it into view.
 */
export function focusWhenShown(id: string, tries = 20, asked = false): void {
  const element = document.getElementById(id);
  if (element && !isHidden(element)) {
    element.scrollIntoView({ block: 'center' });
    element.focus();
    return;
  }
  if (element && !asked) {
    element.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
    asked = true;
  }
  if (tries > 0) {
    setTimeout(() => {
      focusWhenShown(id, tries - 1, asked);
    }, 25);
  }
}
