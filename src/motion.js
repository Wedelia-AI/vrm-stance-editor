// Motion tab (11-02): small habitual motions as key poses. Each key is a snapshot of the stance controls (sliders +
// per-bone fine offsets + expression weights) at a time. Playback and export use the editor's bake: a C1 spline
// through the keys with overlapping action and body-collision push-out, sampled at 30 fps. Saved as motion JSON
// (editable keys + baked frames) that tools/pose_vrma.py turns into a VRMA clip.
import * as THREE from 'three';

const EASE = ['平滑', '停住', '线性'];   // 平滑 = the spline passes through without stopping; 停住 = comes to rest on this key

export function createMotion({ el, box, snapshot, restore, poseOf, status, ai, bake }) {
  let keys = [], playing = false, loop = true, tPlay = 0, name = 'habit', current = -1;
  const D = THREE.MathUtils.degToRad, e = new THREE.Euler();
  const quatsOf = (P, AX) => Object.fromEntries(Object.entries(P).map(([b, p]) => [b, new THREE.Quaternion().setFromEuler(e.set(AX[0] * D(p[0]), AX[1] * D(p[1]), AX[2] * D(p[2]), 'XYZ'))]));
  let cache = null, frames = null;   // cache: dirty flag (null = keys changed); frames: baked 30 fps poses
  const ensureBaked = async () => { if (!cache || !frames) { status('正在计算动作（平滑曲线 + 防穿模）…'); frames = await bake(keys); cache = { quats: [] }; status(`动作已计算：${frames.length} 帧，防穿模修正 ${frames.pushed} 帧，剩余穿模 ${frames.residual} 处（最深 ${frames.worstCm} cm）`); } return frames; };
  const duration = () => (keys.length ? keys[keys.length - 1].t : 0);

  const list = el('div');
  const nameIn = el('input', { type: 'text', value: name, oninput: () => { name = nameIn.value; } });
  const playBtn = el('button', { textContent: '▶ 播放', className: 'primary', onclick: () => toggle() });
  const loopCb = el('input', { type: 'checkbox', checked: true, onchange: () => { loop = loopCb.checked; } });
  // AI: describe a motion, a local service (tools/motion_agent.mjs, Claude) returns goal keys, the editor solves them
  let lastSpec = null, lastDesc = '';
  const desc = el('textarea', { rows: 2, placeholder: '描述一个小动作，例如：害羞地把右边头发别到耳后', style: 'width:100%;box-sizing:border-box;font:inherit;padding:6px;border:1px solid var(--line);border-radius:6px' });
  const aiState = el('div', { className: 'hint' });
  const call = async (path, body) => {
    // window.MOTION_API: the motion service's base URL when the page is served from elsewhere (e.g. a local copy)
    const r = await fetch((window.MOTION_API || '') + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.spec) throw new Error(j.error || `${r.status}`); return j.spec;
  };
  async function aiRun(refine) {
    if (!ai) return;
    const d = refine ? lastDesc : desc.value.trim(); if (!d) return status('先写一句动作描述');
    const t0 = Date.now(); aiState.textContent = refine ? 'AI 正在看截图修改…（约 1–2 分钟）' : 'AI 正在生成…（约 1 分钟）'; stopPlay();
    try {
      const body = { description: d, landmarks: ai.landmarks(), sliders: ai.sliderNames, stance: snapshot(), handPresets: ai.handPresets, expressions: ai.expressions };
      if (refine) { body.spec = lastSpec; const fr = await ensureBaked(); body.shots = await ai.frameShots(fr); body.shotTimes = body.shots.times; body.shots = body.shots.images; }
      const spec = await call(refine ? 'api/motion/refine' : 'api/motion', body);
      const ks = await ai.solve(spec); lastSpec = spec; lastDesc = d;
      load({ name: spec.name || 'ai', loop: true, keys: ks }); await ensureBaked(); playing = true; tPlay = 0; playBtn.textContent = '■ 停止';
      aiState.textContent = `完成（${Math.round((Date.now() - t0) / 1000)} 秒）：${spec.note || ''}`;
    } catch (e) { aiState.textContent = `失败：${e.message}（需要在本机运行动作服务 tools/motion_agent.mjs）`; }
  }
  box.append(
    el('h3', { textContent: 'AI 生成小动作' }), desc,
    el('div', { className: 'chips' }, el('button', { textContent: 'AI 生成', className: 'primary', onclick: () => aiRun(false) }),
      el('button', { textContent: 'AI 自检优化', title: '把每个关键帧截图给 AI 看，按画面修正一轮', onclick: () => { if (lastSpec) aiRun(true); else status('先生成一次'); } })),
    aiState,
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
    keys.push({ t, ease: keys.length ? '停住' : '平滑', state }); current = keys.length - 1; cache = null; render();
  }
  function render() {
    list.innerHTML = '';
    keys.forEach((k, i) => {
      const tIn = el('input', { type: 'number', step: 0.1, min: 0, value: k.t, style: 'width:56px', onchange: () => { k.t = Math.max(0, +tIn.value); keys.sort((a, b) => a.t - b.t); cache = null; render(); } });
      const easeSel = el('select', { title: '平滑：经过这一帧不停顿；停住：在这一帧停下；线性：匀速到这一帧', onchange: () => { k.ease = easeSel.value; cache = null; } }, ...EASE.map(n => el('option', { value: n, textContent: n, selected: n === (k.ease === '缓入缓出' ? '停住' : k.ease) })));
      list.append(el('div', { className: 'key' + (i === current ? ' on' : '') },
        el('b', { textContent: `#${i + 1}` }), tIn, el('span', { textContent: '秒' }), easeSel,
        el('button', { textContent: '编辑', title: '把这一帧的姿势载入到「站姿」页', onclick: () => { stopPlay(); current = i; restore(k.state); render(); } }),
        el('button', { textContent: '覆盖', title: '用当前姿势覆盖这一帧', onclick: () => { k.state = snapshot(); cache = null; current = i; render(); status(`第 ${i + 1} 帧已更新`); } }),
        el('button', { textContent: '删', onclick: () => { keys.splice(i, 1); current = -1; cache = null; render(); } })));
    });
    if (!keys.length) list.append(el('div', { className: 'hint', textContent: '还没有关键帧' }));
  }
  async function toggle() { if (playing) stopPlay(); else if (keys.length >= 2) { await ensureBaked(); playing = true; tPlay = 0; playBtn.textContent = '■ 停止'; } else status('至少要 2 个关键帧'); }
  function stopPlay() { playing = false; playBtn.textContent = '▶ 播放'; }
  function toJSON() {
    return { name, loop, keys: keys.map(k => ({ t: k.t, ease: k.ease, state: k.state, pose: poseOf(k.state), hips_offset_cm: [k.state.sliders.weight || 0, 0] })),
      ...(cache && frames ? { frames } : {}) };
  }
  async function download() {
    if (keys.length < 2) return status('至少要 2 个关键帧');
    await ensureBaked();
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(toJSON(), null, 1)], { type: 'application/json' })), download: `motion-${name}.json` });
    a.click(); status(`已保存 motion-${name}.json 到「下载」文件夹`);
  }
  function load(j) { name = nameIn.value = j.name || 'habit'; loop = loopCb.checked = j.loop !== false; keys = (j.keys || []).map(k => ({ t: k.t, ease: k.ease || '平滑', state: k.state })); cache = null; current = -1; render(); }
  render();

  return {
    get playing() { return playing && !!frames && !!cache; },
    /** while playing: the baked frame's bone quaternions, hips offset (cm) and expression weights */
    sample(dt, AX) {
      if (!frames || !cache) return null;
      tPlay += dt; const T = frames[frames.length - 1].t;
      if (tPlay > T) tPlay = loop ? tPlay % Math.max(T, 1e-3) : T;
      const i = Math.min(frames.length - 1, Math.round(tPlay * 30)), F = frames[i];
      if (!cache.quats[i]) cache.quats[i] = quatsOf(F.pose, AX);
      return { q: cache.quats[i], hips: F.hips_offset_cm[0], expr: F.expr };
    },
    toJSON, load,
  };
}
