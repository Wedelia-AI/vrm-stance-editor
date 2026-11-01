# VRM Stance Editor

A browser tool for giving a VRM character its own standing pose, outfit/colour variant and expression, then
exporting the pose as a looping VRMA idle.

在浏览器里给 VRM 角色摆站姿、换装换色、试表情，并把站姿导出成循环的 VRMA 待机动作。


## Features / 功能

- **Stance / 站姿**: sliders per body part (head tilt, body turn, shoulders, arms, elbows, wrists, legs, knee-in,
  toe-in, weight), per-finger curl with hand presets (relaxed, open, fist, V sign, pointing), and a rotate gizmo:
  click any body part or finger and drag. Camera presets (front, three-quarter, side, back, hands, face), breathing
  preview, day / evening lighting, a reference image overlay.
- **Motion / 动作**: small habitual motions as key poses — add a key from the current stance, pose the next one
  (say, a hand up to the hair), set times and easing, play / loop, and save `motion-<name>.json`.
- **Appearance / 外观**: show or hide each mesh, every morph target of the non-face meshes (lengths, socks, hair
  styles...), replace any material's texture with an image (the original alpha is kept; a baked MToon shade texture
  is re-derived so shaded areas change colour too).
- **Expressions / 表情**: every VRM expression (presets and custom) as a slider.
- **Preset pack (optional) / 预设包**: `pack/pack.json` next to the page adds named colour options, outfit sets, the
  model author's on/off toggles and face presets — see [docs/pack-format.md](docs/pack-format.md).
- Works with VRM 1.0 and VRM 0.x models. Everything runs locally in the browser; nothing is uploaded.

## Use / 使用

```sh
npm install
npm run build          # -> dist/index.html (self-contained)
npm run serve          # http://localhost:8080
```

Open the page and click **载入模型** (load model) to pick a `.vrm`, or put a `model.vrm` in `dist/` to load it on
start. A `pack/` folder in `dist/` is picked up automatically. Serve over HTTP (not `file://`) so the page can read
`model.vrm` and the pack.

**保存姿势** downloads `stance-<name>.json` (stance sliders, per-bone fine offsets, appearance, expressions, and the
resulting pose). Turn it into an idle clip with:

```sh
python tools/pose_vrma.py model.vrm stance-<name>.json idle.vrma 10
```

A saved motion converts the same way (`python tools/pose_vrma.py model.vrm motion-<name>.json habit.vrma`); its
length is the last key's time.

The idle clip holds the pose with slow breathing (chest and shoulders rise, neck counter-rotates so the head stays still)
and a small weight shift of the hips; pin the feet in your player so they stay planted.

### Conventions

Pose values are VRM normalized-bone Euler XYZ degrees: rest = T-pose, facing +Z, the character's left on +X. VRM 0.x
models are turned round and mirrored for you.

## Model licences / 模型许可

This repository contains code only. Models, textures and preset packs made from a commercial model stay with you:
most VRChat / BOOTH model licences forbid redistributing the data, so do not commit them (`.gitignore` already
excludes `*.vrm`, `*.vrma` and `pack/`).

## Licence

MIT © 2026 OLI & CECE INC.
