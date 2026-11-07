// The virtual office, without any 3D: the floor plan, how people find their way around it, and what each professional does (work at their desk, or
// wander, drink coffee, sit on the sofa, join the meeting table...). Pure logic, no THREE and no DOM, so Node tests can run it.
//
// Units are metres. x runs east, z runs south (towards the camera), y is up. A heading h points along (sin h, cos h): 0 faces south (+z, the camera),
// PI/2 faces east (+x). The floor is 30 x 20; the camera looks at it from the south-east, so the north and west walls are the backdrop.

export const CELL = 0.5;
export const FLOOR = { x0: -15, x1: 15, z0: -10, z1: 10 };
const PI = Math.PI;
const AGENT_RADIUS = 0.25;
const EDGE_MARGIN = 0.35;

// ---- who sits where: the desk centre of each professional (two teams, four columns of desks)
export const DESKS = {
  po: [-11.5, -7.5], ba: [-11.5, -5], designer: [-11.5, -2.5], delivery: [-11.5, 0],
  engineer: [-7.5, -7.5], qa: [-7.5, -5], devops: [-7.5, -2.5],
  brand: [-2.5, -7.5], planner: [-2.5, -5], smm: [-2.5, -2.5],
  community: [1.5, -7.5], copywriter: [1.5, -5], analyst: [1.5, -2.5],
};
export const ZONES = [{ name: "Software House", x: -9.5 }, { name: "Social Media", x: -0.5 }];

/** A desk, its chair and the way in: the person sits west of the desk facing east, and comes in from the aisle. */
export function deskOf(id) {
  const [x, z] = DESKS[id];
  return { x, z, seat: { x: x - 0.85, z }, approach: { x: x - 2.25, z }, heading: PI / 2, block: { x0: x - 1.3, x1: x + 0.45, z0: z - 0.85, z1: z + 0.85 } };
}

// ---- what they look like (taken from their photos in personas/): skin, hair and its style, the jacket and the shirt under it
export const LOOKS = {
  po: { skin: "#d4a373", hair: "#1b1b1f", style: "short", jacket: "#1f3a5f", inner: "#a9c1de", pants: "#2b3445" },
  ba: { skin: "#c99a6e", hair: "#2a1c16", style: "wavy", jacket: "#1f3a5f", inner: "#f1e6d3", pants: "#2b3445", female: true },
  engineer: { skin: "#d4a373", hair: "#17171a", style: "short", jacket: "#22304d", inner: "#2f3a46", pants: "#1f2937" },
  qa: { skin: "#ecc9a6", hair: "#14121a", style: "long", jacket: "#1f3a5f", inner: "#f4f1ea", pants: "#2b3445", glasses: true, female: true },
  designer: { skin: "#ecc9a6", hair: "#241a1a", style: "bob", jacket: "#5b6b3a", inner: "#3a3a3f", pants: "#2f3342", glasses: true, female: true },
  devops: { skin: "#c99a6e", hair: "#141416", style: "short", jacket: "#1e2f4f", inner: "#4b5563", pants: "#1f2937" },
  delivery: { skin: "#c99a6e", hair: "#2b1b17", style: "wavy", jacket: "#1f3a5f", inner: "#f1e6d3", pants: "#2b3445", female: true },
  brand: { skin: "#b98258", hair: "#141416", style: "short", beard: true, jacket: "#3b4048", inner: "#16161a", pants: "#23262d" },
  planner: { skin: "#e0b48e", hair: "#3a2418", style: "long", jacket: "#1f5a45", inner: "#f1e6d3", pants: "#2b3445", female: true },
  smm: { skin: "#ecc9a6", hair: "#3b2417", style: "wavy", jacket: "#1f3a5f", inner: "#f4f1ea", pants: "#2b3445", female: true },
  community: { skin: "#c99a6e", hair: "#17171a", style: "short", jacket: "#243b66", inner: "#243b66", pants: "#2f3342" },
  copywriter: { skin: "#c08a5f", hair: "#2a1c16", style: "wavy", jacket: "#9a4a2a", inner: "#6b7280", pants: "#2b3445", female: true },
  analyst: { skin: "#d4a373", hair: "#17171a", style: "short", jacket: "#1e2f55", inner: "#1e2f55", pants: "#2f3342" },
};

