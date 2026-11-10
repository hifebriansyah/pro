// The 3D side of the office: the building and its furniture, and the low-poly people. All of it is built from boxes, cylinders and a few
// icosahedrons with flat colours (no pictures to load), so the whole scene is a few hundred small meshes. THREE is passed in (the page loads it
// on demand); nothing here touches the DOM except the canvases that draw the floor boards, the signs and the screens.
import { DESKS, FLOOR, LOOKS, POIS, ZONES, deskOf } from "./core.js";

const PI = Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;

export function createKit(THREE) {
  const cache = new Map();
  const mat = (color, o = {}) => {
    const key = color + JSON.stringify(o);
    if (!cache.has(key)) cache.set(key, new THREE.MeshLambertMaterial({ color, ...o }));
    return cache.get(key);
  };
  const mesh = (geo, m, cast = true) => { const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = true; return x; };
  const box = (w, h, d, color, o = {}) => { const { cast = true, ...rest } = o; return mesh(new THREE.BoxGeometry(w, h, d), mat(color, rest), cast); };
  const cyl = (rt, rb, h, color, seg = 12, o = {}) => { const { cast = true, ...rest } = o; return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, rest), cast); };
  const ico = (r, color, detail = 0) => mesh(new THREE.IcosahedronGeometry(r, detail), mat(color));
  const place = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
  const put = (parent, obj, x = 0, y = 0, z = 0, ry = 0) => { obj.position.set(x, y, z); if (ry) obj.rotation.y = ry; parent.add(obj); return obj; };
  const group = (x = 0, y = 0, z = 0, ry = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; return g; };
  const canvasTexture = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; };
  return { THREE, mat, mesh, box, cyl, ico, put, place, group, canvasTexture };
}

const FACE = { s: 0, e: PI / 2, w: -PI / 2, n: PI }; // a piece of furniture is built facing south (+z); face turns it

// ---- furniture
function chair(k, color) {
  const g = k.group();
  k.put(g, k.box(0.46, 0.06, 0.46, color), 0, 0.39, 0);
  k.put(g, k.box(0.44, 0.5, 0.06, color), 0, 0.66, -0.22);
  k.put(g, k.cyl(0.03, 0.03, 0.3, "#64676c", 8), 0, 0.22, 0);
  k.put(g, k.cyl(0.26, 0.26, 0.04, "#3b3d42", 10), 0, 0.06, 0);
  return g;
}

function sofa(k, w, color, cushion) {
  const g = k.group();
  k.put(g, k.box(w, 0.3, 1.0, color), 0, 0.15, 0);
  k.put(g, k.box(w, 0.6, 0.26, color), 0, 0.6, -0.37);
  for (const sx of [-1, 1]) k.put(g, k.box(0.24, 0.5, 1.0, color), sx * (w / 2 - 0.12), 0.45, 0);
  const n = Math.max(1, Math.round((w - 0.5) / 1.1));
  for (let i = 0; i < n; i++) k.put(g, k.box((w - 0.5) / n - 0.04, 0.14, 0.74, cushion), -((w - 0.5) / 2) + ((w - 0.5) / n) * (i + 0.5), 0.37, 0.08);
  return g;
}

function plant(k, big = true) {
  const g = k.group();
  k.put(g, k.cyl(0.26, 0.19, 0.42, "#b9825a", 10), 0, 0.21, 0);
  const leaves = ["#4f9d57", "#3f8a4a", "#63b068"];
  [[0, 0.78, 0, 0.36], [0.14, 1.08, 0.06, 0.28], [-0.12, 1.02, -0.1, 0.26], [0.02, 1.3, 0, 0.2]].forEach(([x, y, z, r], i) => {
    if (!big && i > 1) return;
    k.put(g, k.ico(r, leaves[i % 3]), x, y, z);
  });
  return g;
}

