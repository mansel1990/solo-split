type Undo = { label: string; run: () => Promise<void> };

let pending: Undo | null = null;
const undoListeners = new Set<() => void>();
const dataListeners = new Set<() => void>();

export function queueUndo(label: string, run: () => Promise<void>): void {
  pending = {
    label,
    run: async () => {
      await run();
      notifyDataChanged();
    },
  };
  undoListeners.forEach((listener) => listener());
}

export function takeUndo(): Undo | null {
  const undo = pending;
  pending = null;
  return undo;
}

export function subscribeUndo(listener: () => void): () => void {
  undoListeners.add(listener);
  return () => undoListeners.delete(listener);
}

export function notifyDataChanged(): void {
  dataListeners.forEach((listener) => listener());
}

export function subscribeData(listener: () => void): () => void {
  dataListeners.add(listener);
  return () => dataListeners.delete(listener);
}
