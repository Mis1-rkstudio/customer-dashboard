// src/hooks/use-outside-click.tsx
import { useEffect } from "react";

export function useOutsideClick<T extends HTMLElement = HTMLElement>(
  ref: React.RefObject<T | null>,
  callback: (event?: MouseEvent | TouchEvent) => void
): void {
  useEffect(() => {
    function listener(event: Event) {
      // event.target is EventTarget | null — cast to Node for .contains
      const target = event.target as Node | null;
      if (!ref.current || !target) return;
      // If clicked inside the ref, do nothing
      if (ref.current.contains(target)) return;

      // Cast the event to union for callback consumers
      callback(event as MouseEvent | TouchEvent);
    }

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, callback]);
}
