import { groups, parts, SYSTEMS } from './registry';
import { defineBp3d, KEEP_PROCEDURAL } from './bp3d';
import { defineSkin } from './skin';
import { defineSkeleton } from './skeleton';
import { defineMuscles } from './muscles';
import { defineCardio } from './cardio';
import { defineNervous } from './nervous';
import { defineOrgans } from './organs';
import { defineLymphatic } from './lymphatic';
import { defineHeadNeck } from './headneck';

let defined = false;
export function defineAll() {
  if (!defined) {
    defined = true;
    defineSkin();
    defineSkeleton();
    defineMuscles();
    defineOrgans();
    defineCardio();
    defineNervous();
    defineLymphatic();
    defineHeadNeck();
    for (let i = parts.length - 1; i >= 0; i--) if (!KEEP_PROCEDURAL(parts[i].id)) parts.splice(i, 1);
    const used = new Set<string>(SYSTEMS.map((x) => x.id));
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const p of parts) for (let g = byId.get(p.parent); g; g = g.parent ? byId.get(g.parent) : undefined) used.add(g.id);
    for (let i = groups.length - 1; i >= 0; i--) if (!used.has(groups[i].id)) groups.splice(i, 1);
    defineBp3d();
  }
  return { groups, parts };
}
