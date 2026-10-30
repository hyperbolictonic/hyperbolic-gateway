/**
 * Popup-menu surface. Rendered only in the MenuPopup window (URL carries
 * ?menupopup=1). Items arrive pushed from the main process; a click reports
 * the item id back and the host window resolves. Escape or blur dismisses.
 *
 * Every themed dropdown in the app shares this surface and the CSS of
 * #menu-popup-host, so new menus are just a PopupMenuItem array in main.
 */
import type { PopupMenuItem } from '../shared/menu.js';

export function bootMenuPopup(): void {
  const host = document.getElementById('menu-popup-host');
  const api = (window as unknown as {
    electronAPI?: {
      getMenuPopupItems?: () => Promise<PopupMenuItem[]>;
      onMenuPopupShow?: (cb: (items: PopupMenuItem[]) => void) => () => void;
      menuPopupSelect?: (id: string) => void;
      menuPopupClose?: () => void;
    };
  }).electronAPI;
  if (!host || !api) return;

  const render = (items: PopupMenuItem[]): void => {
    host.replaceChildren();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-popup-item';
      const label = document.createElement('span');
      label.className = 'menu-popup-label';
      label.textContent = item.label;
      button.append(label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-popup-hint';
        hint.textContent = item.hint;
        button.append(hint);
      }
      button.addEventListener('click', () => api.menuPopupSelect?.(item.id));
      host.append(button);
    }
    (host.querySelector('.menu-popup-item') as HTMLElement | null)?.focus();
  };

  api.onMenuPopupShow?.(render);
  void api.getMenuPopupItems?.().then((items) => {
    if (items.length) render(items);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      api.menuPopupClose?.();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.menu-popup-item'));
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? buttons[(index + 1 + buttons.length) % buttons.length]
        : buttons[(index - 1 + buttons.length) % buttons.length];
    next?.focus();
  });
}
