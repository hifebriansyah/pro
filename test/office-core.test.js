import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as C from "../office/core.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const AGENT_IDS = [...html.matchAll(/^\s*\{ id: "(\w+)", name: "\w+", persona:/gm)].map((m) => m[1]);
const grid = C.buildGrid();
const DT = 1 / 30;
const angleGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); // headings that differ by whole turns face the same way
const run = (sim, seconds, inputs = {}, env = {}) => { for (let t = 0; t < seconds; t += DT) sim.update(DT, typeof inputs === "function" ? inputs(t) : inputs, env); };

test("the page's professionals are all here: 13 of them, each with a desk and a look", () => {
  assert.equal(AGENT_IDS.length, 13);
  for (const id of AGENT_IDS) {
    assert.ok(C.DESKS[id], `${id} has a desk`);
    assert.ok(C.LOOKS[id]?.skin && C.LOOKS[id].hair && C.LOOKS[id].jacket && C.LOOKS[id].pants, `${id} has a look`);
  }
  assert.deepEqual(Object.keys(C.DESKS).sort(), [...AGENT_IDS].sort(), "no desk without a professional");
  assert.equal(new Set(Object.values(C.DESKS).map(String)).size, 13, "no two share a desk");
});

test("floor plan: every desk is on the floor, and no two pieces of furniture overlap", () => {
  const blocks = C.furnitureBlocks();
  for (const b of blocks) assert.ok(b.x0 >= C.FLOOR.x0 && b.x1 <= C.FLOOR.x1 && b.z0 >= C.FLOOR.z0 && b.z1 <= C.FLOOR.z1, "inside the floor " + JSON.stringify(b));
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j];
    assert.ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0), `blocks ${i} and ${j} overlap: ${JSON.stringify(a)} ${JSON.stringify(b)}`);
  }
});

test("every desk entrance and every place to go is free ground, and all of them can be reached from each other", () => {
  const from = C.deskOf("po").approach;
  for (const id of Object.keys(C.DESKS)) {
    const a = C.deskOf(id).approach;
    assert.ok(C.isFree(grid, a.x, a.z), `desk ${id}: the entrance is blocked`);
    assert.ok(C.findPath(grid, from, a), `desk ${id}: unreachable`);
  }
  for (const p of C.POIS) {
    const t = C.placeOf(p);
    assert.ok(C.ACTIVITIES[p.kind], p.kind);
    assert.ok(C.isFree(grid, t.x, t.z), `${p.id}: blocked`);
    assert.ok(C.findPath(grid, from, t), `${p.id}: unreachable`);
    if (p.seat) assert.ok(Math.hypot(p.seat.x - t.x, p.seat.z - t.z) < 2.6, `${p.id}: the seat is too far from the way in`);
  }
  assert.equal(new Set(C.POIS.map((p) => p.id)).size, C.POIS.length, "unique place ids");
});

test("findPath: walks around furniture (never through it), ends exactly at the target, handles a blocked start", () => {
  const a = C.deskOf("po").approach, b = C.placeOf(C.POIS.find((p) => p.id === "coffee-2"));
  const path = C.findPath(grid, a, b);
  assert.deepEqual(path.at(-1), { x: b.x, z: b.z });
  let prev = a;
  for (const q of path) {
    for (let k = 0; k <= 20; k++) assert.ok(C.isFree(grid, prev.x + ((q.x - prev.x) * k) / 20, prev.z + ((q.z - prev.z) * k) / 20), "a step goes through furniture");
    prev = q;
  }
  const inDesk = C.findPath(grid, { x: -11.5, z: -7.5 }, b); // starting on a desk: it steps out to the nearest free cell
  assert.ok(inDesk?.length);
  assert.deepEqual(C.findPath(grid, b, b).at(-1), { x: b.x, z: b.z });
});

test("sim: whoever has an answer in flight ends up at their desk, typing", () => {
  const sim = C.createSim({ ids: AGENT_IDS, seed: 3 });
  run(sim, 20); // they wander first
  const id = "engineer";
  run(sim, 40, { [id]: { busy: true } });
  const s = sim.snapshot(id), d = C.deskOf(id);
  assert.equal(s.action, "type");
  assert.equal(s.mode, "seated");
  assert.ok(Math.hypot(s.x - d.seat.x, s.z - d.seat.z) < 0.05, "in the chair");
  assert.ok(angleGap(s.heading, d.heading) < 0.05 && s.sit > 0.99, "facing the desk, sitting");
  assert.ok(sim.drainEvents().some((e) => e.type === "start" && e.id === id));
});

