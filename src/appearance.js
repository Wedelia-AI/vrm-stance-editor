// Appearance + expression panels for the stance editor (11-01). Works on any VRM 1.0:
// - parts: show / hide each mesh;  shapes: every morph target of the non-face meshes;  textures: drop an image on a
//   material (keeps the material's own alpha);  expressions: every VRM expression (presets + custom).
// An optional preset pack (pack/pack.json next to the page) adds named colour options, outfit sets and face presets.
import * as THREE from 'three';

const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export function createAppearance({ vrm, pack, el, tabs }) {
  const meshes = [], byName = new Map();
  // one entry per part: a multi-material mesh loads as a group of primitive meshes (name, name_1, ...)
  const partName = o => (o.parent && !o.parent.isBone && o.parent.children.length > 1 && o.parent.children.every(c => c.isMesh)) ? o.parent.name : o.name;
  vrm.scene.traverse(o => { if (!o.isMesh) return; const n = partName(o); if (!byName.has(n)) { byName.set(n, []); meshes.push(n); } byName.get(n).push(o); });
  // meshes whose morphs the VRM expressions drive = the face; their morphs belong to the expression tab
  const exprMeshes = new Set();
  for (const ex of vrm.expressionManager?.expressions || []) for (const b of ex._binds || []) for (const p of b.primitives || []) exprMeshes.add(partName(p));
  const morphMeshes = []; vrm.scene.traverse(o => { if (o.isMesh && o.morphTargetDictionary) morphMeshes.push(o); });
  let faceTouched = [];
  const bound = new Map();   // mesh -> morph indices the VRM expressions drive (reset by the expression manager each frame)
  for (const ex of vrm.expressionManager?.expressions || []) for (const b of ex._binds || []) for (const m of b.primitives || []) { if (!bound.has(m)) bound.set(m, new Set()); bound.get(m).add(b.index); }
  const materials = new Map();   // name -> [material]
  vrm.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) { const n = m.name.replace(/ \(Outline\)$/, ''); if (!materials.has(n)) materials.set(n, []); if (!materials.get(n).includes(m)) materials.get(n).push(m); } });
  const origMap = new Map([...materials].map(([n, ms]) => [n, ms[0].map]));
  const origShade = new Map([...materials.values()].flat().map(m => [m, m.shadeMultiplyTexture]));
  const hidden = new Set((pack?.hideMorphs) || []), hideMorph = k => [...hidden].some(h => k.startsWith(h));

  const state = { visible: {}, morphs: {}, textures: {}, expr: {}, face: null, outfit: null, toggles: {} };
  for (const n of meshes) state.visible[n] = byName.get(n).every(o => o.visible);

  // ---- textures
  const texCache = new Map();
  async function setTexture(matName, src, label) {
    const ms = materials.get(matName); if (!ms) return;
    let tex = origMap.get(matName);
    if (src) {
      const key = matName + '|' + src;
      if (!texCache.has(key)) texCache.set(key, (async () => {
        const img = await loadImage(src), o = origMap.get(matName)?.image;
        const c = document.createElement('canvas'); c.width = o?.width || img.width; c.height = o?.height || img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
        // keep the original alpha (cut-out / overlay materials such as the face overlay)
        if (o && ms[0].transparent) {
          const a = document.createElement('canvas'); a.width = c.width; a.height = c.height; const ga = a.getContext('2d'); ga.drawImage(o, 0, 0, c.width, c.height);
          const d = g.getImageData(0, 0, c.width, c.height), da = ga.getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.data.length; i += 4) d.data[i] = da[i]; g.putImageData(d, 0, 0);
        }
        const t = new THREE.CanvasTexture(c); const r = origMap.get(matName);
        if (r) { t.colorSpace = r.colorSpace; t.flipY = r.flipY; t.wrapS = r.wrapS; t.wrapT = r.wrapT; } return t;
      })());
      tex = await texCache.get(key);
    }
    for (const m of ms) {
      if ('map' in m) m.map = tex;
      // a baked shade texture (face: shadow mask applied to the old map) is rebuilt from the new map with the same
      // shade ratio, otherwise the shaded side keeps the old colours (one eye changed, the other not)
      const os = origShade.get(m), om = origMap.get(matName);
      if (os && om && os !== om && os.image && om.image) m.shadeMultiplyTexture = src ? await reshade(matName, src, tex, os, om) : os;
      // MToon: the shade texture follows the base map when it was the same image (a baked shade texture stays)
      if (origShade.get(m) && origShade.get(m) === origMap.get(matName)) m.shadeMultiplyTexture = tex;
      m.needsUpdate = true;
    }
    state.textures[matName] = label ?? src ?? null;
  }

  const shadeCache = new Map();
  function pixels(img, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h); }
  async function reshade(matName, src, tex, os, om) {
    const key = matName + '|' + src;
    if (!shadeCache.has(key)) {
      const w = tex.image.width, h = tex.image.height, nd = pixels(tex.image, w, h), sd = pixels(os.image, w, h).data, md = pixels(om.image, w, h).data;
      for (let i = 0; i < nd.data.length; i += 4) for (let k = 0; k < 3; k++) nd.data[i + k] = Math.min(255, nd.data[i + k] * sd[i + k] / Math.max(md[i + k], 1));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(nd, 0, 0);
      const t = new THREE.CanvasTexture(c); t.colorSpace = os.colorSpace; t.flipY = os.flipY; t.wrapS = os.wrapS; t.wrapT = os.wrapT;
      shadeCache.set(key, t);
    }
    return shadeCache.get(key);
  }
  const setVisible = (n, v) => { state.visible[n] = v; for (const o of byName.get(n) || []) o.visible = v; };
  const setMorph = (mesh, k, v) => { (state.morphs[mesh] ||= {})[k] = v; };

  // ---- panels
  const ui = { parts: {}, morphs: {} };
  const P = tabs.appearance;
  if (pack?.outfits?.length) {
    P.append(el('h3', { textContent: '成套服装' }));
    const row = el('div', { className: 'chips' });
    for (const o of pack.outfits) row.append(el('button', { textContent: o.label, onclick: () => applyOutfit(o.label) }));
    P.append(row);
  }
  if (pack?.toggles?.length) {   // the model author's own on/off menu (each toggle may also set shape keys)
    P.append(el('h3', { textContent: '开关（作者菜单）' }));
    const row = el('div', { className: 'chips' });
    for (const t of pack.toggles) { t._btn = el('button', { textContent: t.label, className: 'on', onclick: () => setToggle(t.label, !state.toggles[t.label]) }); row.append(t._btn); state.toggles[t.label] = true; }
    P.append(row);
  }
  if (pack?.textures?.length) {
    P.append(el('h3', { textContent: '颜色' }));
    for (const g of pack.textures) {
      const sel = el('select', {}, ...g.options.map((o, i) => el('option', { value: i, textContent: o.label })));
      sel.onchange = () => { const o = g.options[+sel.value]; for (const m of g.materials) setTexture(m, o.file ? 'pack/' + o.file : null, o.label); };
      g._sel = sel; P.append(el('label', {}, el('span', { textContent: g.label }), sel, el('span')));
    }
  }
  P.append(el('h3', { textContent: '部件开关' }));
  for (const n of meshes) {
    const cb = el('input', { type: 'checkbox', checked: state.visible[n] }); cb.onchange = () => setVisible(n, cb.checked); ui.parts[n] = cb;
    P.append(el('label', { className: 'check' }, cb, el('span', { textContent: n })));
  }
  P.append(el('h3', { textContent: '形状（衣长、袜子、发型…）' }));
  for (const n of meshes) {
    if (exprMeshes.has(n)) continue;
    const dict = byName.get(n)[0].morphTargetDictionary; if (!dict) continue;
    const keys = Object.keys(dict).filter(k => !hideMorph(k)); if (!keys.length) continue;
    const box = el('details', {}, el('summary', { textContent: `${n}（${keys.length}）` }));
    const inf = byName.get(n)[0].morphTargetInfluences;
    for (const k of keys) {
      const v0 = Math.round((inf[dict[k]] || 0) * 100); setMorph(n, k, v0 / 100);
      const out = el('span', { className: 'v', textContent: v0 }), r = el('input', { type: 'range', min: 0, max: 100, step: 1, value: v0 });
      r.oninput = () => { setMorph(n, k, r.value / 100); out.textContent = r.value; };
      (ui.morphs[n] ||= {})[k] = { r, out };
      box.append(el('label', {}, el('span', { textContent: k, title: k }), r, out));
    }
    P.append(box);
  }
  P.append(el('h3', { textContent: '自己换贴图' }));
  P.append(el('div', { className: 'hint', textContent: '选材质，再选一张图片（PNG/JPG），会保留原贴图的透明区域' }));
  const msel = el('select', {}, ...[...materials.keys()].map(n => el('option', { value: n, textContent: n })));
  const file = el('input', { type: 'file', accept: 'image/*' });
  file.onchange = () => { const f = file.files[0]; if (f) setTexture(msel.value, URL.createObjectURL(f), f.name); };
  P.append(msel, file, el('button', { textContent: '恢复原贴图', onclick: () => setTexture(msel.value, null) }));

  // ---- expressions
  const E = tabs.expression, em = vrm.expressionManager, exprUI = {};
  const presets = (em?.expressions || []).filter(x => !x.isBinary || true);
  E.append(el('h3', { textContent: 'VRM 表情' }));
  const custom = el('details', {}, el('summary', { textContent: '其他（自定义 / 口型细分）' }));
  for (const x of presets) {
    const n = x.expressionName, out = el('span', { className: 'v', textContent: 0 }), r = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 0 });
    r.oninput = () => { state.expr[n] = r.value / 100; out.textContent = r.value; };
    exprUI[n] = { r, out };
    const row = el('label', {}, el('span', { textContent: n, title: n }), r, out);
    (['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'neutral'].includes(n) ? E : custom).append(row);
  }
  E.append(custom);
  if (pack?.expressions?.length) {
    E.append(el('h3', { textContent: '作者表情（点一下套用，再点取消）' }));
    let grp = '', row = null;
    for (const f of pack.expressions) {
      if (f.group !== grp) { grp = f.group; E.append(el('div', { className: 'hint', textContent: grp })); row = el('div', { className: 'chips' }); E.append(row); }
      const b = el('button', { textContent: f.label }); b.onclick = () => setFace(state.face === f.label ? null : f.label); f._btn = b; row.append(b);
    }
  }
  E.append(el('button', { textContent: '表情全部清零', onclick: () => { for (const n of Object.keys(state.expr)) { state.expr[n] = 0; exprUI[n].r.value = 0; exprUI[n].out.textContent = 0; } setFace(null); } }));
  function setFace(label) {
    state.face = label;
    for (const f of pack?.expressions || []) f._btn?.classList.toggle('on', f.label === label);
  }
  function applyEffects(fx) {
    for (const [n, v] of Object.entries(fx.visible || {})) if (byName.has(n)) { setVisible(n, v); if (ui.parts[n]) ui.parts[n].checked = v; }
    for (const [n, ks] of Object.entries(fx.morphs || {})) for (const [k, v] of Object.entries(ks)) {
      setMorph(n, k, v); const u = ui.morphs[n]?.[k]; if (u) { u.r.value = Math.round(v * 100); u.out.textContent = u.r.value; }
    }
  }
  function setToggle(label, on) {
    const t = pack?.toggles?.find(x => x.label === label); if (!t) return;
    state.toggles[label] = on; t._btn?.classList.toggle('on', on); applyEffects(on ? t.on : t.off);
  }
  function applyOutfit(label) {
    const o = pack?.outfits?.find(x => x.label === label); if (!o) return;
    for (const n of o.show) if (byName.has(n)) { setVisible(n, true); ui.parts[n].checked = true; }
    for (const n of o.hide) if (byName.has(n)) { setVisible(n, false); ui.parts[n].checked = false; }
    state.outfit = label;
  }
  if (pack?.defaultOutfit) applyOutfit(pack.defaultOutfit);

  return {
    /** before vrm.update: expression weights */
    beforeUpdate(override) {   // override: a playing motion's expression weights (the sliders' own values come back after)
      if (!em) return;
      for (const n of new Set([...Object.keys(state.expr), ...Object.keys(override || {})])) em.setValue(n, override ? (override[n] ?? 0) : (state.expr[n] ?? 0));
    },
    /** after vrm.update (the expression manager rewrites bound morphs): shapes and author face presets */
    afterUpdate() {
      for (const [n, ks] of Object.entries(state.morphs)) for (const o of byName.get(n) || []) {
        const d = o.morphTargetDictionary; if (d) for (const [k, v] of Object.entries(ks)) if (k in d) o.morphTargetInfluences[d[k]] = v;
      }
      const f = state.face && pack?.expressions?.find(x => x.label === state.face);
      // pack mesh names come from the source tool (Unity 'Body') and rarely match the exported mesh names, so a
      // preset key applies to every mesh that has a morph of that name
      // keys the expression manager does not drive keep whatever was last written: zero what the previous preset
      // set before applying the current one (switching presets stacked them until the features vanished, Jack 11-01)
      for (const [o, i] of faceTouched) if (!bound.has(o) || !bound.get(o).has(i)) o.morphTargetInfluences[i] = 0;
      faceTouched = [];
      if (f) for (const ks of Object.values(f.morphs)) for (const [k, v] of Object.entries(ks)) for (const o of morphMeshes) {
        const i = o.morphTargetDictionary[k]; if (i !== undefined) { o.morphTargetInfluences[i] = Math.max(o.morphTargetInfluences[i], v); faceTouched.push([o, i]); }
      }
    },
    toJSON: () => JSON.parse(JSON.stringify(state)),
    async load(j) {
      if (!j) return;
      if (j.outfit) applyOutfit(j.outfit);
      for (const [l, on] of Object.entries(j.toggles || {})) setToggle(l, on);
      for (const [n, v] of Object.entries(j.visible || {})) if (byName.has(n)) { setVisible(n, v); ui.parts[n].checked = v; }
      for (const [n, ks] of Object.entries(j.morphs || {})) for (const [k, v] of Object.entries(ks)) {
        setMorph(n, k, v); const u = ui.morphs[n]?.[k]; if (u) { u.r.value = Math.round(v * 100); u.out.textContent = u.r.value; }
      }
      for (const [n, v] of Object.entries(j.expr || {})) if (exprUI[n]) { state.expr[n] = v; exprUI[n].r.value = Math.round(v * 100); exprUI[n].out.textContent = exprUI[n].r.value; }
      setFace(j.face || null);
      for (const [m, label] of Object.entries(j.textures || {})) {
        const g = pack?.textures?.find(x => x.materials.includes(m)); const i = g?.options.findIndex(o => o.label === label);
        if (g && i >= 0) { g._sel.value = i; const o = g.options[i]; await setTexture(m, o.file ? 'pack/' + o.file : null, o.label); }
      }
    },
  };
}
