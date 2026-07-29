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
  /** How this creature holds its ground when nothing is hunted (WORLD_INIT
   *  v10). Guards own a place — the vigil's homeward half, generalized;
   *  wanderers walk their recorded route. Absent means the old stillness. */
  disposition?: 'guard' | 'wander';
  /** The wanderer's round, recorded at birth. */
  route?: readonly Pos[];
  /** Which waypoint the round heads for next. Advanced by the reducer when
   *  a step lands on any waypoint (derived, silent, replay-exact — the
   *  venom precedent); decide() only ever reads it. */
  leg?: number;
  /** The mimic's costume (WORLD_INIT v11): the item kind it wears on the
   *  map while the `hidden` tag stands. A fact of birth — it stays after
   *  the unmasking; only the tag decides who is fooled. */
  guise?: string;
  /** The one scroll carried (v13): read with r, spent by the reading,
   *  swapped with , like everything the hands hold. Absent is empty. */
  scroll?: { readonly kind: string };
  /** What this creature carries to its grave (v14): set at birth, spilled
   *  by the reducer where the body falls — derived, silent, any death. */
  pocket?: { readonly kind: string; readonly grants: Stats };
  /**
   * What is worn, by slot. Optional so the many hand-built fixtures that
   * predate equipment stay valid; absent means bare. Replacement arithmetic
   * lives in apply's ITEM_TAKEN — the only writer.
   */
  gear?: Readonly<Partial<Record<string, { kind: string; grants: Stats }>>>;
  /**
   * What is carried to use rather than wear — up to two things, in order
   * (the designer's second slot, 2026-07-28). Absent means empty hands.
   * Walking fills the first empty slot; full hands refuse the walk-over
   * and the , key swaps the first out onto the tile. q spends the first,
   * Q the second; spending the first moves the second up. Duplicates are
   * welcome: two flares are two flares.
   */
  satchel?: readonly { readonly kind: string }[];
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
