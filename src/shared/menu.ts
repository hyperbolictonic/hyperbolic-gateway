/** Shared types for the themed popup menu and the deck surface state. */

/** One row of a themed popup menu (rendered by src/renderer/menu-popup.ts). */
export interface PopupMenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  secondaryAction?: {
    id: string;
    label: string;
    title?: string;
  };
}

export interface PopupMenuSelection {
  id: string;
  action?: string;
}

/** Where a popup should anchor, in shell content-area coordinates. */
export interface PopupAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Authoritative deck-surface state; native bounds and DOM classes derive from it. */
export interface SidebarSurfaceState {
  mode: 'docked' | 'floating' | 'collapsed';
  /** Radial petal menu stage is open (collapsed mode only). */
  menuOpen: boolean;
  /** Collab mode: the orb is replaced by the collaborations toolbar (collapsed only). */
  collabMode: boolean;
  /** Experimental flag: when false, collab entry points are hidden and inert. */
  collabEnabled: boolean;
  orbEdge: 'left' | 'right';
}
