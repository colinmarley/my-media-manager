import { useEffect } from 'react';

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Discard them?';

/**
 * While `when` is true, warn before the user leaves the page: a browser
 * prompt on reload/close, and a confirm on in-app link clicks (the Next app
 * router has no route-change event, so links are intercepted in the capture
 * phase before next/link handles them).
 */
export function useUnsavedChangesGuard(when: boolean, message = UNSAVED_CHANGES_MESSAGE) {
  useEffect(() => {
    if (!when) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return; // full navigation: beforeunload covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [when, message]);
}
