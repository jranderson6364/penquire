/**
 * Where each margin mark goes. A mark sits just right of its line; when that spot is taken (multi-column work, a
 * stack of short lines) it slides to the nearest free spot, so no two marks overlap and no mark covers another
 * line's ink. Pure and deterministic (unit-tested). All numbers are screen points.
 */
export type PlaceBox = { x: number; y: number; w: number; h: number };
export type PlaceItem = { id: string; box: PlaceBox; size: number; /** flagged marks claim their spot first */ priority: boolean };
export type Placed = { id: string; x: number; y: number };

const GAP = 4;

const hits = (a: PlaceBox, b: PlaceBox, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export function placeMarks(items: PlaceItem[], width: number, height: number): Placed[] {
  const order = [...items].sort((a, b) => Number(b.priority) - Number(a.priority) || a.box.y - b.box.y || a.box.x - b.box.x);
  const taken: PlaceBox[] = [];
  const out = new Map<string, Placed>();
  const ink = (id: string) => items.filter((o) => o.id !== id).map((o) => o.box);

  for (const it of order) {
    const { size } = it;
    const others = ink(it.id);
    const homeX = it.box.x + it.box.w + 8;
    const homeY = it.box.y + it.box.h / 2 - size / 2;
    const clampX = (x: number) => Math.max(2, Math.min(width - size - 2, x));
    const clampY = (y: number) => Math.max(2, Math.min(height - size - 2, y));

    let best: { x: number; y: number } | null = null;
    // nearest free spot: ring search over (dx, dy) steps, preferring small vertical moves, then small horizontal ones
    search: for (let dy = 0; dy <= 6; dy++) {
      for (const sy of dy === 0 ? [0] : [1, -1]) {
        for (let dx = 0; dx <= 4; dx++) {
          const cand = { x: clampX(homeX + dx * (size + GAP)), y: clampY(homeY + sy * dy * (size + GAP)) };
          const box = { ...cand, w: size, h: size };
          if (taken.some((t) => hits(box, t, GAP / 2))) continue;
          if (others.some((o) => hits(box, o))) continue;
          best = cand;
          break search;
        }
      }
    }
    // nothing free (very dense page): fall back to the home spot rather than hiding the verdict
    const pos = best ?? { x: clampX(homeX), y: clampY(homeY) };
    taken.push({ ...pos, w: size, h: size });
    out.set(it.id, { id: it.id, ...pos });
  }
  return items.map((it) => out.get(it.id)!);
}
