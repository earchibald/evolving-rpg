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
