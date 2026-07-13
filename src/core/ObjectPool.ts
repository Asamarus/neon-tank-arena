/** Reuses short-lived entities to reduce garbage collection during combat. */
export class ObjectPool<T extends object> {
  /** Stores the free. */
  private readonly free: T[] = []
  /** Stores the factory. */
  private readonly factory: () => T

  /** Creates a new ObjectPool instance. */
  public constructor(factory: () => T) {
    this.factory = factory
  }

  /** Returns a recycled entity, or creates one when the pool is empty. */
  public acquire(): T {
    return this.free.pop() ?? this.factory()
  }

  /** Returns an entity to the pool for reuse by a later frame. */
  public release(item: T): void {
    this.free.push(item)
  }
}
