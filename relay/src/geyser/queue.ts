/**
 * A promise-based push/pull queue that bridges a callback- or event-driven
 * producer — a gRPC stream, an interval timer — into a `for await` consumer.
 *
 * Producers call `push` / `end` / `fail`; the consumer iterates the queue as
 * an async iterable, drained in FIFO order. Both geyser sources use it so the
 * consumer side behaves identically regardless of which source is wired in.
 */
export class AsyncQueue<T> implements AsyncIterableIterator<T> {
  private readonly buffered: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended = false;
  private failure: { error: unknown } | null = null;

  /** Hand a value to the consumer. No-op once the queue is ended or failed. */
  push(value: T): void {
    if (this.ended || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      this.buffered.push(value);
    }
  }

  /** Terminate the stream cleanly. Buffered values are still drained first. */
  end(): void {
    if (this.ended || this.failure) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  /** Terminate the stream with an error surfaced to the consumer. */
  fail(error: unknown): void {
    if (this.ended || this.failure) return;
    this.failure = { error };
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.buffered.length > 0) {
      return Promise.resolve({ value: this.buffered.shift() as T, done: false });
    }
    if (this.failure) {
      return Promise.reject(this.failure.error);
    }
    if (this.ended) {
      return Promise.resolve({ value: undefined as never, done: true });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** Called by the runtime when the consumer breaks out of its `for await`. */
  return(): Promise<IteratorResult<T>> {
    this.end();
    return Promise.resolve({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}
