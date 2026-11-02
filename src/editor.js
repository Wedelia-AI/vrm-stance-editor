// Stance editor (11-01, Jack poses the character himself): sliders per body part + click a bone and drag its rotate
// gizmo, author reference image beside, save a pose JSON that tools/pose_vrma.py turns into the idle clip.
// Pose values are VRM normalized-bone Euler XYZ degrees (rest T-pose, faces +Z, character's left = +X).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createAppearance } from './appearance.js';
import { createMotion } from './motion.js';
import { addHandColliders } from './handcolliders.js';

const readFile = name => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest(); x.open('GET', name); x.responseType = 'arraybuffer';
  x.onload = () => (x.status === 0 || x.status === 200) && x.response ? resolve(x.response) : reject(new Error(name));
  x.onerror = () => reject(new Error(name)); x.send();
});
const readJSON = async name => JSON.parse(new TextDecoder().decode(await readFile(name)));

// slider -> bone components. v = slider value; each entry [bone, axis(0..2), fn(v)]
const S = (label, group, def, min, max, targets, unit = '°') => ({ label, group, def, min, max, targets, unit });
const SLIDERS = {
  headTilt: S('歪头（左右）', '头', 9, -25, 25, [['head', 2, v => v], ['neck', 2, v => v * 0.45]]),
  headPitch: S('低头 / 抬头', '头', 4, -20, 25, [['head', 0, v => v], ['neck', 0, v => v * 0.7]]),
  headYaw: S('转头', '头', 6, -40, 40, [['head', 1, v => v], ['neck', 1, v => v * 0.66]]),
  bodyYaw: S('上身转向', '身体', -24, -45, 45, [['hips', 1, v => v * 0.58], ['spine', 1, v => v * 0.17], ['chest', 1, v => v * 0.25]]),
  bodyPitch: S('前倾 / 后仰', '身体', 1, -15, 20, [['spine', 0, v => v], ['chest', 0, v => v * 0.5]]),
  bodyBend: S('侧弯', '身体', 1.5, -12, 12, [['spine', 2, v => v], ['chest', 2, v => v * 0.66]]),
  hipRoll: S('骨盆倾斜', '身体', -2, -12, 12, [['hips', 2, v => v]]),
  weight: S('重心左右', '身体', -1.5, -6, 6, [], 'cm'),
  lShoulder: S('左肩 高低', '肩', -2, -12, 12, [['leftShoulder', 2, v => v]]),
  rShoulder: S('右肩 高低', '肩', -1, -12, 12, [['rightShoulder', 2, v => -v]]),
  lArmOpen: S('左臂 离身角度', '左手', 20, 0, 80, [['leftUpperArm', 2, v => -(90 - v)]]),
  lArmFwd: S('左臂 前后', '左手', 14, -40, 60, [['leftUpperArm', 1, v => v]]),
  lElbow: S('左肘 弯曲', '左手', 14, 0, 120, [['leftLowerArm', 1, v => -v]]),
  lWrist: S('左手腕', '左手', -6, -40, 40, [['leftHand', 2, v => v]]),
  rArmOpen: S('右臂 离身角度', '右手', 19, 0, 80, [['rightUpperArm', 2, v => 90 - v]]),
  rArmFwd: S('右臂 前后', '右手', 12, -40, 60, [['rightUpperArm', 1, v => -v]]),
  rElbow: S('右肘 弯曲', '右手', 14, 0, 120, [['rightLowerArm', 1, v => v]]),
  rWrist: S('右手腕', '右手', 6, -40, 40, [['rightHand', 2, v => v]]),
  fingers: S('手指 弯曲', '手指', 100, 0, 250, [], '%'),
  spread: S('手指 张开', '手指', 100, 0, 300, [], '%'),
  lLegFwd: S('左腿 前后', '左腿', -15, -45, 30, [['leftUpperLeg', 0, v => v]]),
  lKnee: S('左膝 弯曲', '左腿', 26, 0, 70, [['leftLowerLeg', 0, v => v]]),
  lKneeIn: S('左膝 内扣', '左腿', 10, -20, 35, [['leftUpperLeg', 1, v => -v]]),
  lLegSpread: S('左腿 开合', '左腿', 4.5, -10, 20, [['leftUpperLeg', 2, v => v]]),
  lToeIn: S('左脚尖 朝内', '左腿', 12, -25, 35, [['leftFoot', 1, v => -v]]),
  lFootPitch: S('左脚掌 角度', '左腿', -10, -40, 30, [['leftFoot', 0, v => v]]),
  rLegFwd: S('右腿 前后', '右腿', 3, -45, 30, [['rightUpperLeg', 0, v => v]]),
  rKnee: S('右膝 弯曲', '右腿', 6, 0, 70, [['rightLowerLeg', 0, v => v]]),
  rKneeIn: S('右膝 内扣', '右腿', 12, -20, 35, [['rightUpperLeg', 1, v => v]]),
  rLegSpread: S('右腿 开合', '右腿', 3, -10, 20, [['rightUpperLeg', 2, v => -v]]),
  rToeIn: S('右脚尖 朝内', '右腿', 8, -25, 35, [['rightFoot', 1, v => v]]),
  rFootPitch: S('右脚掌 角度', '右腿', -4, -40, 30, [['rightFoot', 0, v => v]]),
};
const CURL = { Index: [14, 16, 10], Middle: [18, 20, 12], Ring: [22, 24, 14], Little: [26, 28, 16] };
// per-hand finger controls (11-01): each finger's curl in % of the relaxed curl, thumb curl and thumb fold-in
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'], FNAME = { Thumb: '拇指', Index: '食指', Middle: '中指', Ring: '无名指', Little: '小指' };
for (const [p, side] of [['l', '左'], ['r', '右']]) {
  for (const f of FINGERS) SLIDERS[`${p}F${f}`] = S(`${FNAME[f]} 弯曲`, `${side}手 手指`, f === 'Thumb' ? 0 : 100, 0, 600, [], '%');
  SLIDERS[`${p}ThumbIn`] = S('拇指 内收', `${side}手 手指`, 0, 0, 100, [], '%');
}
const HAND_PRESETS = {   // finger % (thumb, index, middle, ring, little) + thumb fold-in %
  '自然': [0, 100, 100, 100, 100, 0], '放松张开': [0, 25, 25, 30, 35, 0], '握拳': [100, 550, 550, 550, 550, 100],
  '比V': [100, 10, 10, 550, 550, 100], '指人': [100, 10, 550, 550, 550, 80],
  'OK': [100, 330, 20, 25, 30, 70], '单手比心': [60, 200, 550, 550, 550, 40], '半边爱心': [30, 260, 260, 270, 280, 0],
  '猫爪': [80, 380, 380, 380, 380, 30], '托腮': [0, 150, 150, 170, 190, 0], '捏': [100, 300, 200, 250, 300, 80],
};
const SPREAD = { Index: -4, Middle: 0, Ring: 3, Little: 6 };
const THUMB = 15;
// breathing = chest and shoulders rise, neck/head counter-rotate so the head stays put; no whole-body motion
const BREATH = { spine: [0.3, 0, 0], chest: [0.6, 0, 0], neck: [-0.5, 0, 0], head: [-0.3, 0, 0], leftShoulder: [0, 0, 0.8], rightShoulder: [0, 0, -0.8] };
const SWAY = {};   // weight shift = hips_sway_cm only, applied in the App scene where the feet are pinned

