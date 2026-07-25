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
}

export function findEntity(entities: readonly Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

export function isAlive(entity: Entity): boolean {
  return entity.stats.hp > 0;
}
