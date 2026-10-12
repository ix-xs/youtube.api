type Listener<T> = (payload: T) => void;

/** A small typed event emitter. A listener that throws never breaks the emitter. */
export class Emitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  /** Subscribes for a single occurrence. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  /** Removes a listener. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.#listeners.get(event)?.delete(listener as Listener<never>);
  }

  /** Whether anyone listens to `event`. */
  hasListeners(event: keyof Events): boolean {
    return (this.#listeners.get(event)?.size ?? 0) > 0;
  }

  /** @internal */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        // An "error" listener that throws must not loop back into itself.
        if (event !== "error" && this.#listeners.get("error" as keyof Events)?.size) {
          this.emit("error" as K, error as Events[K]);
        }
      }
    }
  }
}
