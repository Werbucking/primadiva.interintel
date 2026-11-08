/* Soft Ring Lab: a mass-spring soft body rendered with SVG.
 *
 * The ring is two loops of nodes (inner edge and outer edge) joined by
 * edge, thickness and shear springs. The outer loop is tethered to its rest
 * shape like tissue anchored in place. Springs stiffen sharply as they near
 * the stretch limit, which is what gives the material its high tear
 * resistance. Swiping up pushes a tapered, round-nosed probe up through
 * the ring. Its cross-section where it crosses the ring plane widens as it
 * goes deeper and pushes the inner edge outward; the ring pushes back, so
 * stiffer shapes open less. Friction drags the inner lip along with the
 * probe, which the side view shows. The probe comes from the viewer's side
 * of the screen, so the main view looks down its length. A rhythm shortens the springs' rest lengths so the ring
 * tightens and relaxes like a muscle.
 */
(() => {
  "use strict";

  const N = 72;                 // nodes per loop
  const C = { x: 300, y: 300 }; // centre of the stage
  const THICK = 58;             // ring wall thickness at rest
  const SUBSTEPS = 10;
  const DT = 1 / 60 / SUBSTEPS;
  const SVGNS = "http://www.w3.org/2000/svg";

  // Each shape has its own feel. Stiffness scales every spring, stretch is
  // the strain ratio where the material starts to lock up, softness lowers
  // damping (more jiggle), tear sets how hard the lock-up is.
  const SHAPES = {
    O: {
      label: "Round and even. Medium stiffness, stretches evenly all the way round.",
      stiffness: 0.55, stretch: 2.0, softness: 0.55, tear: 0.85,
      outline: () => circle(92),
      palette: ["#ffd9c9", "#ee9f8f", "#c96f6f", "#8c3d4f"],
    },
    V: {
      label: "Narrow and firm. The stiffest ring, with the shortest stretch.",
      stiffness: 0.85, stretch: 1.55, softness: 0.35, tear: 0.9,
      outline: () => roundPoly([[-112, -78], [112, -78], [0, 102]], 4),
      palette: ["#ffe0cf", "#f0aa8c", "#cf7a66", "#93453f"],
    },
    A: {
      label: "Wide-based and supple. The softest ring, with the longest stretch.",
      stiffness: 0.35, stretch: 2.6, softness: 0.75, tear: 0.8,
      outline: () => roundPoly([[0, -108], [110, 86], [-110, 86]], 4),
      palette: ["#ffd6d6", "#ec9aa4", "#c76a7e", "#86395a"],
    },
  };

  // ---------- geometry helpers ----------
  function circle(r) {
    const pts = [];
    for (let i = 0; i < 240; i++) {
      const a = (i / 240) * Math.PI * 2 - Math.PI / 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }

  // Chaikin corner cutting rounds a polygon into a soft outline.
  function roundPoly(pts, iterations) {
    let p = pts;
    for (let k = 0; k < iterations; k++) {
      const q = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = q;
    }
    // centre on the centroid so the expander sits in the middle
    let cx = 0, cy = 0;
    for (const v of p) { cx += v[0]; cy += v[1]; }
    cx /= p.length; cy /= p.length;
    return p.map(v => [v[0] - cx, v[1] - cy]);
  }

  // Resample a closed outline into n points evenly spaced by arc length.
  function resample(pts, n) {
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push(len);
      total += len;
    }
    const out = [];
    let seg = 0, acc = 0;
    for (let k = 0; k < n; k++) {
      const d = (k / n) * total;
      while (acc + segs[seg] < d) { acc += segs[seg]; seg++; }
      const t = (d - acc) / segs[seg];
      const a = pts[seg], b = pts[(seg + 1) % pts.length];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  function normals(pts) {
    return pts.map((p, i) => {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[(i + 1) % pts.length];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]);
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      if (nx * p[0] + ny * p[1] < 0) { nx = -nx; ny = -ny; } // point outward
      return [nx, ny];
    });
  }

  // Closed Catmull-Rom spline through the points, as an SVG path.
  function smoothPath(xs, ys, reverse) {
    const n = xs.length;
    const idx = i => {
      const j = ((i % n) + n) % n;
      return reverse ? n - 1 - j : j;
    };
    let d = `M${xs[idx(0)].toFixed(1)} ${ys[idx(0)].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p0 = idx(i - 1), p1 = idx(i), p2 = idx(i + 1), p3 = idx(i + 2);
      const c1x = xs[p1] + (xs[p2] - xs[p0]) / 6, c1y = ys[p1] + (ys[p2] - ys[p0]) / 6;
      const c2x = xs[p2] - (xs[p3] - xs[p1]) / 6, c2y = ys[p2] - (ys[p3] - ys[p1]) / 6;
      d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${xs[p2].toFixed(1)} ${ys[p2].toFixed(1)}`;
    }
    return d + "Z";
  }

  // ---------- simulation state ----------
  const M = 2 * N; // inner nodes 0..N-1, outer nodes N..2N-1
  const px = new Float64Array(M), py = new Float64Array(M);
  const vx = new Float64Array(M), vy = new Float64Array(M);
  const fx = new Float64Array(M), fy = new Float64Array(M);
  const restX = new Float64Array(M), restY = new Float64Array(M);
  let springs = []; // {a, b, rest, k, kind}
  let innerEdges = []; // indices into springs for strain display

  let shapeKey = "O";
  const mat = {};

  const state = {
    probeR: 0,        // current probe radius at the ring plane
    depth: 0,         // 0..1 how far the probe has been pushed in
    depthVel: 0,      // depth change per second, for friction drag
    tipZ: -0.2,       // probe tip height relative to the ring plane, in nose lengths
    probeTarget: 0,
    lip: 0,           // inner lip deflection from friction, -1..1
    swipe: 0,         // 0..1 from the active gesture
    hold: 0,          // 0..1 from the slider
    pulse: true,
    bpm: 36,
    tone: 0.22,
    phase: 0,
    contraction: 0,
    peakStrain: 0,
    integrity: 1,
    stretchPct: 0,
    baseInner: 90,
  };

  function build(key) {
    shapeKey = key;
    const s = SHAPES[key];
    const inner = resample(s.outline(), N);
    const nrm = normals(inner);
    const outer = inner.map((p, i) => [p[0] + nrm[i][0] * THICK, p[1] + nrm[i][1] * THICK]);

    let avg = 0;
    for (let i = 0; i < N; i++) {
      restX[i] = C.x + inner[i][0]; restY[i] = C.y + inner[i][1];
      restX[N + i] = C.x + outer[i][0]; restY[N + i] = C.y + outer[i][1];
      avg += Math.hypot(inner[i][0], inner[i][1]);
    }
    state.baseInner = avg / N;
    for (let i = 0; i < M; i++) {
      px[i] = restX[i]; py[i] = restY[i]; vx[i] = 0; vy[i] = 0;
    }

    springs = [];
    innerEdges = [];
    const add = (a, b, kind) => {
      springs.push({ a, b, rest: Math.hypot(restX[b] - restX[a], restY[b] - restY[a]), kind });
      return springs.length - 1;
    };
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      innerEdges.push(add(i, j, "edge"));    // inner circumference
      add(N + i, N + j, "edge");             // outer circumference
      add(i, N + i, "wall");                 // wall thickness
      add(i, N + j, "shear");
      add(j, N + i, "shear");
      add(i, (i + 2) % N, "bend");           // keeps the inner edge smooth
    }

    Object.assign(mat, {
      stiffness: s.stiffness, stretch: s.stretch, softness: s.softness, tear: s.tear,
    });
    applyPalette(s.palette);
    state.peakStrain = 0;
    state.integrity = 1;
    syncMaterialUI();
  }

  // ---------- physics ----------
  function step() {
    const kBase = 900 + mat.stiffness * 5200;
    const limit = mat.stretch - 1;                 // strain where lock-up begins
    const lock = 4 + mat.tear * 36;                // how hard it locks up
    const damping = 3.2 - mat.softness * 2.6;      // velocity damping per second
    const c = state.contraction * state.tone;      // muscle shortening 0..0.5

    fx.fill(0); fy.fill(0);

    for (let s = 0; s < springs.length; s++) {
      const sp = springs[s];
      const a = sp.a, b = sp.b;
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const len = Math.hypot(dx, dy) || 1e-6;
      let rest = sp.rest;
      let k = kBase;
      if (sp.kind === "edge") { rest *= 1 - c; }        // circular muscle fibres
      else if (sp.kind === "wall") {                  // wall thickens as it tightens
        rest *= 1 + c * 0.6;
        k *= len < rest ? 2.4 : 0.8;                   // resists being squashed thin
      }
      else if (sp.kind === "shear") { k *= 0.45; }
      else if (sp.kind === "bend") { k *= 0.12; }
      // strain stiffening: gentle at first, very stiff past the limit.
      // Measured against the relaxed length so muscle tone alone never
      // counts as stretching the material.
      const strain = (len - sp.rest) / sp.rest;
      if (strain > 0) {
        const r = strain / limit;
        k *= 1 + Math.min(lock * r * r * r, 60);
      }
      const f = k * (len - rest) / Math.max(rest, 1);
      const ux = dx / len, uy = dy / len;
      fx[a] += f * ux; fy[a] += f * uy;
      fx[b] -= f * ux; fy[b] -= f * uy;
    }

    // tethers: outer loop is anchored firmly, inner loop gently keeps its shape
    const tetherOuter = 260 + mat.stiffness * 900;
    const tetherInner = 20 + mat.stiffness * 120;
    const shrink = 1 - c * 0.7;
    // the surrounding tissue gives way as the ring opens, so the wall keeps
    // most of its thickness instead of being pinned in place
    const give = state.stretchPct * state.baseInner * 0.8;
    for (let i = 0; i < M; i++) {
      const outer = i >= N;
      let tx, ty;
      if (outer) {
        const dx = restX[i] - C.x, dy = restY[i] - C.y;
        const d = Math.hypot(dx, dy) || 1;
        tx = restX[i] + (dx / d) * give; ty = restY[i] + (dy / d) * give;
      } else {
        tx = C.x + (restX[i] - C.x) * shrink; ty = C.y + (restY[i] - C.y) * shrink;
      }
      const kt = outer ? tetherOuter : tetherInner;
      fx[i] += (tx - px[i]) * kt;
      fy[i] += (ty - py[i]) * kt;
    }

    // expander: soft contact that the ring can push back against
    const r = state.probeR;
    let push = 0;
    if (r > 1) {
      const kc = 9000;
      for (let i = 0; i < M; i++) {
        const dx = px[i] - C.x, dy = py[i] - C.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const pen = r - d;
        if (pen > 0) {
          const f = kc * pen;
          fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
          if (i < N) push += pen;
        }
      }
    }

    for (let i = 0; i < M; i++) {
      vx[i] += fx[i] * DT; vy[i] += fy[i] * DT;
      const damp = Math.exp(-damping * DT);
      vx[i] *= damp; vy[i] *= damp;
      px[i] += vx[i] * DT; py[i] += vy[i] * DT;
    }

    // probe radius: follows the probe's profile, pushed back by the ring
    state.probeR += (state.probeTarget - state.probeR) * Math.min(1, 10 * DT);
    state.probeR -= (push / N) * 0.9;
    if (state.probeR < 0) state.probeR = 0;
  }

  function measure() {
    let peak = 0;
    for (const s of innerEdges) {
      const sp = springs[s];
      const len = Math.hypot(px[sp.b] - px[sp.a], py[sp.b] - py[sp.a]);
      const strain = len / sp.rest - 1;
      sp.strain = strain;
      if (strain > peak) peak = strain;
    }
    state.peakStrain = peak;

    let avg = 0;
    for (let i = 0; i < N; i++) avg += Math.hypot(px[i] - C.x, py[i] - C.y);
    avg /= N;
    state.stretchPct = Math.max(0, avg / state.baseInner - 1);

    // integrity only drops when strain passes well beyond the stretch limit,
    // and the tear resistance setting widens that margin. It heals at rest.
    const limit = mat.stretch - 1;
    const danger = limit * (1.05 + mat.tear * 0.6);
    if (peak > danger) {
      state.integrity = Math.max(0, state.integrity - (peak - danger) * 0.08);
    } else {
      state.integrity = Math.min(1, state.integrity + 0.004);
    }
    // protective reflex: if the ring is badly overloaded, the expander backs off
    if (state.integrity < 0.35) {
      state.swipe *= 0.9;
      state.hold *= 0.96;
      ui.hold.value = state.hold;
      ui.holdOut.textContent = pct(state.hold);
    }
  }

  // ---------- rendering ----------
  const el = id => document.getElementById(id);
  const svg = el("stage");
  const body = el("body"), halo = el("halo"), sheen = el("sheen"), innerShade = el("innerShade");
  const strainG = el("strain"), hint = el("hint");
  const probeG = el("probeG"), probeShaft = el("probeShaft"), probeContact = el("probeContact"),
    probeTip = el("probeTip"), probeContours = el("probeContours");
  const contourRings = [];
  for (let i = 0; i < 4; i++) {
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("cx", C.x); c.setAttribute("cy", C.y);
    probeContours.appendChild(c);
    contourRings.push(c);
  }
  const ix = new Float64Array(N), iy = new Float64Array(N), ox = new Float64Array(N), oy = new Float64Array(N);

  const strainLines = [];
  for (let i = 0; i < N; i++) {
    const l = document.createElementNS(SVGNS, "line");
    l.setAttribute("stroke-linecap", "butt");
    l.setAttribute("stroke-width", "4");
    l.setAttribute("stroke", "#fff4ec");
    l.setAttribute("stroke-opacity", "0");
    strainG.appendChild(l);
    strainLines.push(l);
  }

  function applyPalette(p) {
    const root = document.documentElement.style;
    root.setProperty("--flesh-hi", p[0]);
    root.setProperty("--flesh", p[1]);
    root.setProperty("--flesh-lo", p[2]);
    root.setProperty("--flesh-deep", p[3]);
    root.setProperty("--accent", p[1]);
  }

  function render() {
    for (let i = 0; i < N; i++) {
      ix[i] = px[i]; iy[i] = py[i]; ox[i] = px[N + i]; oy[i] = py[N + i];
    }
    const outerD = smoothPath(ox, oy, false);
    const innerD = smoothPath(ix, iy, true);
    body.setAttribute("d", outerD + innerD);
    halo.setAttribute("d", outerD);
    innerShade.setAttribute("d", smoothPath(ix, iy, false));

    // sheen sits a little inside the outer edge, toward the top-left light
    const sx = new Float64Array(N), sy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      sx[i] = ix[i] * 0.4 + ox[i] * 0.6 - 4;
      sy[i] = iy[i] * 0.4 + oy[i] * 0.6 - 6;
    }
    sheen.setAttribute("d", smoothPath(sx, sy, false));

    // strain highlights on the inner edge: the surface pales as it thins
    const limit = mat.stretch - 1;
    for (let k = 0; k < N; k++) {
      const sp = springs[innerEdges[k]];
      const l = strainLines[k];
      const s = Math.max(0, sp.strain || 0) / limit;
      l.setAttribute("x1", px[sp.a].toFixed(1)); l.setAttribute("y1", py[sp.a].toFixed(1));
      l.setAttribute("x2", px[sp.b].toFixed(1)); l.setAttribute("y2", py[sp.b].toFixed(1));
      l.setAttribute("stroke-opacity", Math.min(0.85, s * 0.7).toFixed(2));
    }

    renderProbe();
    renderSide();

    // muscle tone also deepens the colour slightly
    const c = state.contraction * state.tone;
    body.style.filter = `saturate(${(1 + c * 0.9).toFixed(2)}) brightness(${(1 - c * 0.25).toFixed(2)})`;
  }

  // ---------- HUD ----------
  const pct = v => `${Math.round(v * 100)}%`;
  const hud = {
    depth: el("stDepth"), stretch: el("stStretch"), strain: el("stStrain"), integrity: el("stIntegrity"),
    phase: el("stPhase"), beat: el("beat"),
  };
  let hudTick = 0;
  function updateHud() {
    const c = state.contraction;
    hud.beat.style.transform = `scale(${(0.7 + c * 0.8).toFixed(2)})`;
    hud.beat.style.opacity = (0.45 + c * 0.55).toFixed(2);
    if (++hudTick % 6) return;
    hud.depth.textContent = pct(state.depth);
    hud.stretch.textContent = pct(state.stretchPct);
    hud.strain.textContent = pct(state.peakStrain);
    hud.integrity.textContent = pct(state.integrity);
    hud.integrity.style.color = state.integrity < 0.6 ? "#ffb36b" : "";
    hud.phase.textContent = !state.pulse || state.tone < 0.01 ? "still"
      : c > 0.6 ? "tight" : c > 0.25 ? (state.phaseDir > 0 ? "tightening" : "relaxing") : "relaxed";
  }

  // ---------- probe ----------
  // Round-nosed taper: radius grows along an elliptical nose, then a
  // straight shaft. s is the distance behind the tip in nose lengths.
  const noseProfile = s => (s <= 0 ? 0 : s >= 1 ? 1 : Math.sqrt(1 - (1 - s) * (1 - s)));
  const probeMax = () => state.baseInner * Math.min(mat.stretch, 2.2) * 0.95;

  function updateProbe(dt) {
    const drive = Math.max(state.swipe, state.hold);
    const prev = state.depth;
    state.depth += (drive - state.depth) * Math.min(1, dt * 5);
    state.depthVel = (state.depth - prev) / Math.max(dt, 1e-4);
    state.tipZ = -0.2 + state.depth * 1.25;
    state.probeTarget = noseProfile(state.tipZ) * probeMax();
    // friction: the inner lip is dragged the way the probe moves while in contact
    const contact = state.probeR > 2 ? Math.min(1, state.probeR / 20) : 0;
    const drag = clamp(state.depthVel * 1.6, -1, 1) * contact * (0.4 + mat.softness * 0.6);
    state.lip += (drag - state.lip) * Math.min(1, dt * (3 + mat.stiffness * 6));
  }

  // Looking down the probe from the viewer's side: the near shaft is a
  // translucent disc on top of everything, the nose shows as rings that
  // shrink toward the tip, and the bright ring is where it meets the ring.
  function renderProbe() {
    const R = probeMax();
    // fades in as it approaches from the viewer, fully there once in contact
    const vis = clamp((state.tipZ + 0.2) / 0.35, 0, 1);
    probeG.setAttribute("opacity", vis.toFixed(2));
    if (vis <= 0) return;
    // the near end is closer to the viewer, so it looks a little larger
    // while the probe is still out in front of the ring
    const near = 1 + 0.18 * clamp(1 - state.tipZ, 0, 1);
    probeShaft.setAttribute("r", (R * near).toFixed(1));
    for (let i = 0; i < contourRings.length; i++) {
      const s = (i + 1) / (contourRings.length + 1);   // behind the tip, in nose lengths
      const c = contourRings[i];
      c.setAttribute("r", (R * noseProfile(s)).toFixed(1));
      // rings already past the ring plane sit behind the flesh, so dim them
      const beyond = s < state.tipZ;
      c.setAttribute("stroke-opacity", (beyond ? 0.12 : 0.3).toFixed(2));
      c.setAttribute("stroke-dasharray", beyond ? "3 5" : "none");
    }
    probeContact.setAttribute("r", state.probeR.toFixed(1));
    probeContact.setAttribute("stroke-opacity", state.probeR > 2 ? "0.7" : "0");
    probeTip.setAttribute("r", (6 + 4 * clamp(1 - state.tipZ, 0, 1)).toFixed(1));
  }

  // ---------- side view ----------
  const side = {
    probe: el("sideProbe"), wallL: el("sideWallL"), wallR: el("sideWallR"),
  };
  const SV = { cx: 100, plane: 92, sc: 0.36, h: 32, bottom: 200, top: 0 };

  function wallPath(xi, xo, lip, dir) {
    // one half of the ring's cross-section: a soft rounded slab whose inner
    // lip is pulled up or down by friction
    const h = SV.h, y = SV.plane;
    const ly = y + lip * 22;           // lip centre (dragged away from the viewer as it goes in)
    const xm = (xi + xo) / 2;
    const d = dir; // -1 left, +1 right (outward)
    return `M${xo} ${y - h / 2}` +
      `C${xm} ${y - h / 2 - 2} ${xi + d * 6} ${ly - h / 2} ${xi} ${ly - h * 0.3}` +
      `Q${xi - d * 4} ${ly} ${xi} ${ly + h * 0.3}` +
      `C${xi + d * 6} ${ly + h / 2} ${xm} ${y + h / 2 + 2} ${xo} ${y + h / 2}` +
      `Q${xo + d * 8} ${y} ${xo} ${y - h / 2}Z`;
  }

  function renderSide() {
    let ri = 0, ro = 0;
    for (let i = 0; i < N; i++) {
      ri += Math.hypot(px[i] - C.x, py[i] - C.y);
      ro += Math.hypot(px[N + i] - C.x, py[N + i] - C.y);
    }
    ri = (ri / N) * SV.sc; ro = (ro / N) * SV.sc;
    side.wallL.setAttribute("d", wallPath(SV.cx - ri, SV.cx - ro, state.lip, -1));
    side.wallR.setAttribute("d", wallPath(SV.cx + ri, SV.cx + ro, state.lip, 1));

    // probe silhouette coming down from the viewer at the top: tip points
    // down, shaft runs off the top edge
    const R = probeMax() * SV.sc;
    const nose = R * 1.25;
    const tipY = SV.plane + state.tipZ * nose;
    let right = "", left = [];
    for (let k = 0; k <= 16; k++) {
      const s = k / 16;
      const x = R * noseProfile(s);
      const y = tipY - s * nose;
      right += `L${(SV.cx + x).toFixed(1)} ${y.toFixed(1)}`;
      left.unshift(`L${(SV.cx - x).toFixed(1)} ${y.toFixed(1)}`);
    }
    const end = Math.min(tipY - nose, -10);
    const d = `M${SV.cx} ${tipY.toFixed(1)}${right}L${SV.cx + R} ${end}L${SV.cx - R} ${end}${left.join("")}Z`;
    side.probe.setAttribute("d", d);
  }

  // ---------- rhythm ----------
  function updateRhythm(dt) {
    if (state.pulse) {
      state.phase = (state.phase + dt * state.bpm / 60) % 1;
      // a quick squeeze followed by a slower release
      const p = state.phase;
      const target = p < 0.35 ? Math.sin((p / 0.35) * Math.PI / 2)
        : Math.pow(Math.cos(((p - 0.35) / 0.65) * Math.PI / 2), 1.6);
      state.phaseDir = target > state.contraction ? 1 : -1;
      state.contraction = target;
    } else {
      state.contraction += (0 - state.contraction) * Math.min(1, dt * 3);
    }
  }

  // ---------- input ----------
  let drag = null;
  function svgY(e) {
    const r = svg.getBoundingClientRect();
    return { y: e.clientY, h: r.height };
  }
  svg.addEventListener("pointerdown", e => {
    svg.setPointerCapture(e.pointerId);
    const p = svgY(e);
    drag = { id: e.pointerId, y0: p.y, h: p.h, s0: state.swipe };
    hint.classList.add("gone");
  });
  svg.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y0 - e.clientY; // positive when moving up
    state.swipe = clamp(drag.s0 + dy / (drag.h * 0.55), 0, 1);
  });
  const endDrag = e => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    hint.classList.add("gone");
    setHold(state.hold - e.deltaY * 0.0015);
  }, { passive: false });
  svg.tabIndex = 0;
  svg.addEventListener("keydown", e => {
    if (e.key === "ArrowUp") { setHold(state.hold + 0.05); e.preventDefault(); }
    if (e.key === "ArrowDown") { setHold(state.hold - 0.05); e.preventDefault(); }
  });

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------- controls ----------
  const ui = {
    stiffness: el("stiffness"), stretch: el("stretch"), softness: el("softness"), tear: el("tear"),
    stiffnessOut: el("stiffnessOut"), stretchOut: el("stretchOut"), softnessOut: el("softnessOut"), tearOut: el("tearOut"),
    pulse: el("pulse"), bpm: el("bpm"), tone: el("tone"), bpmOut: el("bpmOut"), toneOut: el("toneOut"),
    hold: el("hold"), holdOut: el("holdOut"), note: el("shapeNote"), tag: el("matTag"),
  };

  function setHold(v) {
    state.hold = clamp(v, 0, 1);
    ui.hold.value = state.hold;
    ui.holdOut.textContent = pct(state.hold);
  }

  function syncMaterialUI() {
    ui.stiffness.value = mat.stiffness; ui.stiffnessOut.textContent = pct(mat.stiffness);
    ui.stretch.value = mat.stretch; ui.stretchOut.textContent = `${mat.stretch.toFixed(2)}×`;
    ui.softness.value = mat.softness; ui.softnessOut.textContent = pct(mat.softness);
    ui.tear.value = mat.tear; ui.tearOut.textContent = pct(mat.tear);
    ui.note.textContent = SHAPES[shapeKey].label;
    ui.tag.textContent = shapeKey;
  }

  for (const key of ["stiffness", "stretch", "softness", "tear"]) {
    ui[key].addEventListener("input", () => {
      mat[key] = parseFloat(ui[key].value);
      // remember the tweak for this shape
      SHAPES[shapeKey][key] = mat[key];
      syncMaterialUI();
    });
  }

  ui.pulse.addEventListener("change", () => { state.pulse = ui.pulse.checked; });
  ui.bpm.addEventListener("input", () => { state.bpm = +ui.bpm.value; ui.bpmOut.textContent = state.bpm; });
  ui.tone.addEventListener("input", () => { state.tone = +ui.tone.value; ui.toneOut.textContent = pct(state.tone); });
  ui.hold.addEventListener("input", () => setHold(+ui.hold.value));
  ui.bpmOut.textContent = state.bpm;
  ui.toneOut.textContent = pct(state.tone);
  setHold(0);

  document.querySelectorAll(".seg button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-checked", String(x === b)));
      build(b.dataset.shape);
    });
  });
  el("reset").addEventListener("click", () => { setHold(0); state.swipe = 0; build(shapeKey); });

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    updateRhythm(dt);
    updateProbe(dt);
    // the swipe springs back once the finger lifts
    if (!drag) state.swipe += (0 - state.swipe) * Math.min(1, dt * 2.2);
    const steps = Math.max(1, Math.round(dt / (1 / 60) * SUBSTEPS));
    for (let i = 0; i < steps; i++) step();
    measure();
    render();
    updateHud();
    requestAnimationFrame(frame);
  }

  build("O");
  render();
  requestAnimationFrame(frame);

  // exposed for automated checks
  window.__ring = { state, mat, build, setHold };
})();