function workstation(k, id, accent, screens) {
  const d = deskOf(id), g = k.group(d.x, 0, d.z);
  k.put(g, k.box(0.9, 0.05, 1.7, "#e4dccd"), 0, 0.725, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.put(g, k.box(0.05, 0.7, 0.05, "#6b6f76"), sx * 0.4, 0.35, sz * 0.78);
  k.put(g, k.box(0.03, 0.5, 1.5, "#cfc4b0"), 0.42, 0.46, 0); // the side the camera sees
  k.put(g, k.box(0.4, 0.5, 0.5, "#d8cfbe"), 0.18, 0.45, 0.55); // drawers
  // the laptop: its screen faces the chair and glows (the page makes it brighter and scrolls it while the person is working)
  const glow = new k.THREE.MeshBasicMaterial({ map: screens.texture.clone(), color: 0x666666 });
  glow.map.wrapT = k.THREE.RepeatWrapping; glow.map.repeat.set(1, 0.5); glow.map.needsUpdate = true;
  const dark = k.mat("#2b2d31");
  const screen = new k.THREE.Mesh(new k.THREE.BoxGeometry(0.015, 0.23, 0.34), [dark, glow, dark, dark, dark, dark]);
  screen.castShadow = true;
  k.put(g, k.box(0.27, 0.02, 0.34, "#9aa0a8"), -0.25, 0.76, 0);
  k.put(g, screen, -0.13, 0.88, 0).rotation.z = -0.22;
  screens.items.set(id, { material: glow });
  // the little things: a mug, a notebook in the person's colour, a mini plant
  k.put(g, k.cyl(0.04, 0.035, 0.08, "#f1efe9", 10), 0.1, 0.79, 0.6);
  k.put(g, k.box(0.2, 0.015, 0.28, accent), -0.1, 0.76, -0.55);
  k.put(g, k.cyl(0.05, 0.04, 0.07, "#b9825a", 8), 0.15, 0.79, -0.25);
  k.put(g, k.ico(0.07, "#4f9d57"), 0.15, 0.88, -0.25);
  // the chair, facing the desk (east)
  k.put(g, chair(k, "#3d4452"), -0.85, 0, 0, PI / 2);
  return g;
}

function pendant(k, lamps) {
  const g = k.group();
  k.put(g, k.cyl(0.01, 0.01, 0.9, "#555", 4), 0, 2.75, 0);
  const shade = k.mesh(new k.THREE.ConeGeometry(0.32, 0.26, 12, 1, true), new k.THREE.MeshLambertMaterial({ color: "#f3d9a0", side: k.THREE.DoubleSide, emissive: new k.THREE.Color("#ffb347"), emissiveIntensity: 0 }), false);
  k.put(g, shade, 0, 2.22, 0);
  lamps.push(shade.material);
  return g;
}

function bookshelf(k) {
  const g = k.group();
  k.put(g, k.box(0.4, 2.0, 1.8, "#a9794d"), 0, 1.0, 0);
  const cols = ["#d9534f", "#5bc0de", "#f0ad4e", "#5cb85c", "#7e57c2", "#ec407a", "#26a69a"];
  for (let r = 0; r < 4; r++) {
    k.put(g, k.box(0.42, 0.04, 1.84, "#8f6439"), 0, 0.4 + r * 0.46, 0);
    for (let i = 0; i < 9; i++) k.put(g, k.box(0.26, 0.3 + ((i * 7 + r * 3) % 4) * 0.025, 0.12, cols[(i + r * 2) % cols.length]), 0.08, 0.6 + r * 0.46 - 0.1, -0.78 + i * 0.18);
  }
  return g;
}

export function buildWorld(THREE, { colors = {}, signText = ZONES } = {}) {
  const k = createKit(THREE);
  const scene = new THREE.Scene();
  const lamps = [], windows = [], pointLights = [], greens = [];
  const world = new THREE.Group();
  scene.add(world);

  // ---- ground, floor, walls
  const grass = k.box(160, 0.1, 160, "#8fbf6b", { cast: false });
  k.put(world, grass, 0, -0.55, 0);
  k.put(world, k.box(30.8, 0.5, 20.8, "#d8d0c3"), 0, -0.25, 0);
  const wood = k.canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = "#b98150"; c.fillRect(0, 0, w, h);
    const tones = ["#b98150", "#b17a4a", "#bf8b58", "#a9743f", "#c18e5c"];
    for (let r = 0; r < 4; r++) {
      let x = (r * 97) % 200;
      while (x < w + 200) {
        const len = 160 + ((x * 13 + r * 31) % 140);
        c.fillStyle = tones[(Math.floor(x / 10) + r * 3) % tones.length];
        c.fillRect(x - len, r * 64, len, 64);
        c.fillStyle = "rgba(60,30,10,.28)"; c.fillRect(x - len, r * 64, 2, 64);
        x += len;
      }
      c.fillStyle = "rgba(60,30,10,.32)"; c.fillRect(0, r * 64, w, 2);
    }
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(15, 20);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), new THREE.MeshLambertMaterial({ map: wood }));
  floor.rotation.x = -PI / 2; floor.receiveShadow = true;
  k.put(world, floor, 0, 0.005, 0);
  const wallColor = "#f0e8da";
  k.put(world, k.box(30.6, 3.3, 0.3, wallColor), 0, 1.65, -10.15);
  k.put(world, k.box(0.3, 3.3, 20.6, wallColor), -15.15, 1.65, 0);
  k.put(world, k.box(30.6, 0.14, 0.06, "#cfc3ae", { cast: false }), 0, 0.07, -9.97);
  k.put(world, k.box(0.06, 0.14, 20.6, "#cfc3ae", { cast: false }), -14.97, 0.07, 0);

  // ---- windows (a frame and a glass that shows the sky by day and a warm glow at night)
  const sky = new THREE.MeshBasicMaterial({ color: 0xbfe3f8 });
  windows.push(sky);
  const win = (x, y, z, w, h, ry) => {
    const g = k.group(x, y, z, ry);
    k.put(g, k.box(w + 0.16, h + 0.16, 0.1, "#fbf8f1", { cast: false }), 0, 0, 0);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sky); glass.position.z = 0.06; g.add(glass);
    k.put(g, k.box(0.05, h, 0.05, "#fbf8f1", { cast: false }), 0, 0, 0.07);
    k.put(g, k.box(w, 0.05, 0.05, "#fbf8f1", { cast: false }), 0, 0, 0.07);
    k.put(g, k.box(w + 0.3, 0.06, 0.2, "#e3d9c6", { cast: false }), 0, -h / 2 - 0.1, 0.1);
    world.add(g);
  };
  for (const x of [-13, -10, -7, -4, -1, 2, 8]) win(x, 1.55, -9.98, 2.0, 1.5, 0);
  for (const z of [-7.5, -4, -0.5, 3]) win(-14.98, 1.55, z, 2.0, 1.5, PI / 2);

  // ---- signs over each team's desks, a clock and two pictures
  signText.forEach((zone) => {
    const tex = k.canvasTexture(512, 80, (c, w, h) => {
      c.fillStyle = "#2b2622"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#f59e0b"; c.fillRect(0, h - 8, w, 8);
      c.fillStyle = "#fff"; c.font = "700 42px system-ui, -apple-system, 'Segoe UI', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(zone.name.toUpperCase(), w / 2, h / 2 - 2);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.66), new THREE.MeshBasicMaterial({ map: tex }));
    k.put(world, sign, zone.x, 2.85, -9.96);
  });
  const clock = k.group(6.6, 2.5, -9.96);
  k.put(clock, k.cyl(0.32, 0.32, 0.05, "#f7f4ec", 24), 0, 0, 0).rotation.x = PI / 2;
  const hand = (len, w, a) => { const h = k.box(w, len, 0.02, "#2b2622", { cast: false }); h.geometry.translate(0, len / 2, 0); h.position.z = 0.04; h.rotation.z = a; clock.add(h); };
  hand(0.2, 0.025, -1.3); hand(0.28, 0.015, 0.5);
  world.add(clock);
  const art = (x, z, y, w, h, c1, c2, ry = 0) => { const g = k.group(x, y, z, ry); k.put(g, k.box(w + 0.12, h + 0.12, 0.05, "#3a342f", { cast: false })); const p = k.box(w, h, 0.03, c1, { cast: false }); p.position.z = 0.03; g.add(p); const s = k.box(w * 0.5, h * 0.5, 0.03, c2, { cast: false }); s.position.set(w * 0.1, -h * 0.1, 0.05); g.add(s); world.add(g); };
  art(4.5, -9.97, 2.0, 0.9, 0.7, "#f2c879", "#c0392b"); art(13.9, -9.97, 2.0, 0.8, 1.0, "#9ec5e8", "#2c6fa8");

  // ---- the furniture from the floor plan in core.js
  const screens = { items: new Map(), texture: k.canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = "#15202e"; c.fillRect(0, 0, w, h);
    const rows = ["#7ec8ff", "#ffd479", "#9be28f", "#ff9bb0", "#c3a6ff"];
    for (let i = 0; i < 16; i++) { c.fillStyle = rows[i % rows.length]; c.fillRect(8 + (i % 3) * 8, 6 + i * 7.5, 20 + ((i * 37) % 70), 3.5); }
  }) };
  for (const id of Object.keys(DESKS)) world.add(workstation(k, id, colors[id] ?? "#f59e0b", screens));
  for (const x of [-9.5, -0.5]) for (const z of [-5, -2.5]) world.add(k.place(pendant(k, lamps), x, 0, z));

  // lounge
  k.put(world, k.box(5.6, 0.02, 4.2, "#c9b79c", { cast: false }), 10.5, 0.011, -6.2);
  world.add(k.place(sofa(k, 3.4, "#b86f35", "#cf8a4a"), 10.5, 0, -8.9));
  const ct = k.group(10.5, 0, -6.3);
  k.put(ct, k.box(1.6, 0.05, 0.8, "#efe9df"), 0, 0.4, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.put(ct, k.box(0.05, 0.38, 0.05, "#8a6a47"), sx * 0.7, 0.19, sz * 0.32);
  k.put(ct, k.cyl(0.05, 0.04, 0.09, "#d9534f", 8), -0.3, 0.47, 0.1); k.put(ct, k.box(0.28, 0.03, 0.2, "#2c6fa8"), 0.3, 0.435, -0.05);
  world.add(ct);
  const arm = (x, face) => { const a = sofa(k, 1.05, "#3d7bd1", "#5a94e6"); a.position.set(x, 0, -7.2); a.rotation.y = FACE[face]; world.add(a); };
  arm(7.0, "e"); arm(13.8, "w");
  const tv = k.group(10.5, 1.95, -9.85);
  k.put(tv, k.box(1.9, 1.1, 0.06, "#15171b"), 0, 0, 0);
  const tvTex = k.canvasTexture(256, 144, (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#1d4f91"); g.addColorStop(1, "#f59e0b"); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(255,255,255,.9)"; c.font = "700 54px system-ui, sans-serif"; c.textAlign = "center"; c.fillText("Pro", w / 2, h / 2 + 18); });
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.76, 0.98), new THREE.MeshBasicMaterial({ map: tvTex })); tvScreen.position.z = 0.04; tv.add(tvScreen);
  world.add(tv);
  world.add(k.place(pendant(k, lamps), 10.5, 0, -6.2));

  // meeting room: two conference tables, glass walls with a doorway between them, and 16 chairs
  k.put(world, k.box(12.6, 0.02, 4.2, "#aab4c0", { cast: false }), -7.6, 0.011, 6.5);
  const glassMat = new THREE.MeshLambertMaterial({ color: "#bfe3f2", transparent: true, opacity: 0.22, depthWrite: false });
  for (const gx of [-12.25, -4.15]) {
    const gl = k.group(gx, 0, 3.4);
    k.put(gl, k.mesh(new THREE.BoxGeometry(5.3, 2.2, 0.05), glassMat, false), 0, 1.1, 0);
    k.put(gl, k.box(5.3, 0.05, 0.08, "#6b7380", { cast: false }), 0, 2.2, 0); k.put(gl, k.box(5.3, 0.06, 0.08, "#6b7380", { cast: false }), 0, 0.03, 0);
    for (const x of [-2.65, 0, 2.65]) k.put(gl, k.box(0.06, 2.2, 0.08, "#6b7380", { cast: false }), x, 1.1, 0);
    world.add(gl);
  }
  for (const tx of [-11, -4.2]) {
    const mt = k.group(tx, 0, 6.5);
    k.put(mt, k.box(3.4, 0.06, 1.2, "#b98757"), 0, 0.74, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.put(mt, k.box(0.06, 0.72, 0.06, "#6b6f76"), sx * 1.55, 0.36, sz * 0.5);
    k.put(mt, k.box(0.5, 0.01, 0.35, "#ffffff"), -0.8, 0.775, 0.1); k.put(mt, k.box(0.5, 0.01, 0.35, "#f6e7b4"), 0.5, 0.775, -0.2); k.put(mt, k.cyl(0.04, 0.035, 0.08, "#d9534f", 8), 0.1, 0.8, 0.3);
    world.add(mt);
  }
  for (const p of POIS.filter((q) => q.kind === "meeting")) { const c = chair(k, "#2f9e8f"); c.position.set(p.seat.x, 0, p.seat.z); c.rotation.y = p.heading; world.add(c); }
  const wb = k.group(-14.9, 1.5, 6.5, PI / 2);
  k.put(wb, k.box(2.4, 1.3, 0.05, "#fbfbf8"), 0, 0, 0); k.put(wb, k.box(2.5, 0.06, 0.08, "#8a8f98"), 0, -0.68, 0.02);
  [["#e57373", -0.6, 0.3, 0.9], ["#64b5f6", 0.1, 0.1, 1.1], ["#81c784", -0.3, -0.2, 0.7], ["#ffb74d", 0.6, -0.3, 0.6]].forEach(([c, x, y, w]) => { const s = k.box(w, 0.05, 0.01, c, { cast: false }); s.position.set(x, y, 0.04); wb.add(s); });
  world.add(wb);
  world.add(k.place(bookshelf(k), -14.75, 0, 2.2));

  // pantry and corners
  const ctr = k.group(11.5, 0, 5.8);
  k.put(ctr, k.box(3.2, 0.9, 0.9, "#f1ece4"), 0, 0.45, 0); k.put(ctr, k.box(3.3, 0.05, 1.0, "#38393d"), 0, 0.92, 0); k.put(ctr, k.box(3.0, 0.7, 0.02, "#b98757"), 0, 0.45, 0.46);
  k.put(ctr, k.box(0.4, 0.46, 0.35, "#2c2f34"), -0.8, 1.18, -0.1); k.put(ctr, k.box(0.06, 0.06, 0.02, "#ff5252", { cast: false }), -0.9, 1.3, 0.09);
  k.put(ctr, k.cyl(0.04, 0.035, 0.08, "#f1efe9", 8), -0.8, 0.99, 0.25); k.put(ctr, k.cyl(0.04, 0.035, 0.08, "#f59e0b", 8), -0.6, 0.99, 0.3);
  k.put(ctr, k.ico(0.12, "#e8554e"), 0.6, 1.02, 0); k.put(ctr, k.ico(0.1, "#f2c14e"), 0.78, 1.0, 0.1);
  world.add(ctr);
  world.add(k.place(pendant(k, lamps), 11.5, 0, 5.8));
  const cooler = k.group(7.2, 0, 3.3);
  k.put(cooler, k.box(0.42, 0.95, 0.42, "#e9edf1"), 0, 0.475, 0); k.put(cooler, k.cyl(0.17, 0.17, 0.4, "#8cc8f0", 12, { transparent: true, opacity: 0.75 }), 0, 1.15, 0);
  world.add(cooler);
  const pt = k.group(4.5, 0, 3.2);
  k.put(pt, k.box(1.2, 0.05, 0.6, "#e4dccd"), 0, 0.72, 0); for (const sx of [-1, 1]) k.put(pt, k.box(0.05, 0.7, 0.5, "#6b6f76"), sx * 0.55, 0.35, 0);
  k.put(pt, k.box(0.5, 0.25, 0.4, "#e3e5e8"), -0.15, 0.87, 0); k.put(pt, k.box(0.3, 0.02, 0.22, "#ffffff"), 0.35, 0.76, 0);
  world.add(pt);
  [[7.0, -9.4], [14.3, -9.4], [-14.3, -9.4], [4.0, -9.4], [-0.5, 3.0], [6.0, 8.9], [14.3, 2.0], [-6.8, 9.0], [14.3, 9.2], [2.2, 0.8], [-5.2, 4.6]].forEach(([x, z], i) => { const p = plant(k, i % 3 !== 2); p.position.set(x, 0, z); world.add(p); greens.push(p); });

  // ---- outside: a few trees and bushes beyond the walls
  const tree = (x, z, s = 1) => {
    const t = k.group(x, -0.5, z); t.scale.setScalar(s);
    k.put(t, k.cyl(0.2, 0.28, 1.8, "#8a5a3a", 8), 0, 0.9, 0);
    k.put(t, k.ico(1.5, "#4f9d57"), 0, 2.6, 0); k.put(t, k.ico(1.1, "#63b068"), 0.7, 3.4, 0.2); k.put(t, k.ico(0.9, "#3f8a4a"), -0.7, 3.2, -0.3);
    world.add(t);
  };
  [[-12, -15], [-4, -16.5], [5, -14.5], [14, -17], [-21, -6], [-19, 5], [-22, 13], [-26, -14], [22, -12], [24, 6], [-8, -22], [18, -22]].forEach(([x, z], i) => tree(x, z, 0.9 + (i % 4) * 0.2));
  [[-17, -12], [-16.5, 9], [8, -12.5], [-1, -12]].forEach(([x, z]) => { const b = k.ico(0.8, "#5aa75f"); b.position.set(x, -0.1, z); b.scale.set(1.3, 0.8, 1.1); world.add(b); });

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0xb9a58a, 0.72);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 0.75);
  sun.position.set(9, 22, 13);
  sun.castShadow = true;
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22; sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);
  for (const [x, z] of [[-9.5, -4], [-0.5, -4], [10.5, -6.2], [11.5, 5.8]]) { const l = new THREE.PointLight(0xffc27a, 0, 11, 1.6); l.position.set(x, 2.4, z); scene.add(l); pointLights.push(l); }

  const palette = {
    day: { bg: "#cfe6f5", fog: "#cfe6f5", grass: "#86b565", hemi: 0.72, sun: 0.62, sunColor: 0xfff1d6, glass: 0xbfe3f8, lamp: 0, point: 0 },
    night: { bg: "#151a2b", fog: "#151a2b", grass: "#2c4a3a", hemi: 0.42, sun: 0.28, sunColor: 0x9db4ff, glass: 0x24304f, lamp: 1.1, point: 0.9 },
  };
  scene.fog = new THREE.Fog(0xcfe6f5, 55, 120);
  scene.background = new THREE.Color(palette.day.bg);
  const setMode = (mode) => {
    const p = palette[mode] ?? palette.day;
    scene.background.set(p.bg); scene.fog.color.set(p.fog);
    grass.material = k.mat(p.grass);
    hemi.intensity = p.hemi; sun.intensity = p.sun; sun.color.setHex(p.sunColor);
    sky.color.setHex(p.glass);
    for (const m of lamps) m.emissiveIntensity = p.lamp;
    for (const l of pointLights) l.intensity = p.point;
  };
  setMode("day");

  return { k, scene, world, sun, screens, setMode };
}

