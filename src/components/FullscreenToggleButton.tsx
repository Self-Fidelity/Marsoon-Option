"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

export function FullscreenToggleButton() {
  const [fullscreen, setFullscreen] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    setSupported(typeof document.documentElement.requestFullscreen === "function");
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The browser may reject fullscreen when the page is embedded.
    }
  };

  const label = fullscreen ? "退出全屏" : "进入全屏";
  return (
    <button
      type="button"
      disabled={!supported}
      onClick={() => void toggle()}
      className="ms-control grid size-9 place-items-center text-[var(--ms-text-secondary)] hover:text-[var(--ms-text-primary)] disabled:opacity-40"
      aria-label={label}
      title={label}
    >
      {fullscreen ? <Minimize2 size={15} strokeWidth={1.5} /> : <Maximize2 size={15} strokeWidth={1.5} />}
    </button>
  );
}