// ---- the furniture. block is the footprint people cannot walk through (true: the item's own box; or a rectangle; false: you can walk over it).
const box = (cx, cz, w, d) => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
const item = (type, x, z, w, d, extra = {}) => ({ type, x, z, w, d, block: true, ...extra });

export const FURNITURE = [
  // the desks, one per professional (the footprint covers the chair too)
  ...Object.keys(DESKS).map((id) => { const d = deskOf(id); return item("workstation", d.x, d.z, 0.9, 1.7, { id, block: d.block }); }),
  // lounge, north-east: a sofa against the wall, a coffee table in front, two armchairs
  item("rug", 10.5, -6.2, 5.6, 4.2, { block: false, color: "#c9b79c" }),
  item("sofa", 10.5, -8.9, 3.4, 1.0, { face: "s" }),
  item("coffeetable", 10.5, -6.3, 1.6, 0.8),
  item("armchair", 7.0, -7.2, 0.95, 0.95, { face: "e" }),
  item("armchair", 13.8, -7.2, 0.95, 0.95, { face: "w" }),
  item("tv", 10.5, -9.85, 1.9, 0.1, { block: false }),
  // meeting corner, south-west: a glass wall on the north side with a door gap, a long table, a whiteboard on the west wall
  item("rug", -11, 6.1, 5.4, 3.6, { block: false, color: "#aab4c0" }),
  item("glass", -12.25, 3.4, 5.3, 0.1),
  item("meetingtable", -11, 6.2, 3.4, 1.2, { block: box(-10.95, 6.2, 5.1, 2.5) }),
  item("whiteboard", -14.9, 6.2, 0.1, 2.4, { block: false }),
  item("shelf", -14.75, 2.2, 0.4, 1.8),
  // pantry and corners, south-east
  item("counter", 11.5, 5.8, 3.2, 0.9),
  item("cooler", 7.2, 3.3, 0.5, 0.5),
  item("printertable", 4.5, 3.2, 1.2, 0.6),
  // plants
  ...[[7.0, -9.4], [14.3, -9.4], [-14.3, -9.4], [4.0, -9.4], [-0.5, 3.0], [6.0, 8.9], [14.3, 2.0], [-6.8, 9.0], [14.3, 9.2], [2.2, 0.8], [-5.2, 4.6]]
    .map(([x, z]) => item("plant", x, z, 0.6, 0.6)),
];
export const furnitureBlocks = () => FURNITURE.filter((f) => f.block).map((f) => (f.block === true ? box(f.x, f.z, f.w, f.d) : f.block));

