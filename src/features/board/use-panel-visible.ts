import { useSyncExternalStore } from "react";
import type { IDockviewPanelProps } from "dockview-react";

export function usePanelVisible(api: IDockviewPanelProps["api"]): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const disposable = api.onDidVisibilityChange(onStoreChange);
      return () => disposable.dispose();
    },
    () => api.isVisible,
    () => true,
  );
}