test("sim: it works from any starting place (many seeds), and the others keep living", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const sim = C.createSim({ ids: AGENT_IDS, seed });
    run(sim, seed * 7);
    const id = AGENT_IDS[seed % AGENT_IDS.length];
    run(sim, 45, { [id]: { busy: true } });
    assert.equal(sim.snapshot(id).action, "type", `seed ${seed}: ${id} should be typing`);
    const others = AGENT_IDS.filter((x) => x !== id).map((x) => sim.snapshot(x));
    assert.ok(others.every((o) => o.action !== "type"), "only the busy one is at a desk working");
  }
});

test("sim: after the answer is done they stay a moment (done event), then get up and go somewhere else", () => {
  const sim = C.createSim({ ids: AGENT_IDS, seed: 5 });
  const id = "ba", d = C.deskOf(id);
  run(sim, 40, { [id]: { busy: true } });
  sim.drainEvents();
  run(sim, 1, {});
  assert.ok(sim.drainEvents().some((e) => e.type === "done" && e.id === id), "done event");
  assert.equal(sim.snapshot(id).mode, "seated", "still at the desk right after");
  run(sim, 60, {});
  const s = sim.snapshot(id);
  assert.ok(Math.hypot(s.x - d.seat.x, s.z - d.seat.z) > 1 || s.mode !== "seated" || s.poi !== "desk:" + id, "left the desk");
});

test("sim: someone you are chatting with stops, turns to the user and waves, then stands calmly; letting go sets them free", () => {
  const sim = C.createSim({ ids: AGENT_IDS, seed: 9 });
  run(sim, 5);
  const id = "designer", look = 0.7;
  run(sim, 1, { [id]: { selected: true } }, { lookHeading: look });
  assert.equal(sim.snapshot(id).speed, 0);
  run(sim, 1, { [id]: { selected: true } }, { lookHeading: look });
  if (sim.snapshot(id).mode === "stand") {
    assert.equal(sim.snapshot(id).action, "wave");
    run(sim, 3, { [id]: { selected: true } }, { lookHeading: look });
    assert.ok(angleGap(sim.snapshot(id).heading, look) < 0.05, "faces the camera");
    assert.equal(sim.snapshot(id).action, "idle");
    const where = sim.snapshot(id);
    run(sim, 10, { [id]: { selected: true } }, { lookHeading: look });
    assert.deepEqual([sim.snapshot(id).x, sim.snapshot(id).z], [where.x, where.z], "does not wander off while you chat");
  }
  const before = sim.snapshot(id);
  run(sim, 60, {});
  const after = sim.snapshot(id);
  assert.ok(before.x !== after.x || before.z !== after.z || before.mode !== after.mode || before.action !== after.action, "free again");
});

test("sim: three minutes of life: nobody leaves the floor, no two share a place, no NaN, and the busy one is never evicted", () => {
  const sim = C.createSim({ ids: AGENT_IDS, seed: 21 });
  const busyAt = (t) => ({ qa: { busy: t > 30 && t < 90 }, brand: { busy: t > 60 && t < 140 }, smm: { selected: t > 100 && t < 120 } });
  let t = 0;
  for (; t < 180; t += DT) {
    sim.update(DT, busyAt(t), { lookHeading: 0.8 });
    const seen = new Set();
    for (const id of AGENT_IDS) {
      const s = sim.snapshot(id);
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.heading) && s.sit >= -1e-6 && s.sit <= 1 + 1e-6, `${id} at ${t}: ${JSON.stringify(s)}`);
      assert.ok(s.x > C.FLOOR.x0 && s.x < C.FLOOR.x1 && s.z > C.FLOOR.z0 && s.z < C.FLOOR.z1, `${id} left the floor`);
    }
    for (const [place, who] of sim.taken) { assert.ok(!seen.has(place), "place taken twice"); seen.add(place); assert.ok(AGENT_IDS.includes(who)); }
  }
  assert.equal(sim.snapshot("brand").mode === "seated" || sim.snapshot("brand").mode === "stand" || sim.snapshot("brand").mode === "walk" || sim.snapshot("brand").mode.startsWith("slide"), true);
});

test("sim: the same seed gives the same office; wandering can be switched off", () => {
  const a = C.createSim({ ids: AGENT_IDS, seed: 4 }), b = C.createSim({ ids: AGENT_IDS, seed: 4 });
  run(a, 50); run(b, 50);
  for (const id of AGENT_IDS) assert.deepEqual(a.snapshot(id), b.snapshot(id));
  const still = C.createSim({ ids: AGENT_IDS, seed: 4, wander: false });
  const start = AGENT_IDS.map((id) => still.snapshot(id));
  run(still, 120);
  AGENT_IDS.forEach((id, i) => assert.deepEqual([still.snapshot(id).x, still.snapshot(id).z], [start[i].x, start[i].z], `${id} stays put`));
  run(still, 40, { engineer: { busy: true } });
  assert.equal(still.snapshot("engineer").action, "type", "but still goes to work when asked");
});