let stop = null;
async function main(modelBuffer) {
  stop?.();   // loading another model: tear the previous one down
  const view = document.getElementById('view');
  view.querySelectorAll('canvas').forEach(c => c.remove());
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
  const key = new THREE.DirectionalLight(0xffffff, 2.6), hemi = new THREE.HemisphereLight(0xf6f7ff, 0xd8d2d0, 0.6); key.position.set(1.2, 3, 1.5);
  const fill = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(key, hemi, fill);
  // same day / evening / night light as the App scene (fill = warm lamps / fairy lights from the other side at night)
  const LIGHTS = { day: [0xffffff, 2.6, 0xf6f7ff, 0xd8d2d0, 0.6, 0xffffff, 0], evening: [0xffc89a, 2.8, 0xffe2cc, 0xb08a80, 0.5, 0xb8b0ff, 0.25],
    night: [0xaebcff, 1.1, 0x6f7db8, 0x2a2636, 0.42, 0xffc48a, 0.8] };
  const lightSel = document.getElementById('light');
  let keySide = 1;
  lightSel.onchange = () => { const L = LIGHTS[lightSel.value]; key.color.setHex(L[0]); key.intensity = L[1]; hemi.color.setHex(L[2]); hemi.groundColor.setHex(L[3]); hemi.intensity = L[4];
    fill.color.setHex(L[5]); fill.intensity = L[6]; key.position.set(1.2 * keySide, 3, 1.5); fill.position.set(-1.4 * keySide, 1.8, 1.8); };
  lightSel.onchange();
  const grid = new THREE.GridHelper(2, 20, 0xb59a90, 0xd9c6be); scene.add(grid);
  // painted backdrops (optional pack/backdrops.json: [{ file, period, side }]): picking one shows it behind her and
  // switches the light to its period / side, like the App scene does by the clock
  const bdSel = document.getElementById('backdrop');
  readJSON('pack/backdrops.json').then(B => {
    const PZ = { day: '白天', evening: '傍晚', night: '夜晚' }; bdSel.length = 1;   // a reloaded model rebuilds the list
    for (const b of B.backdrops || []) bdSel.append(Object.assign(document.createElement('option'), { value: b.file, textContent: `背景：${PZ[b.period] || b.period} · ${b.file.replace(/^bd-|\.jpg$/g, '')}` }));
    bdSel.hidden = false;
    bdSel.onchange = () => { const b = (B.backdrops || []).find(x => x.file === bdSel.value);
      view.style.background = b ? `url(pack/${b.file}) center/cover no-repeat` : ''; grid.visible = !b;
      if (b) { keySide = b.side === 'left' ? -1 : 1; lightSel.value = b.period in LIGHTS ? b.period : 'day'; lightSel.onchange(); } };
  }).catch(() => {});

  const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
  const vrm = (await loader.parseAsync(modelBuffer || await readFile('model.vrm'), '')).userData.vrm;
  VRMUtils.removeUnnecessaryVertices(vrm.scene); vrm.scene.traverse(o => { o.frustumCulled = false; });
  // VRM 0.x faces -Z with the character's left on -X: turn it round, and mirror the pose's X/Z rotation axes
  const vrm0 = vrm.meta?.metaVersion === '0'; if (vrm0) VRMUtils.rotateVRM0(vrm);
  addHandColliders(vrm);   // hands push hair / clothes springs aside
  const AX = vrm0 ? [-1, 1, -1] : [1, 1, 1];
  scene.add(vrm.scene);
  const N = n => vrm.humanoid.getNormalizedBoneNode(n);
  const hips = N('hips'), hips0 = hips.position.clone();
  vrm.scene.updateMatrixWorld(true);
  const H = hips.getWorldPosition(new THREE.Vector3()).y;

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, H * 0.95, 0); camera.position.set(0, H * 1.05, 4.6); orbit.update();
  const gizmo = new TransformControls(camera, renderer.domElement); gizmo.setMode('rotate'); gizmo.setSpace('local'); gizmo.size = 0.7;
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });

  // state
  const val = Object.fromEntries(Object.entries(SLIDERS).map(([k, s]) => [k, s.def]));
  let fine = {};   // bone -> [x,y,z] degrees added on top of the sliders
  let breathe = true, selected = null, t = 0;
  const basePose = (V = val) => {
    const P = {};
    const add = (b, a, d) => { (P[b] ||= [0, 0, 0])[a] += d; };
    for (const [k, s] of Object.entries(SLIDERS)) for (const [b, a, f] of s.targets) add(b, a, f(V[k]));
    for (const side of ['left', 'right']) {
      const sg = side === 'left' ? -1 : 1;
      for (const [f, segs] of Object.entries(CURL)) ['Proximal', 'Intermediate', 'Distal'].forEach((g, i) => {
        add(`${side}${f}${g}`, 2, sg * segs[i] * V.fingers / 100 * V[`${side[0]}F${f}`] / 100);
        if (i === 0) add(`${side}${f}${g}`, 1, -sg * SPREAD[f] * V.spread / 100);
      });
      const tc = V[`${side[0]}FThumb`] / 100, ti = V[`${side[0]}ThumbIn`] / 100;
      // thumb: swing across the palm (fold-in), then curl the two outer joints toward the palm
      add(`${side}ThumbMetacarpal`, 1, -sg * (THUMB + 35 * ti)); add(`${side}ThumbMetacarpal`, 0, 20 * ti);
      add(`${side}ThumbProximal`, 1, -sg * 30 * tc); add(`${side}ThumbDistal`, 1, -sg * 35 * tc);
    }
    return P;
  };
  const fullPose = (V = val, F = fine) => {
    const P = basePose(V);
    for (const [b, f] of Object.entries(F)) { P[b] ||= [0, 0, 0]; for (let a = 0; a < 3; a++) P[b][a] += f[a]; }
    for (const b of Object.keys(P)) P[b] = P[b].map(x => Math.round(x * 10) / 10);
    return P;
  };
  const D = THREE.MathUtils.degToRad, e = new THREE.Euler();
  const bq = new THREE.Quaternion(); let lastExpr = null;
  const apply = dt => {
    const bs = Math.sin(2 * Math.PI * t / 4.2), ss = Math.sin(2 * Math.PI * t / 10);
    const M = motion?.playing ? motion.sample(dt, AX) : null, P = M ? null : fullPose(); lastExpr = M?.expr || null;
    for (const b of Object.keys(vrm.humanoid.humanBones)) {
      const node = N(b); if (!node || (gizmo.dragging && node === selected?.node)) continue;
      const br = breathe ? (BREATH[b] || [0, 0, 0]) : [0, 0, 0], sw = breathe ? (SWAY[b] || [0, 0, 0]) : [0, 0, 0];
      if (M) {   // motion playback: slerped key pose, breathing on top
        node.quaternion.copy(M.q[b] || bq.identity()).multiply(bq.setFromEuler(e.set(AX[0] * D(br[0] * bs + sw[0] * ss), AX[1] * D(br[1] * bs + sw[1] * ss), AX[2] * D(br[2] * bs + sw[2] * ss), 'XYZ')));
        continue;
      }
      const p = P[b] || [0, 0, 0];
      node.quaternion.setFromEuler(e.set(AX[0] * D(p[0] + br[0] * bs + sw[0] * ss), AX[1] * D(p[1] + br[1] * bs + sw[1] * ss), AX[2] * D(p[2] + br[2] * bs + sw[2] * ss), 'XYZ'));
    }
    hips.position.copy(hips0); hips.position.x += AX[0] * (M ? M.hips : val.weight) / 100;   // no sway preview here: the editor has no foot pinning
  };

  // gizmo edits become per-bone fine offsets
  gizmo.addEventListener('objectChange', () => {
    if (!selected) return;
    const base = basePose()[selected.name] || [0, 0, 0];
    e.setFromQuaternion(selected.node.quaternion, 'XYZ');
    fine[selected.name] = [e.x, e.y, e.z].map((r, a) => Math.round((AX[a] * THREE.MathUtils.radToDeg(r) - base[a]) * 10) / 10);
    showFine();
  });

  // click a body part -> nearest humanoid bone
  const PICK = ['head', 'neck', 'chest', 'spine', 'hips', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm',
    'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
    ...['left', 'right'].flatMap(sd => FINGERS.flatMap(f => (f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal']).map(g => `${sd}${f}${g}`)))];
  const ray = new THREE.Raycaster(), m = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4 || gizmo.dragging) return;
    const r = renderer.domElement.getBoundingClientRect(); m.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(m, camera); const hit = ray.intersectObject(vrm.scene, true)[0]; if (!hit) return;
    let best = null, bd = 1e9; const w = new THREE.Vector3();
    for (const b of PICK) { const n = N(b); if (!n) continue;
      // distance to the bone segment (head .. first child), so a click on a forearm picks the forearm
      const a = n.getWorldPosition(new THREE.Vector3()), c = n.children.find(x => x.isObject3D && x.position.lengthSq() > 1e-6);
      const seg = new THREE.Line3(a, c ? c.getWorldPosition(new THREE.Vector3()) : a.clone()); seg.closestPointToPoint(hit.point, true, w);
      const d = w.distanceTo(hit.point); if (d < bd) { bd = d; best = b; } }
    select(best);
  });
  const select = name => { selected = name ? { name, node: N(name) } : null; if (selected) gizmo.attach(selected.node); else gizmo.detach(); showFine(); };

  // ---- panel
  const el = (tag, attrs = {}, ...kids) => { const x = document.createElement(tag); Object.assign(x, attrs); kids.forEach(k => x.append(k)); return x; };
  const root = document.getElementById('panel'); root.innerHTML = '';
  const tabs = { pose: el('div'), motion: el('div'), appearance: el('div'), expression: el('div') }, tabBar = el('div', { className: 'tabs' });
  for (const [k, lab] of [['pose', '站姿'], ['motion', '动作'], ['appearance', '外观'], ['expression', '表情']]) {
    const b = el('button', { textContent: lab, onclick: () => { for (const [n, d] of Object.entries(tabs)) d.hidden = n !== k; tabBar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); } });
    tabBar.append(b); if (k === 'pose') b.classList.add('on'); else tabs[k].hidden = true;
  }
  root.append(tabBar, tabs.pose, tabs.motion, tabs.appearance, tabs.expression);
  const panel = tabs.pose;
  const pack = await readJSON('pack/pack.json').catch(() => null);
  const app = createAppearance({ vrm, pack, el, tabs });
  const inputs = {};
  let group = '';
  for (const [k, s] of Object.entries(SLIDERS)) {
    if (s.group !== group) {
      group = s.group; panel.append(el('h3', { textContent: group }));
      if (group.endsWith('手 手指')) {   // hand gesture presets for this hand
        const p = group.startsWith('左') ? 'l' : 'r', row = el('div', { className: 'chips' });
        for (const [lab, v] of Object.entries(HAND_PRESETS)) row.append(el('button', { textContent: lab, onclick: () => {
          FINGERS.forEach((f, i) => { val[`${p}F${f}`] = v[i]; }); val[`${p}ThumbIn`] = v[5];
          for (const k of Object.keys(inputs)) { inputs[k].r.value = val[k]; inputs[k].show(); } } }));
        panel.append(row);
      }
    }
    const out = el('span', { className: 'v' }), r = el('input', { type: 'range', min: s.min, max: s.max, step: 0.5, value: val[k] });
    const show = () => { out.textContent = `${val[k]}${s.unit}`; };
    r.oninput = () => { val[k] = +r.value; show(); }; show(); inputs[k] = { r, show };
    r.ondblclick = () => { val[k] = s.def; r.value = s.def; show(); };
    panel.append(el('label', {}, el('span', { textContent: s.label }), r, out));
  }
  const fineBox = el('div', { className: 'fine' }); panel.prepend(fineBox);
  function showFine() {
    fineBox.innerHTML = '';
    if (!selected) { fineBox.append(el('div', { className: 'hint', textContent: '点人物身上的部位 → 出现旋转圈，拖动细调；双击滑块恢复默认' })); return; }
    const f = fine[selected.name] || [0, 0, 0];
    fineBox.append(el('div', { className: 'sel', textContent: `已选：${selected.name}` }));
    ['前后 X', '扭转 Y', '侧向 Z'].forEach((lab, a) => {
      const out = el('span', { className: 'v', textContent: `${f[a]}°` }), r = el('input', { type: 'range', min: -60, max: 60, step: 0.5, value: f[a] });
      r.oninput = () => { (fine[selected.name] ||= [0, 0, 0])[a] = +r.value; out.textContent = `${r.value}°`; };
      fineBox.append(el('label', {}, el('span', { textContent: lab }), r, out));
    });
    fineBox.append(el('button', { textContent: '清除这根骨头的细调', onclick: () => { delete fine[selected.name]; showFine(); } }),
      el('button', { textContent: '取消选择', onclick: () => select(null) }));
  }
  showFine();

  // toolbar
  const nameIn = document.getElementById('name'), status = document.getElementById('status');
  const toJSON = () => ({ name: nameIn.value || 'pose', sliders: { ...val }, fine, appearance: app.toJSON(), pose: fullPose(), breath: BREATH, sway: SWAY,
    hips_sway_cm: [0.5, 0], hips_offset_cm: [val.weight, 0], breath_s: 4.2, sway_s: 10 });
  const save = () => { try { localStorage.setItem('stance-editor', JSON.stringify(toJSON())); } catch {} };
  const load = j => {
    if (j.sliders) for (const k of Object.keys(SLIDERS)) if (k in j.sliders) val[k] = j.sliders[k];
    fine = j.fine || {}; if (j.name) nameIn.value = j.name; app.load(j.appearance);
    for (const k of Object.keys(inputs)) { inputs[k].r.value = val[k]; inputs[k].show(); } showFine();
  };
  // ---- goal-driven posing for AI motions (11-02): "wrist here (head frame), fingers / palm that way" + slider tweaks
  // per key, solved with two-bone arm IK, stored as editor state (sliders + per-bone fine offsets)
  const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wpos = n => { vrm.scene.updateMatrixWorld(true); return N(n).getWorldPosition(new THREE.Vector3()); };
  const rotW = (bone, q) => { const wq = bone.getWorldQuaternion(new THREE.Quaternion()), pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(q.clone().multiply(wq))); vrm.scene.updateMatrixWorld(true); };
  const headNode = () => { vrm.scene.updateMatrixWorld(true); return N('head'); };
  const fromHead = a => headNode().localToWorld(new THREE.Vector3(a[0] * AX[0], a[1], a[2] * AX[2]));
  const toHead = v3 => { const l = headNode().worldToLocal(v3.clone()); return [l.x * AX[0], l.y, l.z * AX[2]].map(x => Math.round(x * 1000) / 1000); };
  const dirHead = a => new THREE.Vector3(a[0] * AX[0], a[1], a[2] * AX[2]).applyQuaternion(headNode().getWorldQuaternion(new THREE.Quaternion())).normalize();
  function reach(side, T, pole) {
    const up = N(`${side}UpperArm`), lo = N(`${side}LowerArm`);
    const A = wpos(`${side}UpperArm`), B = wpos(`${side}LowerArm`), C = wpos(`${side}Hand`);
    const a = A.distanceTo(B), c = B.distanceTo(C), d = Math.min(A.distanceTo(T), a + c - 1e-4);
    const u = T.clone().sub(A).normalize(), pv = pole.clone().sub(A); pv.sub(u.clone().multiplyScalar(pv.dot(u))).normalize();
    const al = Math.acos(THREE.MathUtils.clamp((a * a + d * d - c * c) / (2 * a * d), -1, 1));
    const Bt = A.clone().add(u.clone().multiplyScalar(a * Math.cos(al))).add(pv.multiplyScalar(a * Math.sin(al)));
    rotW(up, new THREE.Quaternion().setFromUnitVectors(B.clone().sub(A).normalize(), Bt.clone().sub(A).normalize()));
    const B2 = wpos(`${side}LowerArm`), C2 = wpos(`${side}Hand`);
    rotW(lo, new THREE.Quaternion().setFromUnitVectors(C2.clone().sub(B2).normalize(), T.clone().sub(B2).normalize()));
  }
  function orientHand(side, fingerDir, palmDir) {
    const ha = N(`${side}Hand`), f = () => wpos(`${side}MiddleProximal`).sub(wpos(`${side}Hand`)).normalize();
    rotW(ha, new THREE.Quaternion().setFromUnitVectors(f(), fingerDir));
    const pn = () => { const k = wpos(`${side}LittleProximal`).sub(wpos(`${side}IndexProximal`)); const n = f().cross(k).normalize(); return side === 'left' ? n.negate() : n; };
    const cur = pn(), want = palmDir.clone().sub(fingerDir.clone().multiplyScalar(palmDir.dot(fingerDir))).normalize();
    rotW(ha, new THREE.Quaternion().setFromAxisAngle(f(), Math.atan2(cur.clone().cross(want).dot(fingerDir), cur.dot(want))));
  }
  /** body landmarks in the head frame (x = her left, y up, z forward, metres) for the motion prompt */
  function landmarks() {
    const e = ['leftEye', 'rightEye'].map(wpos), eyes = e[0].clone().add(e[1]).multiplyScalar(0.5);
    const L = { eyes: toHead(eyes), leftEye: toHead(e[0]), rightEye: toHead(e[1]) };
    const eh = L.eyes; L.mouth = [eh[0], +(eh[1] - 0.045).toFixed(3), +(eh[2] + 0.005).toFixed(3)]; L.chin = [eh[0], +(eh[1] - 0.075).toFixed(3), +(eh[2] - 0.005).toFixed(3)];
    L.leftEar = [+(eh[0] + 0.075).toFixed(3), +(eh[1] - 0.005).toFixed(3), +(eh[2] - 0.06).toFixed(3)]; L.rightEar = [+(eh[0] - 0.075).toFixed(3), L.leftEar[1], L.leftEar[2]];
    for (const n of ['neck', 'chest', 'hips', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftHand', 'rightHand']) L[n] = toHead(wpos(n));
    return L;
  }
  async function solveSpec(spec, base0 = { sliders: { ...val }, fine: JSON.parse(JSON.stringify(fine)) }) {
    const keys = [], E = window.editor;
    for (const k of spec.keys || []) {
      Object.assign(val, base0.sliders, k.sliders || {}); fine = JSON.parse(JSON.stringify(base0.fine)); E.hold = false; await tick(); E.hold = true; await tick();
      const touched = new Set();
      // named hand shapes per side ({"right": "比V"}) set that hand's finger sliders
      for (const [sd, name] of Object.entries(k.hands || {})) { const v = HAND_PRESETS[name], p = sd === 'left' ? 'l' : 'r';
        if (v) { FINGERS.forEach((f, i) => { val[`${p}F${f}`] = v[i]; }); val[`${p}ThumbIn`] = v[5]; } }
      if (k.hands) { E.hold = false; await tick(); E.hold = true; await tick(); }
      for (const g of k.arms || []) {
        const side = g.side === 'left' ? 'left' : 'right';
        const T = fromHead(g.headPoint), pole = g.poleHead ? fromHead(g.poleHead) : wpos(`${side}UpperArm`).add(new THREE.Vector3(0, -1, -0.3));
        reach(side, T, pole); touched.add(`${side}UpperArm`).add(`${side}LowerArm`);
        if (g.finger) { orientHand(side, dirHead(g.finger), dirHead(g.palm || [0, 0, 1])); touched.add(`${side}Hand`); }
      }
      const bp = basePose(), f2 = JSON.parse(JSON.stringify(base0.fine)), eu = new THREE.Euler();
      for (const bn of touched) { eu.setFromQuaternion(N(bn).quaternion, 'XYZ'); const bs = bp[bn] || [0, 0, 0];
        f2[bn] = [eu.x, eu.y, eu.z].map((r, a) => Math.round((AX[a] * THREE.MathUtils.radToDeg(r) - bs[a]) * 10) / 10); }
      for (const [bn, d] of Object.entries(k.add || {})) { f2[bn] ||= [0, 0, 0]; d.forEach((x, a) => { f2[bn][a] += x; }); }
      keys.push({ t: k.t, ease: k.ease || '平滑', state: { sliders: { ...val }, fine: f2, expr: k.expr || {} } });
    }
    Object.assign(val, base0.sliders); fine = base0.fine; E.hold = false; window.editor.sync?.(); showFine();
    return keys;
  }
  /** stills of given key states from an upper-body camera (for the AI self-check) */
  // ---- motion baking (11-02, Jack: AI motions stuttered and clipped through the body): every 1/30 s
  // 1. C1 spline through the key poses (Catmull-Rom on quaternions; a key marked 停住 stops there, the ends ease),
  // 2. overlapping action: hands/fingers trail the upper arm, chest/neck/head follow a little later,
  // 3. collision: wrist, finger tips and elbow are pushed out of the author's body colliders and a head sphere,
  //    the arm re-solved with IK, so the hand travels around the body instead of through it.
  const STOP = new Set(['停住', '缓入缓出']);
  const LAG = b => /Proximal|Intermediate|Distal|Metacarpal/.test(b) ? 0.09 : /Hand$/.test(b) ? 0.06 : /LowerArm$/.test(b) ? 0.03
    : b === 'head' ? 0.08 : b === 'neck' ? 0.06 : b === 'chest' || b === 'upperChest' ? 0.05 : 0;
  const ARM_BONES = side => new Set([`${side}UpperArm`, `${side}LowerArm`, `${side}Hand`].map(b => vrm.humanoid.getRawBoneNode(b)).filter(Boolean));
  function bodyColliders() {   // the author's spring colliders minus the arms' own, plus a head sphere (hair included)
    const arms = new Set([...ARM_BONES('left'), ...ARM_BONES('right')]), out = [];
    for (const c of vrm.springBoneManager?.colliders || []) {
      let o = c.parent, onArm = false; while (o) { if (arms.has(o)) { onArm = true; break; } o = o.parent; }
      if (!onArm && !/leg|foot|knee/i.test(c.parent?.name || '')) out.push(c);
    }
    return out;
  }
  const pushOut = (P, cols, head, margin = 0.012, shs = []) => {   // total push vector to move point P out of the body
    const push = new THREE.Vector3(), d = new THREE.Vector3();
    for (const sh of shs) push.add(shellPush(P.clone().add(push), sh));
    for (const c of cols) {
      c.updateWorldMatrix(true, false);
      const dist = c.shape.calculateCollision(c.colliderMatrix, P.clone().add(push), margin, d);
      if (dist < 0) push.addScaledVector(d, -dist);
    }
    const hc = head.c, r = head.r + margin, v = P.clone().add(push).sub(hc), l = v.length();
    if (l < r) push.addScaledVector(v.normalize(), r - l);
    return push;
  };
  // Outer shells from the model's own meshes (clothes and hair included): vertices weighted to the torso / head, in
  // that bone's frame, sliced every 3 cm along its up axis, 24 angular sectors, max radius per sector.
  const SLICE = 0.03, SECT = 24;
  function buildShell(boneName, pick, yMin = -Infinity) {
    const ref = N(boneName), raw = vrm.humanoid.getRawBoneNode(boneName); vrm.scene.updateMatrixWorld(true);
    const inv = ref.matrixWorld.clone().invert(), v = new THREE.Vector3(), slices = new Map();
    vrm.scene.traverse(o => {
      if (!o.isSkinnedMesh || !o.visible) return;
      const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = o.skeleton.bones;
      for (let i = 0; i < g.attributes.position.count; i += 2) {
        let best = 0, bi = 0; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > best) { best = sw.getComponent(i, k); bi = si.getComponent(i, k); }
        if (!pick(bones[bi], raw)) continue;
        o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld).applyMatrix4(inv); if (v.y < yMin) continue;
        const yi = Math.floor(v.y / SLICE); let sl = slices.get(yi); if (!sl) slices.set(yi, sl = new Float32Array(SECT));
        const a = Math.floor(((Math.atan2(v.z, v.x) + Math.PI) / (2 * Math.PI)) * SECT) % SECT; sl[a] = Math.max(sl[a], Math.hypot(v.x, v.z));
      }
    });
    return { ref, slices };
  }
  const under = (b, root) => { while (b) { if (b === root) return true; b = b.parent; } return false; };
  const ARMS = () => ['left', 'right'].flatMap(sd => [`${sd}Shoulder`, `${sd}UpperArm`]).map(b => vrm.humanoid.getRawBoneNode(b)).filter(Boolean);
  function shells() {   // torso (chest frame): everything under the hips except arms and legs; head: everything under the head
    const arms = ARMS(), legs = ['leftUpperLeg', 'rightUpperLeg'].map(b => vrm.humanoid.getRawBoneNode(b)).filter(Boolean);
    const soft = b => { while (b) { if (/skirt|tail|ribbon|belt/i.test(b.name)) return true; b = b.parent; } return false; };
    return [buildShell('chest', (b, r) => under(b, vrm.humanoid.getRawBoneNode('hips')) && !under(b, vrm.humanoid.getRawBoneNode('head')) && !arms.some(a => under(b, a)) && !legs.some(l => under(b, l)) && !soft(b)),
            buildShell('head', (b, r) => under(b, r), -0.03)];   // head + hair down to the chin; long hair / braids below do not block
  }
  function shellPush(P, sh, margin = 0.015) {   // push vector taking P out of a shell (zero when outside)
    const inv = sh.ref.matrixWorld.clone().invert(), l = P.clone().applyMatrix4(inv), sl = sh.slices.get(Math.floor(l.y / SLICE));
    if (!sl) return new THREE.Vector3();
    const a = Math.floor(((Math.atan2(l.z, l.x) + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
    const R = Math.max(sl[a], sl[(a + 1) % SECT], sl[(a + SECT - 1) % SECT]), r = Math.hypot(l.x, l.z);
    if (R === 0 || r >= R + margin) return new THREE.Vector3();
    const dir = r > 1e-4 ? new THREE.Vector3(l.x / r, 0, l.z / r) : new THREE.Vector3(0, 0, 1);
    const out = l.clone().add(dir.multiplyScalar(R + margin - r)).applyMatrix4(sh.ref.matrixWorld);
    return out.sub(P);
  }
  function headSphere() { const h = wpos('head'), up = new THREE.Vector3(0, 1, 0).applyQuaternion(N('head').getWorldQuaternion(new THREE.Quaternion()));
    return { c: h.clone().addScaledVector(up, 0.085), r: 0.105 }; }
  const qPose = P => Object.fromEntries(Object.entries(P).map(([b, p]) => [b, new THREE.Quaternion().setFromEuler(new THREE.Euler(AX[0] * D(p[0]), AX[1] * D(p[1]), AX[2] * D(p[2]), 'XYZ'))]));
  function splineAt(K, Q, b, t) {   // Catmull-Rom on quaternions (component-wise, hemisphere-aligned, normalised)
    const n = K.length; if (t <= K[0].t) return Q[0][b].clone(); if (t >= K[n - 1].t) return Q[n - 1][b].clone();
    let i = 0; while (i < n - 2 && K[i + 1].t <= t) i++;
    const t0 = K[i].t, t1 = K[i + 1].t, h = t1 - t0, u = (t - t0) / h;
    const p0 = Q[i][b], p1 = Q[i + 1][b].clone(); if (p0.dot(p1) < 0) p1.set(-p1.x, -p1.y, -p1.z, -p1.w);
    if (K[i + 1].ease === '线性') return p0.clone().slerp(p1, u);
    const tan = j => { if (j === 0 || j === n - 1 || STOP.has(K[j].ease)) return [0, 0, 0, 0];
      const a = Q[j - 1][b], c = Q[j + 1][b].clone(), m = Q[j][b]; if (m.dot(c) < 0) c.set(-c.x, -c.y, -c.z, -c.w);
      const a2 = m.dot(a) < 0 ? [-a.x, -a.y, -a.z, -a.w] : [a.x, a.y, a.z, a.w], dt = K[j + 1].t - K[j - 1].t;
      return [(c.x - a2[0]) / dt, (c.y - a2[1]) / dt, (c.z - a2[2]) / dt, (c.w - a2[3]) / dt]; };
    const m0 = tan(i), m1 = tan(i + 1), u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const A = [p0.x, p0.y, p0.z, p0.w], B = [p1.x, p1.y, p1.z, p1.w];
    const r = A.map((x, k) => h00 * x + h10 * h * m0[k] + h01 * B[k] + h11 * h * m1[k]);
    return new THREE.Quaternion(...r).normalize();
  }
  async function bakeMotion(keys, fps = 30) {
    if (keys.length < 2) return null;
    const E = window.editor, K = keys.map(k => ({ t: k.t, ease: k.ease })), Q = keys.map(k => qPose(fullPose({ ...val, ...k.state.sliders }, k.state.fine || {})));
    const bones = [...new Set(Q.flatMap(q => Object.keys(q)))]; for (const q of Q) for (const b of bones) q[b] ||= new THREE.Quaternion();
    const hipsW = keys.map(k => (k.state.sliders.weight ?? val.weight) || 0), exprs = keys.map(k => k.state.expr || {});
    const exprNames = [...new Set(exprs.flatMap(x => Object.keys(x)))];
    const T = keys[keys.length - 1].t, frames = [], cols = bodyColliders(); E.hold = true;
    // shells from the first key's pose (arms at rest), so the hands are not part of them
    for (const b of bones) { const n = N(b); if (n) n.quaternion.copy(Q[0][b]); }
    const shs = shells(); let pushed = 0, rest0 = null, residual = 0, worstCm = 0;
    for (let f = 0; f <= Math.round(T * fps); f++) {
      const t = f / fps;
      for (const b of bones) { const n = N(b); if (n) n.quaternion.copy(splineAt(K, Q, b, Math.max(0, t - LAG(b)))); }
      // hips weight / expressions: same spline timing as the keys, scalar Hermite with zero end tangents
      let i = 0; while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
      const u = THREE.MathUtils.clamp((t - keys[i].t) / Math.max(1e-6, keys[i + 1].t - keys[i].t), 0, 1), s = u * u * (3 - 2 * u);
      hips.position.copy(hips0); hips.position.x += AX[0] * (hipsW[i] + (hipsW[i + 1] - hipsW[i]) * s) / 100;
      vrm.scene.updateMatrixWorld(true);
      const head = headSphere();
      if (f === 0) rest0 = { left: wpos('leftHand'), right: wpos('rightHand') };
      for (const side of ['left', 'right']) for (let it = 0; it < 3; it++) {
        if (wpos(`${side}Hand`).distanceTo(rest0[side]) < 0.05) break;   // an arm still at its stance keeps the stance as authored
        const pts = [`${side}Hand`, `${side}MiddleDistal`, `${side}IndexDistal`, `${side}LowerArm`].map(wpos);
        const pushes = pts.map(P => pushOut(P, cols, head, 0.012, shs)); const worst = pushes.reduce((a, p) => (p.length() > a.length() ? p : a));
        if (worst.length() < 1e-4) break;
        if (it === 0) pushed++;
        const elbowPush = pushes[3], handQ = N(`${side}Hand`).getWorldQuaternion(new THREE.Quaternion());
        const target = pts[0].clone().add(worst), pole = pts[3].clone().add(elbowPush).addScaledVector(elbowPush.clone().normalize(), elbowPush.length() > 1e-4 ? 0.05 : 0);
        if (elbowPush.length() < 1e-4) pole.add(new THREE.Vector3(side === 'left' ? 0.05 : -0.05, 0, 0).multiplyScalar(AX[0]));
        reach(side, target, pole);
        const ha = N(`${side}Hand`), pq = ha.parent.getWorldQuaternion(new THREE.Quaternion()); ha.quaternion.copy(pq.invert().multiply(handQ)); vrm.scene.updateMatrixWorld(true);
      }
      // residual check (after the fixes): deepest point still inside the body / head shells on a moving arm
      for (const side of ['left', 'right']) { if (wpos(`${side}Hand`).distanceTo(rest0[side]) < 0.05) continue;
        for (const n of [`${side}Hand`, `${side}MiddleDistal`, `${side}IndexDistal`, `${side}LowerArm`]) {
          const d = pushOut(wpos(n), cols, headSphere(), 0, shs).length(); if (d > 0.005) { residual++; worstCm = Math.max(worstCm, d * 100); } } }
      const pose = {}, eu = new THREE.Euler();
      for (const b of bones) { const n = N(b); if (!n) continue; eu.setFromQuaternion(n.quaternion, 'XYZ'); pose[b] = [eu.x, eu.y, eu.z].map((r, a) => Math.round(AX[a] * THREE.MathUtils.radToDeg(r) * 100) / 100); }
      const ex = {}; for (const e of exprNames) { const a = exprs[i][e] || 0, c = exprs[i + 1][e] || 0; ex[e] = Math.round((a + (c - a) * s) * 1000) / 1000; }
      frames.push({ t: Math.round(t * 1000) / 1000, pose, hips_offset_cm: [(hipsW[i] + (hipsW[i + 1] - hipsW[i]) * s), 0], expr: ex });
    }
    E.hold = false; hips.position.copy(hips0);
    frames.pushed = pushed;   // frames where a hand / elbow had to be moved out of the body
    frames.residual = residual; frames.worstCm = +worstCm.toFixed(1);
    return frames;
  }
  async function keyShots(states) {
    const E = window.editor, saved = { sliders: { ...val }, fine }, cp = camera.position.clone(), ct = orbit.target.clone();
    const h = wpos('head'); camera.position.set(h.x + 0.05, h.y - 0.1, h.z + 1.6); orbit.target.set(h.x, h.y - 0.22, h.z); orbit.update();
    const shots = [];
    for (const st of states) { Object.assign(val, st.sliders); fine = st.fine; await tick(); await tick(); renderer.render(scene, camera); shots.push(renderer.domElement.toDataURL('image/jpeg', 0.8)); }
    Object.assign(val, saved.sliders); fine = saved.fine; camera.position.copy(cp); orbit.target.copy(ct); orbit.update(); await tick();
    return shots;
  }
  /** stills of six evenly spaced baked frames (the AI self-check looks at the path, not only the keys) */
  async function frameShots(frames) {
    const E = window.editor, cp = camera.position.clone(), ct = orbit.target.clone(), h = wpos('head');
    camera.position.set(h.x + 0.05, h.y - 0.1, h.z + 1.6); orbit.target.set(h.x, h.y - 0.22, h.z); orbit.update();
    const idx = [...new Set([0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map(f => Math.round(f * (frames.length - 1))))], images = [], times = [];
    E.hold = true;
    for (const i of idx) {
      const F = frames[i]; for (const [b, p] of Object.entries(F.pose)) N(b)?.quaternion.setFromEuler(new THREE.Euler(AX[0] * D(p[0]), AX[1] * D(p[1]), AX[2] * D(p[2]), 'XYZ'));
      app.beforeUpdate(F.expr); vrm.update(0); app.afterUpdate(); renderer.render(scene, camera); images.push(renderer.domElement.toDataURL('image/jpeg', 0.8)); times.push(F.t);
    }
    E.hold = false; camera.position.copy(cp); orbit.target.copy(ct); orbit.update(); await tick();
    return { images, times };
  }
  const motion = createMotion({ el, box: tabs.motion, status: m => { status.textContent = m; }, bake: bakeMotion,
    ai: { solve: solveSpec, landmarks, shots: keyShots, frameShots, handPresets: Object.keys(HAND_PRESETS), expressions: (vrm.expressionManager?.expressions || []).map(x => x.expressionName), sliderNames: Object.fromEntries(Object.entries(SLIDERS).map(([k, s]) => [k, `${s.group} ${s.label} (${s.min}..${s.max}${s.unit}, default ${s.def})`])) },
    snapshot: () => ({ sliders: { ...val }, fine: JSON.parse(JSON.stringify(fine)), expr: { ...app.toJSON().expr } }),
    restore: st => { load({ sliders: st.sliders, fine: JSON.parse(JSON.stringify(st.fine || {})) }); app.load({ expr: st.expr || {} }); },
    poseOf: st => fullPose({ ...val, ...st.sliders }, st.fine || {}) });
  document.getElementById('download').onclick = () => {
    const j = toJSON(), a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' })), download: `stance-${j.name}.json` });
    a.click(); status.textContent = `已保存 stance-${j.name}.json 到「下载」文件夹`;
  };
  document.getElementById('reset').onclick = () => { for (const k of Object.keys(SLIDERS)) val[k] = SLIDERS[k].def; fine = {}; load({}); status.textContent = '已恢复初版站姿'; };
  document.getElementById('breathe').onchange = ev => { breathe = ev.target.checked; };
  document.getElementById('openfile').onchange = async ev => { const f = ev.target.files[0]; if (f) { load(JSON.parse(await f.text())); status.textContent = `已载入 ${f.name}`; } };
  const views = { '正面': [0, 0], '侧前': [35, 0], '侧面': [90, 0], '背面': [180, 0] };
  const vb = document.getElementById('views'); vb.innerHTML = '';
  for (const [lab, [yaw]] of Object.entries(views)) vb.append(el('button', { textContent: lab, onclick: () => {
    const r = 4.6, a = D(yaw); camera.position.set(Math.sin(a) * r, H * 1.05, Math.cos(a) * r); orbit.target.set(0, H * 0.95, 0); orbit.update(); } }));
  for (const [lab, sd] of [['左手', 'left'], ['右手', 'right']]) vb.append(el('button', { textContent: lab, onclick: () => {
    // aim at the palm (wrist .. middle fingertip), camera in front and a little to the outside
    const h = N(`${sd}Hand`).getWorldPosition(new THREE.Vector3()).lerp(N(`${sd}MiddleDistal`).getWorldPosition(new THREE.Vector3()), 0.5);
    camera.position.set(h.x * 1.6, h.y + 0.04, h.z + 0.55); orbit.target.copy(h); orbit.update(); } }));
  vb.append(el('button', { textContent: '脸部', onclick: () => {
    const h = N('head').getWorldPosition(new THREE.Vector3()); camera.position.set(0, h.y + 0.06, h.z + 0.75); orbit.target.set(0, h.y + 0.05, h.z); orbit.update(); } }));
  // reference images
  const ref = document.getElementById('ref'), refSel = document.getElementById('refsel'), refOp = document.getElementById('refop');
  document.getElementById('refpick').onchange = ev => { const f = ev.target.files[0]; if (f) { ref.src = URL.createObjectURL(f); ref.style.display = 'block'; } };
  refSel.onchange = () => { ref.src = refSel.value; ref.style.display = refSel.value ? 'block' : 'none'; };
  refOp.oninput = () => { ref.style.opacity = refOp.value / 100; };
  try { const saved = localStorage.getItem('stance-editor'); if (saved) { load(JSON.parse(saved)); status.textContent = '已恢复上次未保存的编辑'; } } catch {}

  const resize = () => { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  const clock = new THREE.Clock(); let lastSave = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05); t += dt;
    if (!window.editor?.hold) apply(dt); app.beforeUpdate(motion.playing ? lastExpr : null); vrm.update(dt); app.afterUpdate(); renderer.render(scene, camera);
    if (t - lastSave > 1) { lastSave = t; save(); }
  });
  // scripting API (11-02): an agent can read the base pose, write per-bone offsets and hold the pose while it solves
  window.editor = { vrm, val, get fine() { return fine; }, toJSON, select, app, motion, motionJSON: () => motion.toJSON(),
    base: () => basePose(), pose: () => fullPose(), setFine: f => { fine = f; showFine(); }, hold: false, AX, sync: () => { for (const k of Object.keys(inputs)) { inputs[k].r.value = val[k]; inputs[k].show(); } } };
  stop = () => { renderer.setAnimationLoop(null); gizmo.detach(); gizmo.dispose(); orbit.dispose(); renderer.dispose(); removeEventListener('resize', resize); };
  status.textContent = pack ? `已载入预设包：${pack.name}` : '';
}
main().catch(err => { document.getElementById('status').textContent = '没找到 model.vrm，请点「载入模型」选一个 VRM 文件'; console.error(err); });
document.getElementById('openmodel').onchange = async ev => { const f = ev.target.files[0]; if (f) main(await f.arrayBuffer()).catch(e => { document.getElementById('status').textContent = String(e); }); };
