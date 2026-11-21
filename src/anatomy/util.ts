import type { Shape } from '../geo/sdf';
import { meshShape, Geo } from '../geo/mesher';
import { clamp } from '../geo/math';

export function autoCell(s: Shape, div = 70, min = 0.0007, max = 0.003) {
  const e = Math.max(s.hi[0] - s.lo[0], s.hi[1] - s.lo[1], s.hi[2] - s.lo[2]);
  return clamp(e / div, min, max);
}

export function meshAuto(s: Shape, div = 70, min = 0.0007, max = 0.003): Geo {
  return meshShape(s, autoCell(s, div, min, max));
}

export const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
export const lc = (s: string) => s.toLowerCase();
