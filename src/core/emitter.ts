type Listener<T> = (payload: T) => void | Promise<void>;

/**
 * A small typed event emitter. A listener that throws, or whose promise
 * rejects, never breaks the emitter: the failure goes to the `error` event.
 */
export class Emitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();
  readonly #wrapError: (error: unknown) => unknown;

  /**
   * @param wrapError - Shapes what a failing listener sends to the `error`
   * event, for emitters whose `error` payload is not the bare error.
   */
  constructor(wrapError: (error: unknown) => unknown = (error) => error) {
    this.#wrapError = wrapError;
  }

  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  /** Subscribes for a single occurrence. */
  once<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    const off = this.on(event, (payload) => {
      off();
      return listener(payload);
    });
    return off;
  }

  /** Removes a listener. */
  off<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): void {
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
        const result = (listener as Listener<Events[K]>)(payload);
        // An async listener fails later: catch that too, or it becomes an unhandled rejection.
        if (result && typeof result.then === "function") result.then(undefined, (error: unknown) => this.#report(event, error));
      } catch (error) {
        this.#report(event, error);
      }
    }
  }

  #report(event: keyof Events, error: unknown): void {
    // An "error" listener that fails must not loop back into itself.
    if (event === "error" || !this.hasListeners("error" as keyof Events)) return;
    this.emit("error" as keyof Events, this.#wrapError(error) as Events[keyof Events]);
  }
}
