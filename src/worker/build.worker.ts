/// <reference lib="webworker" />
import { defineAll } from '../anatomy';
import { warpGeo } from '../geo/warp';
import { computeWeights } from '../geo/weights';

export interface PartMsg {
  type: 'part';
  id: string;
  center: [number, number, number];
  pos: Float32Array;
  nor: Float32Array;
  idx: Uint32Array;
  attrs: Record<string, { data: Float32Array; size: number }>;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

self.onmessage = (e: MessageEvent<{ ids: string[] }>) => {
  const { parts } = defineAll();
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const id of e.data.ids) {
    const def = byId.get(id);
    if (!def || def.external) continue;
    try {
      const g = def.build();
      warpGeo(g.pos, g.nor, g.idx);
      const n = g.pos.length / 3;
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
        if (x < lx) lx = x; if (x > hx) hx = x;
        if (y < ly) ly = y; if (y > hy) hy = y;
        if (z < lz) lz = z; if (z > hz) hz = z;
      }
      const c: [number, number, number] = n ? [(lx + hx) / 2, (ly + hy) / 2, (lz + hz) / 2] : [0, 0, 0];
      const sk = computeWeights(id, def.system, def.tissue, g.pos, c);
      for (let i = 0; i < n; i++) {
        g.pos[i * 3] -= c[0];
        g.pos[i * 3 + 1] -= c[1];
        g.pos[i * 3 + 2] -= c[2];
      }
      const attrs = g.attrs ?? {};
      const msg: PartMsg = { type: 'part', id, center: c, pos: g.pos, nor: g.nor, idx: g.idx, attrs, skinIndex: sk.idx, skinWeight: sk.w };
      const transfer: Transferable[] = [g.pos.buffer, g.nor.buffer, g.idx.buffer, sk.idx.buffer, sk.w.buffer, ...Object.values(attrs).map((a) => a.data.buffer)];
      (self as unknown as Worker).postMessage(msg, transfer);
    } catch (err) {
      (self as unknown as Worker).postMessage({ type: 'error', id, message: String((err as Error)?.stack ?? err) });
    }
  }
  (self as unknown as Worker).postMessage({ type: 'done' });
};
