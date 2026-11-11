import { create } from 'zustand';

export const SHELL_COLLAPSED_STORAGE_KEY = 'mmm.shell.sidebarCollapsed';

interface ShellState {
  /** Desktop sidebar shrunk to an icon rail. Persisted per browser. */
  collapsed: boolean;
  /** Temporary drawer open (below the `md` breakpoint). Not persisted. */
  mobileOpen: boolean;
  /** True once `hydrate` has read localStorage (avoids an SSR mismatch). */
  hydrated: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setMobileOpen: (open: boolean) => void;
  hydrate: () => void;
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SHELL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SHELL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the
    // preference then just lasts for this page load.
  }
}

const useShellStore = create<ShellState>((set, get) => ({
  collapsed: false,
  mobileOpen: false,
  hydrated: false,
  setCollapsed: (collapsed) => {
    writeCollapsed(collapsed);
    set({ collapsed });
  },
  toggleCollapsed: () => get().setCollapsed(!get().collapsed),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
  hydrate: () => {
    if (get().hydrated) return;
    set({ collapsed: readCollapsed(), hydrated: true });
  },
}));

export default useShellStore;
