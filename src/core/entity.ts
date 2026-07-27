export interface Pos {
  x: number;
  y: number;
}

/** Four stats, each with a distinct job. Speed drives both turn order and range. */
export interface Stats {
  hp: number;
  might: number;
  wits: number;
  speed: number;
}

export interface Entity {
  id: string;
  kind: string;
  pos: Pos;
  stats: Stats;
  tags: string[];
  /** Where this entity was born — set at WORLD_INIT for everything, read by
   *  the warden's vigil (the leash is anchored to the post, not to wherever
   *  the chase has dragged it). A universal fact rather than a warden field,
   *  because "where were you placed" is true of every creature and deriving
   *  it later would mean folding from the root to answer a question the
   *  state can simply carry. */
  post?: Pos;
  /**
   * What is worn, by slot. Optional so the many hand-built fixtures that
   * predate equipment stay valid; absent means bare. Replacement arithmetic
   * lives in apply's ITEM_TAKEN — the only writer.
   */
  gear?: Readonly<Partial<Record<string, { kind: string; grants: Stats }>>>;
  /**
   * The one thing carried to use rather than wear. Absent means empty hands.
   * Walk-over swaps (the old one stays on the tile); one key spends it.
   */
  satchel?: { readonly kind: string };
  /**
   * The most hit points this entity can hold.
   *
   * Derived, never carried in an event: it is `stats.hp` at WORLD_INIT, raised
   * by anything that grants hp. It exists because healing needs a ceiling —
   * without one, "recover 1 when nothing is near" becomes unbounded hit points
   * for anyone willing to hold still long enough, and that is not a rule a
   * player could sensibly agree to.
   */
  maxHp: number;
}

export function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

export function isAlive(entity: Entity): boolean {
  return entity.stats.hp > 0;
}