// ---- people
export function buildCharacter(k, look, accent = "#f59e0b") {
  const { THREE } = k;
  const own = new Set(); // this person's own materials (so a highlight does not light up everybody who shares a colour)
  const m = (color, o = {}) => { const x = new THREE.MeshLambertMaterial({ color, ...o }); own.add(x); return x; };
  const part = (w, h, d, color, o) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color, o)); x.castShadow = true; x.receiveShadow = true; return x; };
  const at = (parent, obj, x, y, z) => { obj.position.set(x, y, z); parent.add(obj); return obj; };

  const root = new THREE.Group();
  const s = look.female ? 0.95 : 1;
  const body = new THREE.Group(); root.add(body);
  const pelvis = new THREE.Group(); pelvis.position.y = 0.86; body.add(pelvis);
  at(pelvis, part(0.36 * s, 0.14, 0.22, look.pants), 0, 0.02, 0);

  const limb = (parent, x, y, upper, lower, w, colorU, colorL) => {
    const hip = new THREE.Group(); hip.position.set(x, y, 0); parent.add(hip);
    at(hip, part(w, upper, w * 1.05, colorU), 0, -upper / 2, 0);
    const knee = new THREE.Group(); knee.position.y = -upper; hip.add(knee);
    at(knee, part(w * 0.94, lower, w, colorL), 0, -lower / 2, 0);
    return { hip, knee };
  };
  const legL = limb(pelvis, 0.1 * s, -0.04, 0.42, 0.42, 0.16, look.pants, look.pants);
  const legR = limb(pelvis, -0.1 * s, -0.04, 0.42, 0.42, 0.16, look.pants, look.pants);
  for (const l of [legL, legR]) at(l.knee, part(0.16, 0.07, 0.27, "#23262b"), 0, -0.42, 0.05);

  const torso = new THREE.Group(); torso.position.y = 0.06; pelvis.add(torso);
  at(torso, part(0.42 * s, 0.5, 0.23, look.jacket), 0, 0.25, 0);
  at(torso, part(0.15, 0.4, 0.01, look.inner), 0, 0.27, 0.118);                      // the shirt under the jacket
  at(torso, part(0.06, 0.08, 0.012, accent), 0.12 * s, 0.22, 0.125);                  // an ID badge in the person's colour
  const armL = limb(torso, 0.26 * s, 0.47, 0.3, 0.27, 0.11, look.jacket, look.jacket);
  const armR = limb(torso, -0.26 * s, 0.47, 0.3, 0.27, 0.11, look.jacket, look.jacket);
  for (const a of [armL, armR]) at(a.knee, part(0.09, 0.09, 0.09, look.skin), 0, -0.3, 0.01);

  const neck = new THREE.Group(); neck.position.y = 0.5; torso.add(neck);
  at(neck, part(0.1, 0.08, 0.1, look.skin), 0, 0.03, 0);
  const head = new THREE.Group(); head.position.y = 0.07; neck.add(head);
  at(head, part(0.27, 0.3, 0.27, look.skin), 0, 0.15, 0);
  for (const sx of [-1, 1]) at(head, part(0.035, 0.045, 0.012, "#1b1b1f"), sx * 0.065, 0.17, 0.138);
  at(head, part(0.07, 0.014, 0.012, "#7a3b34"), 0, 0.08, 0.138);
  for (const sx of [-1, 1]) at(head, part(0.04, 0.025, 0.01, "#e59a8a", { transparent: true, opacity: 0.5 }), sx * 0.1, 0.11, 0.138);
  const hair = look.hair, hs = look.style;
  at(head, part(0.29, 0.09, 0.29, hair), 0, 0.3, 0);                                   // the top
  at(head, part(0.29, 0.05, 0.04, hair), 0, 0.27, 0.13);                                // the fringe
  if (hs === "short") { at(head, part(0.29, 0.18, 0.06, hair), 0, 0.2, -0.12); }
  if (hs === "wavy" || hs === "long" || hs === "bob") {
    const len = hs === "long" ? 0.46 : hs === "wavy" ? 0.36 : 0.26;
    at(head, part(0.31, len, 0.08, hair), 0, 0.3 - len / 2, -0.12);
    for (const sx of [-1, 1]) at(head, part(0.04, len - 0.08, 0.2, hair), sx * 0.15, 0.3 - (len - 0.08) / 2 - 0.02, -0.02);
  }
  if (look.beard) { at(head, part(0.2, 0.08, 0.05, hair), 0, 0.04, 0.13); at(head, part(0.09, 0.02, 0.02, hair), 0, 0.105, 0.14); }
  if (look.glasses) {
    for (const sx of [-1, 1]) at(head, part(0.085, 0.06, 0.012, "#2a2a30", { transparent: true, opacity: 0.55 }), sx * 0.065, 0.17, 0.145);
    at(head, part(0.04, 0.012, 0.012, "#2a2a30"), 0, 0.185, 0.145);
  }
  const mug = part(0.07, 0.09, 0.07, "#f4efe6"); mug.position.set(0, -0.31, 0.06); mug.visible = false; armR.knee.add(mug);
  const book = part(0.22, 0.3, 0.03, "#c0392b"); book.position.set(0, -0.28, 0.05); book.rotation.x = 0.3; book.visible = false; armL.knee.add(book);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 40), new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -PI / 2; ring.position.y = 0.03; root.add(ring);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.95, 0.95), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.97; root.add(hit);

  const ch = { root, body, pelvis, torso, head, neck, legL, legR, armL, armR, mug, book, hit, ring, phase: Math.random() * 6, blink: 0, own, hl: 0 };
  hit.userData.charRoot = ch;
  return ch;
}

