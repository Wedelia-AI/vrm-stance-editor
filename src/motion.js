// Motion tab (11-02): small habitual motions as key poses. Each key is a snapshot of the stance controls (sliders +
// per-bone fine offsets) at a time; playback slerps every bone between keys with an ease. Saved as motion JSON
// (keys with the resulting bone Euler poses) that tools/pose_vrma.py turns into a VRMA clip.
import * as THREE from 'three';

const EASE = { '平滑': u => u * u * (3 - 2 * u), '缓入缓出': u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2), '线性': u => u };

export function createMotion({ el, box, snapshot, restore, poseOf, status }) {
  let keys = [], playing = false, loop = true, tPlay = 0, name = 'habit', current = -1;
  const D = THREE.MathUtils.degToRad, e = new THREE.Euler();
  const quatsOf = (P, AX) => Object.fromEntries(Object.entries(P).map(([b, p]) => [b, new THREE.Quaternion().setFromEuler(e.set(AX[0] * D(p[0]), AX[1] * D(p[1]), AX[2] * D(p[2]), 'XYZ'))]));
  let cache = null;   // per-key {P, q, hips}
  const build = AX => { cache = keys.map(k => { const P = poseOf(k.state); return { P, q: quatsOf(P, AX), hips: k.state.sliders.weight || 0 }; }); };
  const duration = () => (keys.length ? keys[keys.length - 1].t : 0);

  const list = el('div');
  const nameIn = el('input', { type: 'text', value: name, oninput: () => { name = nameIn.value; } });
  const playBtn = el('button', { textContent: '▶ 播放', className: 'primary', onclick: () => toggle() });
  const loopCb = el('input', { type: 'checkbox', checked: true, onchange: () => { loop = loopCb.checked; } });
  box.append(
    el('h3', { textContent: '小动作（关键帧）' }),
    el('div', { className: 'hint', textContent: '先在「站姿」页摆好起始姿势 → 「添加关键帧」；再摆下一个姿势（比如手抬到耳边）→ 再添加；最后「回到第 1 帧」让动作收回。时间是这一帧出现的秒数。' }),
    el('label', {}, el('span', { textContent: '动作名' }), nameIn, el('span')),
    el('div', { className: 'chips' },
      el('button', { textContent: '＋ 添加关键帧', onclick: () => addKey() }),
      el('button', { textContent: '回到第 1 帧', onclick: () => { if (keys.length) addKey(JSON.parse(JSON.stringify(keys[0].state))); } }),
      playBtn, el('label', { className: 'check', style: 'display:inline-grid' }, loopCb, el('span', { textContent: '循环' }))),
    list,
    el('div', { className: 'chips' },
      el('button', { textContent: '保存动作', className: 'primary', onclick: () => download() }),
      el('label', { className: 'file', style: 'display:inline-block' }, '载入动作', el('input', { type: 'file', accept: '.json', hidden: true, onchange: async ev => { const f = ev.target.files[0]; if (f) load(JSON.parse(await f.text())); } })),
      el('button', { textContent: '清空', onclick: () => { keys = []; current = -1; stopPlay(); render(); } })));

  function addKey(state = snapshot()) {
    const t = keys.length ? +(keys[keys.length - 1].t + 1).toFixed(2) : 0;
    keys.push({ t, ease: '平滑', state }); current = keys.length - 1; cache = null; render();
  }
  function render() {
    list.innerHTML = '';
    keys.forEach((k, i) => {
      const tIn = el('input', { type: 'number', step: 0.1, min: 0, value: k.t, style: 'width:56px', onchange: () => { k.t = Math.max(0, +tIn.value); keys.sort((a, b) => a.t - b.t); cache = null; render(); } });
      const easeSel = el('select', { onchange: () => { k.ease = easeSel.value; } }, ...Object.keys(EASE).map(n => el('option', { value: n, textContent: n, selected: n === k.ease })));
      list.append(el('div', { className: 'key' + (i === current ? ' on' : '') },
        el('b', { textContent: `#${i + 1}` }), tIn, el('span', { textContent: '秒' }), easeSel,
        el('button', { textContent: '编辑', title: '把这一帧的姿势载入到「站姿」页', onclick: () => { stopPlay(); current = i; restore(k.state); render(); } }),
        el('button', { textContent: '覆盖', title: '用当前姿势覆盖这一帧', onclick: () => { k.state = snapshot(); cache = null; current = i; render(); status(`第 ${i + 1} 帧已更新`); } }),
        el('button', { textContent: '删', onclick: () => { keys.splice(i, 1); current = -1; cache = null; render(); } })));
    });
    if (!keys.length) list.append(el('div', { className: 'hint', textContent: '还没有关键帧' }));
  }
  function toggle() { if (playing) stopPlay(); else if (keys.length >= 2) { playing = true; tPlay = 0; playBtn.textContent = '■ 停止'; } else status('至少要 2 个关键帧'); }
  function stopPlay() { playing = false; playBtn.textContent = '▶ 播放'; }
  function toJSON() {
    return { name, loop, keys: keys.map(k => ({ t: k.t, ease: k.ease, state: k.state, pose: poseOf(k.state), hips_offset_cm: [k.state.sliders.weight || 0, 0] })) };
  }
  function download() {
    if (keys.length < 2) return status('至少要 2 个关键帧');
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(toJSON(), null, 1)], { type: 'application/json' })), download: `motion-${name}.json` });
    a.click(); status(`已保存 motion-${name}.json 到「下载」文件夹`);
  }
  function load(j) { name = nameIn.value = j.name || 'habit'; loop = loopCb.checked = j.loop !== false; keys = (j.keys || []).map(k => ({ t: k.t, ease: k.ease || '平滑', state: k.state })); cache = null; current = -1; render(); }
  render();

  const qa = new THREE.Quaternion();
  return {
    get playing() { return playing; },
    /** while playing: per-bone quaternions + hips offset (cm) at the current playback time */
    sample(dt, AX) {
      if (!cache) build(AX);
      tPlay += dt; const T = duration();
      if (tPlay > T) { if (loop) tPlay %= Math.max(T, 1e-3); else { tPlay = T; } }
      let i = keys.findIndex(k => k.t > tPlay); if (i < 0) i = keys.length - 1; const a = Math.max(0, i - 1);
      const span = keys[i].t - keys[a].t, u = span > 0 ? EASE[keys[i].ease](THREE.MathUtils.clamp((tPlay - keys[a].t) / span, 0, 1)) : 1;
      const A = cache[a], B = cache[i], q = {};
      for (const b of new Set([...Object.keys(A.q), ...Object.keys(B.q)])) q[b] = qa.copy(A.q[b] || new THREE.Quaternion()).slerp(B.q[b] || new THREE.Quaternion(), u).clone();
      return { q, hips: A.hips + (B.hips - A.hips) * u };
    },
    toJSON, load,
  };
}
