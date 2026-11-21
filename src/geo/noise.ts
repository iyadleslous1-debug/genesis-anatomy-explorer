// Classic 3D gradient (Perlin) noise, deterministic, worker-safe.
const perm = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

const G = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function grad(h: number, x: number, y: number, z: number) {
  const g = G[h & 15];
  return g[0] * x + g[1] * y + g[2] * z;
}

export function noise3(x: number, y: number, z: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
  const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
  const l1 = grad(perm[AA], x, y, z) + u * (grad(perm[BA], x - 1, y, z) - grad(perm[AA], x, y, z));
  const l2 = grad(perm[AB], x, y - 1, z) + u * (grad(perm[BB], x - 1, y - 1, z) - grad(perm[AB], x, y - 1, z));
  const l3 = grad(perm[AA + 1], x, y, z - 1) + u * (grad(perm[BA + 1], x - 1, y, z - 1) - grad(perm[AA + 1], x, y, z - 1));
  const l4 = grad(perm[AB + 1], x, y - 1, z - 1) + u * (grad(perm[BB + 1], x - 1, y - 1, z - 1) - grad(perm[AB + 1], x, y - 1, z - 1));
  const m1 = l1 + v * (l2 - l1);
  const m2 = l3 + v * (l4 - l3);
  return m1 + w * (m2 - m1);
}

export function fbm(x: number, y: number, z: number, oct = 3) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
