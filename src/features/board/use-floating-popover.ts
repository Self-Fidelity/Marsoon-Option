"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useFloatingPopover(open: boolean, width: number, onClose: () => void) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 8,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) onClose();
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeEscape);
    };
  }, [open, onClose]);

  return { anchorRef, popoverRef, position };
}
