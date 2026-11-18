/**
 * A value kept in step with the main process: loaded once when first used,
 * then updated by its events. Every component reading it shares one copy.
 */
export function liveStore<T>(
  initial: T,
  connect: (set: (value: T) => void) => void,
) {
  let value = initial;
  let connected = false;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    value = next;
    listeners.forEach((listener) => listener());
  };
  return {
    get: () => value,
    set,
    subscribe(listener: () => void) {
      if (!connected) {
        connected = true;
        connect(set);
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