// ---- places to go when there is nothing to do: where to stand or sit, how to face, and the spot you walk to first (approach)
const seatsRow = (kind, xs, z, az, heading) => xs.map((x, i) => ({ id: `${kind}-${i + 1}`, kind, seat: { x, z }, approach: { x, z: az }, heading }));
export const POIS = [
  ...seatsRow("sofa", [9.3, 10.5, 11.7], -8.8, -7.75, 0),
  { id: "armchair-1", kind: "armchair", seat: { x: 7.0, z: -7.2 }, approach: { x: 5.9, z: -7.2 }, heading: PI / 2 },
  { id: "armchair-2", kind: "armchair", seat: { x: 13.8, z: -7.2 }, approach: { x: 12.75, z: -7.2 }, heading: -PI / 2 },
  ...seatsRow("meeting", [-12.2, -11, -9.8], 5.25, 4.2, 0),
  { id: "meeting-4", kind: "meeting", seat: { x: -13.1, z: 6.2 }, approach: { x: -14.25, z: 6.75 }, heading: PI / 2 },
  { id: "meeting-5", kind: "meeting", seat: { x: -8.9, z: 6.2 }, approach: { x: -7.8, z: 6.2 }, heading: -PI / 2 },
  ...[10.4, 11.6, 12.6].map((x, i) => ({ id: `coffee-${i + 1}`, kind: "coffee", stand: { x, z: 4.75 }, heading: 0 })),
  { id: "cooler-1", kind: "cooler", stand: { x: 7.2, z: 2.3 }, heading: 0 },
  { id: "printer-1", kind: "printer", stand: { x: 4.5, z: 2.3 }, heading: 0 },
  { id: "whiteboard-1", kind: "whiteboard", stand: { x: -14.25, z: 5.25 }, heading: -PI / 2 },
  { id: "shelf-1", kind: "shelf", stand: { x: -13.75, z: 2.2 }, heading: -PI / 2 },
  ...[[-5.5, 3.8, 0.4], [-2.5, 6, -0.6], [0.8, 8.4, 2.4], [4.5, 6.8, 0.8], [-5.2, 8.2, 3.5], [3.2, 0.9, 1.2], [7, -3.6, -2.2], [-0.5, -0.2, 0.2], [10, 0.5, 2.8], [13, -1, -1.2], [8.8, 8.3, 0], [-9, 1.5, 1.5]]
    .map(([x, z, heading], i) => ({ id: `spot-${i + 1}`, kind: "stand", stand: { x, z }, heading })),
];
// what each kind of place is for: the pose, how long people stay (seconds) and how likely it is to be picked
export const ACTIVITIES = {
  sofa: { action: "relax", seat: true, dur: [12, 28], weight: 3 },
  armchair: { action: "relax", seat: true, dur: [12, 24], weight: 2 },
  meeting: { action: "talk", seat: true, dur: [12, 26], weight: 2 },
  coffee: { action: "drink", dur: [8, 14], weight: 3 },
  cooler: { action: "drink", dur: [5, 9], weight: 1 },
  printer: { action: "point", dur: [5, 9], weight: 1 },
  whiteboard: { action: "point", dur: [8, 16], weight: 1 },
  shelf: { action: "read", dur: [8, 14], weight: 1 },
  stand: { action: "look", dur: [3, 8], weight: 2 },
};
export const placeOf = (poi) => (poi.seat ? poi.approach : poi.stand);

// ---- the walkable grid: a cell is free when nothing (grown by the width of a person) overlaps it
export function buildGrid(blocks = furnitureBlocks()) {
  const nx = Math.round((FLOOR.x1 - FLOOR.x0) / CELL), nz = Math.round((FLOOR.z1 - FLOOR.z0) / CELL);
  const blocked = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = FLOOR.x0 + i * CELL, x1 = x0 + CELL, z0 = FLOOR.z0 + j * CELL, z1 = z0 + CELL;
    let b = x0 < FLOOR.x0 + EDGE_MARGIN || x1 > FLOOR.x1 - EDGE_MARGIN || z0 < FLOOR.z0 + EDGE_MARGIN || z1 > FLOOR.z1 - EDGE_MARGIN;
    for (let k = 0; !b && k < blocks.length; k++) {
      const r = blocks[k];
      b = x0 < r.x1 + AGENT_RADIUS && x1 > r.x0 - AGENT_RADIUS && z0 < r.z1 + AGENT_RADIUS && z1 > r.z0 - AGENT_RADIUS;
    }
    blocked[j * nx + i] = b ? 1 : 0;
  }
  return { nx, nz, blocked };
}
const cellOf = (g, x, z) => ({ i: Math.floor((x - FLOOR.x0) / CELL), j: Math.floor((z - FLOOR.z0) / CELL) });
export function isFree(g, x, z) {
  const { i, j } = cellOf(g, x, z);
  return i >= 0 && j >= 0 && i < g.nx && j < g.nz && !g.blocked[j * g.nx + i];
}
const centre = (i, j) => ({ x: FLOOR.x0 + (i + 0.5) * CELL, z: FLOOR.z0 + (j + 0.5) * CELL });

