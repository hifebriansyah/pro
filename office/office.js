// The office on the page: a canvas with the 3D scene, a name tag over every person (real buttons, so the keyboard and screen readers work too),
// a camera you can turn and zoom, and the loop that moves everybody. The page gives it the professionals and a getState(id) that says who is busy
// writing an answer and who is being chatted with; it calls onSelect(id) when somebody is clicked.
import { anchorShift, createSim, FLOOR, LOOKS } from "./core.js";
import { buildCharacter, buildWorld, poseCharacter } from "./scene.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PI_180 = Math.PI / 180;
const HOME = { az: 0.74, el: 0.62, zoom: 1 };       // the view from the south-east
const AZ = [0.2, 1.4], EL = [0.28, 1.15], ZOOM = [0.12, 1.2];
const FOCUS = 0.3;
const homeZoom = (aspect) => (aspect < 0.7 ? 0.5 : aspect < 1.0 ? 0.8 : 1); // a tall screen cannot show the whole floor and still be readable: start closer, and pan                                  // how close the camera comes to the person you chat with
const DONE_MS = 3500;

export function createOffice({ THREE, host, agents, getState, onSelect, onError, mode = "day", reduceMotion = false }) {
  const stage = document.createElement("div");
  stage.className = "of-stage";
  const tagsLayer = document.createElement("div");
  tagsLayer.className = "of-tags";
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch (e) { onError?.(e); throw e; }
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "of-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Kantor virtual: tarik untuk memutar, Shift dan tarik atau tombol kanan untuk menggeser, gulir untuk memperbesar. Pilih karakter dengan mengklik namanya.");
  stage.append(canvas, tagsLayer);
  host.append(stage);

  const { scene, sun, screens, setMode, k } = buildWorld(THREE, { colors: Object.fromEntries(agents.map((a) => [a.id, a.color])) });
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 220);
  const sim = createSim({ ids: agents.map((a) => a.id), seed: (Date.now() >>> 4) & 0xffff, wander: !reduceMotion });

  // ---- the people and their name tags
  const people = new Map();
  for (const a of agents) {
    const ch = buildCharacter(k, LOOKS[a.id], a.color);
    scene.add(ch.root);
    ch.hit.userData.id = a.id;
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "of-tag";
    tag.hidden = true; // until the first frame places it
    tag.dataset.id = a.id;
    tag.style.setProperty("--c", a.color);
    const av = document.createElement("span"); av.className = "of-av"; av.textContent = a.name[0]; av.style.background = a.color;
    if (a.avatar) { const img = new Image(); img.alt = ""; img.onload = () => av.replaceChildren(img); img.src = a.avatar; }
    const name = document.createElement("span"); name.className = "of-name"; name.textContent = a.name;
    const dot = document.createElement("span"); dot.className = "of-dot";
    const bubble = document.createElement("span"); bubble.className = "of-bubble"; bubble.setAttribute("aria-hidden", "true");
    tag.append(av, name, dot, bubble);
    tag.onclick = () => onSelect?.(a.id);
    tag.onpointerenter = () => (hovered = a.id);
    tag.onpointerleave = () => { if (hovered === a.id) hovered = null; };
    tagsLayer.append(tag);
    people.set(a.id, { agent: a, ch, tag, bubble, name, flash: 0, last: "" });
  }
  const hits = [...people.values()].map((p) => p.ch.hit);

  // ---- the camera: it orbits a target; zoom is a fraction of the distance that shows the whole floor
  const cam = { az: HOME.az, el: HOME.el, zoom: HOME.zoom, home: HOME.zoom, target: new THREE.Vector3(0, 0.4, 0.4), want: { az: HOME.az, el: HOME.el, zoom: HOME.zoom, target: new THREE.Vector3(0, 0.4, 0.4) }, fit: 40 };
  const corners = [[-15, 0, -10], [15, 0, -10], [-15, 0, 10], [15, 0, 10], [-15, 3.3, -10], [15, 3.3, -10], [-15, 3.3, 10]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const place = (dist) => {
    const { az, el } = cam;
    camera.position.set(cam.target.x + dist * Math.sin(az) * Math.cos(el), cam.target.y + dist * Math.sin(el), cam.target.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(cam.target);
    camera.updateMatrixWorld();
  };
  const fitDistance = () => {
    const saved = { ...cam, target: cam.target.clone() };
    cam.az = HOME.az; cam.el = HOME.el; cam.target.set(0, 0.4, 0.4);
    let d = 50;
    for (let i = 0; i < 8; i++) {
      place(d);
      camera.updateProjectionMatrix();
      let m = 0;
      for (const c of corners) { const p = c.clone().project(camera); m = Math.max(m, Math.abs(p.x) / 0.94, Math.abs(p.y) / 0.9); }
      d *= m || 1;
    }
    cam.az = saved.az; cam.el = saved.el; cam.target.copy(saved.target);
    return d;
  };
  let w = 0, h = 0, firstFit = true;
  const resize = () => {
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { w = 0; return; }
    w = Math.round(r.width); h = Math.round(r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    cam.fit = fitDistance();
    const hz = homeZoom(w / h);
    if (hz !== cam.home) { if (cam.want.zoom === cam.home) cam.want.zoom = hz; if (!firstFit) cam.zoom = cam.want.zoom; cam.home = hz; }
    firstFit = false;
    camera.far = Math.max(220, cam.fit * 4); camera.updateProjectionMatrix();
    scene.fog.near = cam.fit * 1.5; scene.fog.far = cam.fit * 4;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // ---- hover and click
  let hovered = null, selected = null, paused = false;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hits, false)[0];
    return hit ? hit.object.userData.id : null;
  };
  // pan: the floor follows the finger. One pixel is (distance * 2 * tan(fov / 2) / height) metres across, and more along the ground (the view is tilted).
  const panBy = (dx, dy) => {
    const perPx = (2 * Math.tan((camera.fov * PI_180) / 2) * cam.fit * cam.zoom) / h;
    const { az, el } = cam;
    cam.want.target.x = clamp(cam.want.target.x - Math.cos(az) * dx * perPx - Math.sin(az) * dy * perPx / Math.sin(el), -13, 13);
    cam.want.target.z = clamp(cam.want.target.z + Math.sin(az) * dx * perPx - Math.cos(az) * dy * perPx / Math.sin(el), -8.5, 8.5);
  };
  // zoom towards a point of the screen (the cursor or the pinch), like Figma: the spot under it stays where it is. Not while you chat with someone: the camera stays on them.
  const zoomAt = (factor, cx, cy) => {
    const next = clamp(cam.want.zoom * factor, ZOOM[0], ZOOM[1]);
    if (!selected && next !== cam.want.zoom) {
      const r = canvas.getBoundingClientRect();
      const k = anchorShift(cam.want.az, cam.want.el, camera.fov, camera.aspect, ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      if (k) {
        const gap = cam.fit * cam.want.zoom - cam.fit * next;
        cam.want.target.x = clamp(cam.want.target.x + gap * k.x, -13, 13);
        cam.want.target.z = clamp(cam.want.target.z + gap * k.z, -8.5, 8.5);
      }
    }
    cam.want.zoom = next; userMoved = true;
  };
  const pointers = new Map();
  let drag = null, pinch = 0, userMoved = false;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag.moved = true; }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) { if (e.pointerType === "mouse") { hovered = pick(e); canvas.style.cursor = hovered ? "pointer" : "grab"; } return; }
    if (pointers.size === 2) {
      p.px = p.x; p.py = p.y; p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      if (!selected && pointers.size === 2) panBy((e.clientX - p.px) / 2, (e.clientY - p.py) / 2);
      pinch = d;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true; userMoved = true;
    canvas.style.cursor = "grabbing";
    const pan = (e.pointerType !== "mouse" || e.shiftKey || (e.buttons & 6)) && !selected; // while you chat with someone the camera stays on them
    if (pan) panBy(dx, dy);
    else {
      cam.want.az = clamp(cam.want.az - dx * 0.005, AZ[0], AZ[1]);
      cam.want.el = clamp(cam.want.el + dy * 0.004, EL[0], EL[1]);
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (drag && !drag.moved && e.type === "pointerup") { const id = pick(e); if (id) onSelect?.(id); }
    if (!pointers.size) drag = null;
    canvas.style.cursor = hovered ? "pointer" : "grab";
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (!pointers.size) hovered = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // a right-button drag pans: no browser menu
  canvas.addEventListener("keydown", (e) => {
    if (e.shiftKey && !selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      panBy({ ArrowLeft: 60, ArrowRight: -60 }[e.key] ?? 0, { ArrowUp: 50, ArrowDown: -50 }[e.key] ?? 0); userMoved = true; e.preventDefault(); return;
    }
    const step = { ArrowLeft: [0.08, 0], ArrowRight: [-0.08, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] }[e.key];
    if (step) { cam.want.az = clamp(cam.want.az + step[0], AZ[0], AZ[1]); cam.want.el = clamp(cam.want.el + step[1], EL[0], EL[1]); userMoved = true; e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { cam.want.zoom = clamp(cam.want.zoom * 0.85, ZOOM[0], ZOOM[1]); e.preventDefault(); }
    else if (e.key === "-") { cam.want.zoom = clamp(cam.want.zoom / 0.85, ZOOM[0], ZOOM[1]); e.preventDefault(); }
    else if (e.key === "0") api.resetView();
  });
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";

  // ---- the loop
  let raf = 0, last = 0, clock = 0, running = false;
  const tmp = new THREE.Vector3();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    last = now;
    if (!w || document.hidden) return;

    const inputs = {};
    let busy = 0, sel = null;
    for (const a of agents) { const st = getState(a.id) ?? {}; inputs[a.id] = { busy: !!st.busy, selected: !!st.selected }; if (st.busy) busy++; if (st.selected) sel = a.id; }
    if (!paused) { clock += dt; sim.update(dt, inputs, { lookHeading: cam.az }); }
    for (const ev of sim.drainEvents()) if (ev.type === "done") people.get(ev.id).flash = now + DONE_MS;

    // the camera follows the person you are chatting with, and goes back to the overview when you stop
    if (sel !== selected) {
      selected = sel;
      userMoved = false;
      if (sel) cam.want.zoom = FOCUS; else { cam.want.zoom = cam.home; cam.want.target.set(0, 0.4, 0.4); }
    }
    if (selected) { const s = sim.snapshot(selected); cam.want.target.set(s.x, 0.9, s.z); }
    const kk = reduceMotion ? 1 : Math.min(1, dt * 4.5);
    cam.az += (cam.want.az - cam.az) * kk; cam.el += (cam.want.el - cam.el) * kk; cam.zoom += (cam.want.zoom - cam.zoom) * kk;
    cam.target.lerp(cam.want.target, kk);
    place(cam.fit * cam.zoom);

    for (const p of people.values()) {
      const s = sim.snapshot(p.agent.id);
      p.ch.hlTarget = hovered === p.agent.id || selected === p.agent.id ? 1 : 0;
      if (!paused) poseCharacter(p.ch, s, clock, dt);
      else poseCharacter(p.ch, s, clock, 0);
      // screens glow and scroll while their owner works
      const scr = screens.items.get(p.agent.id);
      if (scr) {
        const working = s.action === "type" && s.mode === "seated";
        scr.material.color.setScalar(working ? 1 : 0.38);
        if (working && !paused) scr.material.map.offset.y = (scr.material.map.offset.y + dt * 0.35) % 1;
      }
    }
    renderer.render(scene, camera);

    // name tags: in front of the person, a little above their head
    const stg = canvas.getBoundingClientRect();
    for (const p of people.values()) {
      const s = sim.snapshot(p.agent.id), st = getState(p.agent.id) ?? {};
      tmp.set(s.x, 2.05 - 0.38 * s.sit, s.z).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15;
      const x = (tmp.x * 0.5 + 0.5) * stg.width, y = (-tmp.y * 0.5 + 0.5) * stg.height;
      p.tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      p.tag.style.zIndex = String(Math.round(1000 - tmp.z * 500));
      p.tag.hidden = !vis;
      const flashing = p.flash > now;
      const text = st.busy ? (st.status || "sedang bekerja…") : flashing ? "Selesai ✓" : "";
      const state = st.busy ? "work" : flashing ? "done" : "idle";
      if (p.tag.dataset.state !== state) p.tag.dataset.state = state;
      if (p.last !== text) { p.bubble.textContent = text; p.last = text; p.tag.setAttribute("aria-label", `${p.agent.name}, ${p.agent.about}${st.busy ? ", sedang bekerja" : ""}`); }
      p.tag.classList.toggle("is-selected", selected === p.agent.id);
      p.tag.classList.toggle("is-hover", hovered === p.agent.id);
    }
    api.busy = busy;
  };

  const api = {
    busy: 0,
    start() { if (running) return; running = true; last = performance.now(); resize(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    resize,
    setMode(m) { setMode(m); },
    setWander(on) { sim.setWander(on); },
    setPaused(p) { paused = !!p; },
    get paused() { return paused; },
    zoom(f) { cam.want.zoom = clamp(cam.want.zoom * f, ZOOM[0], ZOOM[1]); userMoved = true; },
    resetView() { cam.want.az = HOME.az; cam.want.el = HOME.el; cam.want.zoom = selected ? FOCUS : cam.home; userMoved = false; if (!selected) cam.want.target.set(0, 0.4, 0.4); },
    debug() { return { az: cam.az, el: cam.el, zoom: cam.zoom, fit: cam.fit, target: cam.target.toArray(), want: cam.want.target.toArray(), wantZoom: cam.want.zoom, selected, userMoved, size: [w, h] }; },
    destroy() { api.stop(); ro.disconnect(); renderer.dispose(); stage.remove(); },
  };
  setMode(mode);
  resize();
  if (w) { place(cam.fit * cam.zoom); renderer.render(scene, camera); } // a first picture at once, before the loop gets going (a background tab may delay it)
  return api;
}
