import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalPortalProps {
  children: ReactNode;
}

let activeModalCount = 0;
let previousBodyOverflow = "";

export default function ModalPortal({ children }: ModalPortalProps) {
  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (activeModalCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
    }
    activeModalCount += 1;
    document.body.style.overflow = "hidden";
    const modalOverlays = document.body.querySelectorAll<HTMLElement>(".jurisguard-modal-overlay");
    const focusTarget = modalOverlays[modalOverlays.length - 1];

    if (focusTarget) {
      focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
    }

    return () => {
      activeModalCount = Math.max(activeModalCount - 1, 0);
      if (activeModalCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
      previousActiveElement?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(children, document.body);
}