function nearestFree(g, x, z) {
  const c = cellOf(g, x, z);
  for (let r = 0; r < 12; r++) {
    let best = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = c.i + di, j = c.j + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || g.blocked[j * g.nx + i]) continue;
      const p = centre(i, j), d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = { i, j }; }
    }
    if (best) return best;
  }
  return null;
}

function lineClear(g, a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 0.1));
  for (let k = 0; k <= n; k++) if (!isFree(g, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)) return false;
  return true;
}

/** A shortest walk from one point to another around the furniture, as waypoints (the start is not included, the end is exactly `to`); null when there is none. */
export function findPath(g, from, to) {
  const s = nearestFree(g, from.x, from.z), t = nearestFree(g, to.x, to.z);
  if (!s || !t) return null;
  const N = g.nx * g.nz, id = (i, j) => j * g.nx + i;
  const gs = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; // [f, index]
  const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const h = (i, j) => { const dx = Math.abs(i - t.i), dz = Math.abs(j - t.j); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
  gs[id(s.i, s.j)] = 0; push(h(s.i, s.j), id(s.i, s.j));
  const goal = id(t.i, t.j);
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) break;
    const i = k % g.nx, j = (k / g.nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz || g.blocked[id(ni, nj)]) continue;
      if (di && dj && (g.blocked[id(i + di, j)] || g.blocked[id(i, j + dj)])) continue; // no squeezing between two corners
      const nk = id(ni, nj), cost = gs[k] + (di && dj ? Math.SQRT2 : 1);
      if (cost < gs[nk]) { gs[nk] = cost; prev[nk] = k; push(cost + h(ni, nj), nk); }
    }
  }
  if (prev[goal] < 0 && goal !== id(s.i, s.j)) return null;
  const cells = [];
  for (let k = goal; k >= 0; k = prev[k]) { cells.push(centre(k % g.nx, (k / g.nx) | 0)); if (k === id(s.i, s.j)) break; }
  cells.reverse();
  const pts = [{ x: from.x, z: from.z }, ...cells.slice(1, -1), { x: to.x, z: to.z }];
  // pull the string tight: skip every waypoint that can be passed in a straight line
  const out = [];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !lineClear(g, pts[a], pts[b])) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

// ---- the simulation
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wrap = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const turnToward = (cur, target, step) => { const d = wrap(target - cur); return Math.abs(d) <= step ? target : cur + Math.sign(d) * step; };
const ease = (t) => t * t * (3 - 2 * t);
const WALK_SPEED = 1.45;
const AFTER_WORK = 3.2;   // seconds a professional stays at the desk after finishing, with the "done" flash, before getting up

/**
 * ids: the professionals. inputs per update: { [id]: { busy, selected } } (busy: an answer is being written; selected: the user is chatting with them),
 * env: { lookHeading } (the direction that faces the camera). Read each person with snapshot(id); drainEvents() gives {type:"start"|"done", id}.
 */
