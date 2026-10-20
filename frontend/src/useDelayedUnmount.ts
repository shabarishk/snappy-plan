import { useEffect, useState } from 'react';

export const POPUP_ANIMATION_DURATION_MS = 180;

export function useDelayedUnmount(isOpen: boolean): boolean {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      if (shouldRender) return;
      const timeout = window.setTimeout(() => setShouldRender(true), 0);
      return () => window.clearTimeout(timeout);
    }
    if (!shouldRender) return;

    const timeout = window.setTimeout(() => setShouldRender(false), POPUP_ANIMATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [isOpen, shouldRender]);

  return isOpen || shouldRender;
}
