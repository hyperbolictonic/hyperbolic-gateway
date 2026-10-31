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
      menuPopupSelect?: (id: string, action?: string) => void;
      menuPopupClose?: () => void;
    };
  }).electronAPI;
  if (!host || !api) return;

  const render = (items: PopupMenuItem[]): void => {
    host.replaceChildren();
    const list = document.createElement('ul');
    list.className = 'menu menu-sm menu-popup-list';
    host.append(list);
    for (const item of items) {
      const row = document.createElement('li');
      row.className = 'menu-popup-row';
      const content = document.createElement('div');
      content.className = 'menu-popup-row-content';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-popup-item';
      button.disabled = Boolean(item.disabled);
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
      content.append(button);
      if (item.secondaryAction) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'btn btn-xs btn-soft btn-success menu-popup-action';
        action.textContent = item.secondaryAction.label;
        action.title = item.secondaryAction.title || item.secondaryAction.label;
        action.setAttribute('aria-label', item.secondaryAction.title || item.secondaryAction.label);
        action.addEventListener('click', (event) => {
          event.stopPropagation();
          api.menuPopupSelect?.(item.id, item.secondaryAction?.id);
        });
        content.append(action);
      }
      row.append(content);
      list.append(row);
    }
    (host.querySelector('.menu-popup-item:not(:disabled)') as HTMLElement | null)?.focus();
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
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.menu-popup-item:not(:disabled)'));
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? buttons[(index + 1 + buttons.length) % buttons.length]
        : buttons[(index - 1 + buttons.length) % buttons.length];
    next?.focus();
  });
}