export function createSim({ ids, seed = 7, wander = true }) {
  const rng = mulberry32(seed);
  const state = { wander };
  const grid = buildGrid();
  const agents = new Map();
  const taken = new Map(); // place id -> who is there or on the way
  const events = [];
  const between = ([a, b]) => a + rng() * (b - a);
  const desks = Object.fromEntries(ids.map((id) => [id, deskOf(id)]));

  const release = (a) => { if (a.poi && taken.get(a.poi) === a.id) taken.delete(a.poi); a.poi = null; };
  const startRoute = (a, to, then) => {
    const path = findPath(grid, { x: a.x, z: a.z }, to);
    if (!path) { a.mode = "stand"; a.timer = 1.5; a.then = null; return false; }
    a.path = path; a.mode = "walk"; a.then = then; return true;
  };
  const slideTo = (a, to, heading, sitFrom, sitTo, mode, then) => {
    a.mode = mode; a.then = then;
    a.slide = { t: 0, dur: 0.8, from: { x: a.x, z: a.z }, to, h0: a.heading, h1: heading, s0: sitFrom, s1: sitTo };
  };
  const sitDown = (a, spot, key, action, duration) => {
    a.poi = key; a.approach = spot.approach; a.seatHeading = spot.heading;
    slideTo(a, spot.seat, spot.heading, a.sit, 1, "slideIn", () => { a.mode = "seated"; a.action = action; a.timer = duration; });
  };
  const standUp = (a, then) => {
    const to = a.approach ?? { x: a.x, z: a.z };
    slideTo(a, to, a.heading, a.sit, 0, "slideOut", () => { a.mode = "stand"; a.timer = 0.4; a.action = "idle"; a.then = null; if (then) then(); });
  };
  const goDesk = (a) => {
    const d = desks[a.id];
    release(a);
    a.poi = "desk:" + a.id;
    a.goal = "work";
    startRoute(a, d.approach, () => sitDown(a, d, a.poi, "type", Infinity));
  };

  const choosePlace = (a) => {
    const free = POIS.filter((p) => !taken.has(p.id));
    const total = free.reduce((s, p) => s + ACTIVITIES[p.kind].weight * (p.kind === a.lastKind ? 0.15 : 1), 0);
    let r = rng() * total, pick = free[0];
    for (const p of free) { r -= ACTIVITIES[p.kind].weight * (p.kind === a.lastKind ? 0.15 : 1); if (r <= 0) { pick = p; break; } }
    return pick;
  };
  const goSomewhere = (a) => {
    const p = choosePlace(a);
    if (!p) { a.timer = 2; return; }
    const act = ACTIVITIES[p.kind];
    taken.set(p.id, a.id); a.poi = p.id; a.lastKind = p.kind; a.goal = null;
    const dur = between(act.dur);
    if (p.seat) {
      startRoute(a, p.approach, () => sitDown(a, p, p.id, act.action, dur));
    } else {
      startRoute(a, p.stand, () => { a.mode = "stand"; a.action = act.action; a.timer = dur; a.faceTo = p.heading; a.atPlace = true; });
    }
  };

  const add = (id) => {
    const a = { id, x: 0, z: 0, heading: 0, speed: 0, sit: 0, action: "idle", mode: "stand", path: [], then: null, slide: null, timer: 1 + rng() * 3, poi: null, approach: null, goal: null, wasBusy: false, after: 0, attn: 0, faceTo: null, lastKind: null, atPlace: false, seatHeading: 0 };
    // start somewhere: standing at a free place, already in the middle of an activity
    const p = choosePlace(a);
    taken.set(p.id, id); a.poi = p.id; a.lastKind = p.kind;
    const act = ACTIVITIES[p.kind];
    if (p.seat) { a.x = p.seat.x; a.z = p.seat.z; a.heading = p.heading; a.sit = 1; a.mode = "seated"; a.approach = p.approach; a.action = act.action; a.timer = between(act.dur) * rng(); }
    else { a.x = p.stand.x; a.z = p.stand.z; a.heading = p.heading; a.mode = "stand"; a.atPlace = true; a.faceTo = p.heading; a.action = act.action; a.timer = between(act.dur) * rng(); }
    agents.set(id, a);
  };
  ids.forEach(add);

  const step = (a, dt, inp, env) => {
    if (inp.busy && !a.wasBusy) events.push({ type: "start", id: a.id });
    if (!inp.busy && a.wasBusy) { events.push({ type: "done", id: a.id }); a.after = AFTER_WORK; }
    a.wasBusy = !!inp.busy;

    // 1. movement already under way
    if (a.mode === "walk") {
      const to = a.path[0];
      if (!to) { a.mode = "stand"; const f = a.then; a.then = null; a.speed = 0; if (f) f(); }
      else {
        const dx = to.x - a.x, dz = to.z - a.z, dist = Math.hypot(dx, dz);
        a.speed = Math.min(WALK_SPEED, a.speed + 4 * dt);
        const move = Math.min(dist, a.speed * dt);
        if (dist > 1e-4) { a.heading = turnToward(a.heading, Math.atan2(dx, dz), 7 * dt); a.x += (dx / dist) * move; a.z += (dz / dist) * move; }
        if (dist - move < 0.06) a.path.shift();
        a.action = "walk";
      }
    } else if (a.mode === "slideIn" || a.mode === "slideOut") {
      const s = a.slide;
      s.t = Math.min(1, s.t + dt / s.dur);
      const e = ease(s.t);
      a.x = s.from.x + (s.to.x - s.from.x) * e; a.z = s.from.z + (s.to.z - s.from.z) * e;
      a.heading = s.h0 + wrap(s.h1 - s.h0) * e; a.sit = s.s0 + (s.s1 - s.s0) * e; a.speed = 0;
      if (s.t >= 1) { a.slide = null; const f = a.then; a.then = null; if (f) f(); }
    } else { a.speed = 0; }

    // 2. what to do next
    if (inp.busy) {
      if (a.goal !== "work") {
        const wasMoving = a.mode === "walk";
        a.goal = "work"; a.atPlace = false;
        if (a.mode === "seated" && a.poi === "desk:" + a.id) { /* already at the desk */ }
        else if (a.mode === "seated") { release(a); a.poi = null; standUp(a, () => goDesk(a)); }
        else if (a.mode === "slideIn") { const keep = a.then; a.then = () => { keep?.(); release(a); standUp(a, () => goDesk(a)); }; }
        else if (a.mode === "walk" || a.mode === "stand") { if (wasMoving) a.path = []; goDesk(a); }
        else if (a.mode === "slideOut") { a.then = ((f) => () => { f?.(); goDesk(a); })(a.then); }
      }
      if (a.mode === "seated" && a.poi === "desk:" + a.id) a.action = "type";
      return;
    }
    if (a.goal === "work") { // the answer is done: stay at the desk a moment (the page shows "done"), then carry on
      a.goal = null;
      if (a.mode === "seated" && a.poi === "desk:" + a.id) { a.action = "sit"; a.timer = a.after; }
    }
    if (inp.selected) { // someone is chatting with them: stop and face the user
      a.attn += dt;
      if (a.mode === "walk") { a.path = []; a.then = null; release(a); a.mode = "stand"; a.speed = 0; a.atPlace = false; }
      if (a.mode === "stand") {
        a.heading = turnToward(a.heading, env.lookHeading ?? 0, 5 * dt);
        a.action = a.attn < 2.4 ? "wave" : "idle";
      }
      if (a.mode === "seated") a.timer = Math.max(a.timer, 1);
      return;
    }
    if (a.attn > 0) { a.attn = 0; if (a.mode === "stand") { a.timer = 0.6; a.action = "idle"; } }

    if (a.mode === "seated") {
      a.timer -= dt;
      if (a.timer <= 0) { if (state.wander || a.poi === "desk:" + a.id) { release(a); standUp(a); } else a.timer = 5; }
    } else if (a.mode === "stand") {
      if (a.atPlace && a.faceTo != null) a.heading = turnToward(a.heading, a.faceTo, 5 * dt);
      a.timer -= dt;
      if (a.timer <= 0) { a.atPlace = false; release(a); if (state.wander) goSomewhere(a); else { a.timer = 5; a.atPlace = true; } }
    }
  };

  return {
    grid, agents,
    setWander(on) { state.wander = !!on; }, // off: everybody stays where they are (people at their desks still work)
    update(dt, inputs = {}, env = {}) {
      dt = Math.min(dt, 0.1);
      for (const a of agents.values()) step(a, dt, inputs[a.id] ?? {}, env);
    },
    snapshot(id) { const a = agents.get(id); return { x: a.x, z: a.z, heading: a.heading, sit: a.sit, action: a.action, speed: a.speed / WALK_SPEED, mode: a.mode, poi: a.poi }; },
    drainEvents() { return events.splice(0); },
    taken,
  };
}