const approach = (obj, axis, target, k) => { obj.rotation[axis] += (target - obj.rotation[axis]) * k; };

/** Put a person in the pose the simulation says: where they are, how they stand, sit or walk, and what their arms are doing. */
export function poseCharacter(ch, s, t, dt) {
  const k = Math.min(1, dt * 9);
  const sit = s.sit, walk = Math.min(1, s.speed);
  ch.root.position.set(s.x, 0, s.z);
  ch.root.rotation.y = s.heading;
  ch.phase += dt * (2.2 + 6.2 * walk);
  const sw = Math.sin(ch.phase) * 0.8 * walk;
  const act = s.action;
  const seated = sit > 0.5;
  const typing = act === "type", relax = act === "relax", talk = act === "talk";

  // legs: a walking swing, or folded onto the chair
  approach(ch.legL.hip, "x", lerp(sw, -1.5, sit), k); approach(ch.legR.hip, "x", lerp(-sw, -1.5, sit), k);
  approach(ch.legL.knee, "x", lerp(Math.max(0, -Math.cos(ch.phase)) * 0.9 * walk, 1.5, sit), k); approach(ch.legR.knee, "x", lerp(Math.max(0, Math.cos(ch.phase)) * 0.9 * walk, 1.5, sit), k);
  ch.pelvis.position.y = lerp(0.86, 0.52, sit) + Math.abs(Math.sin(ch.phase)) * 0.045 * walk + Math.sin(t * 1.6) * 0.004;

  // upper body
  const lean = typing ? 0.14 : relax ? -0.12 : talk ? 0.04 : 0.02;
  approach(ch.torso, "x", walk > 0.1 ? 0.06 : lean, k);
  let aLx = -sw * 0.9, aRx = sw * 0.9, eLx = -0.1 - Math.max(0, sw) * 0.4, eRx = -0.1 - Math.max(0, -sw) * 0.4, rz = 0, ez = 0, hy = 0, hx = 0;
  ch.mug.visible = act === "drink"; ch.book.visible = act === "read";
  if (typing) {
    aLx = -0.55 + Math.sin(t * 13) * 0.04; aRx = -0.55 + Math.sin(t * 13 + 2) * 0.04;
    eLx = -1.0 + Math.sin(t * 17) * 0.1; eRx = -1.0 + Math.sin(t * 15 + 1) * 0.1;
    hx = 0.12 + Math.sin(t * 0.9) * 0.05; hy = Math.sin(t * 0.7) * 0.1;
  } else if (act === "sit") {
    aLx = -0.4; aRx = -0.4; eLx = -0.9; eRx = -0.9; hy = Math.sin(t * 0.5) * 0.15;
  } else if (relax) {
    aLx = -0.35; aRx = -0.35; eLx = -0.95; eRx = -0.95; hy = Math.sin(t * 0.35) * 0.45; hx = -0.04;
  } else if (talk) {
    aRx = -0.9 + Math.sin(t * 3.1) * 0.35; eRx = -1.0 + Math.sin(t * 4.3) * 0.3; aLx = -0.4; eLx = -0.9;
    hy = Math.sin(t * 0.8) * 0.35; hx = Math.sin(t * 2.2) * 0.08;
  } else if (act === "drink") {
    const sip = (Math.sin(t * 1.4) + 1) / 2; // 0 holding the mug low, 1 at the mouth
    aRx = -0.6 - sip * 0.6; eRx = -1.2 - sip * 0.55; hx = -sip * 0.1; hy = Math.sin(t * 0.4) * 0.3;
  } else if (act === "read") {
    aLx = -0.95; aRx = -0.95; eLx = -0.9; eRx = -0.9; hx = 0.3; hy = 0;
  } else if (act === "point") {
    aRx = -1.25 + Math.sin(t * 1.5) * 0.12; eRx = -0.25; hy = Math.sin(t * 0.8) * 0.12; hx = 0.05;
  } else if (act === "wave") {
    rz = -2.45; ez = -(0.3 + 0.4 * Math.sin(t * 10)); aRx = 0; hy = 0.1; hx = -0.05;
  } else if (act === "look" || act === "idle") {
    hy = Math.sin(t * 0.55 + ch.phase * 0.01) * 0.5; hx = Math.sin(t * 0.3) * 0.05; aLx = -0.05 + Math.sin(t * 1.5) * 0.02; aRx = -0.05 - Math.sin(t * 1.5) * 0.02;
  }
  if (walk > 0.1) { hy = 0; hx = 0; }
  approach(ch.armL.hip, "x", aLx, k); approach(ch.armR.hip, "x", aRx, k);
  approach(ch.armL.knee, "x", eLx, k); approach(ch.armR.knee, "x", eRx, k);
  approach(ch.armR.hip, "z", rz, k); approach(ch.armR.knee, "z", ez, k); approach(ch.armL.hip, "z", 0.04, k);
  approach(ch.head, "y", hy, k * 0.6); approach(ch.head, "x", hx, k);
  ch.hl += ((ch.hlTarget ?? 0) - ch.hl) * Math.min(1, dt * 12);
  const e = ch.hl * 0.07;
  for (const mm of ch.own) mm.emissive.setRGB(e, e * 0.8, e * 0.4);
  ch.ring.material.opacity = ch.hl * (0.75 + Math.sin(t * 4) * 0.15);
  ch.ring.scale.setScalar(1 + ch.hl * Math.sin(t * 4) * 0.04);
  void seated;
}
