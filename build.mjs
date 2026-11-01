// node build.mjs [outDir=dist] [model.vrm] [reference images...]
// -> outDir/index.html (self-contained: three.js + three-vrm bundled). A model.vrm next to it is loaded on start;
// otherwise pick one with the "载入模型 / Load model" button. An optional pack/pack.json adds presets (docs/pack-format.md).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
const [out = 'dist', model, ...refs] = process.argv.slice(2);
const r = await build({ entryPoints: ['src/editor.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none', target: ['es2020'] });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync(out, { recursive: true });
if (model) copyFileSync(model, `${out}/model.vrm`);
refs.forEach((f, i) => copyFileSync(f, `${out}/ref${i + 1}.png`));
const opts = refs.map((_, i) => `<option value="ref${i + 1}.png">作者图 ${i + 1}</option>`).join('');
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VRM 站姿编辑器</title><style>
:root{--bg:#f6efeb;--panel:#fffaf7;--ink:#3a2c28;--mute:#8a7570;--acc:#c0705a;--line:#e6d8d2}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:14px -apple-system,"PingFang SC",sans-serif}
#app{display:grid;grid-template-columns:1fr 340px;grid-template-rows:auto 1fr;height:100%}
#bar{grid-column:1/3;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--panel)}
#bar input[type=text]{width:120px;padding:5px 8px;border:1px solid var(--line);border-radius:6px}
button,.file{padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);cursor:pointer;font:inherit}
button.primary{background:var(--acc);color:#fff;border-color:var(--acc)}
#status{color:var(--mute);margin-left:auto}
#view{position:relative;min-height:0}#view canvas{display:block;width:100%;height:100%}
#ref{position:absolute;left:10px;top:10px;max-height:70%;max-width:40%;opacity:.85;display:none;pointer-events:none;border-radius:6px;box-shadow:0 2px 10px #0002}
#panel{overflow:auto;padding:6px 14px 30px;border-left:1px solid var(--line);background:var(--panel)}
h3{margin:14px 0 4px;font-size:13px;color:var(--acc)}
label{display:grid;grid-template-columns:96px 1fr 52px;align-items:center;gap:6px;margin:3px 0}
label input{width:100%}.v{text-align:right;color:var(--mute);font-variant-numeric:tabular-nums}
.fine{border:1px dashed var(--line);border-radius:8px;padding:8px;margin-top:8px}.fine button{margin:6px 6px 0 0}
.hint{color:var(--mute)}.sel{font-weight:600;margin-bottom:4px}
.tabs{display:flex;gap:4px;position:sticky;top:0;background:var(--panel);padding:8px 0;z-index:2}.tabs button{flex:1}.tabs button.on,.chips button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}.chips button{padding:3px 8px;font-size:12px}
label.check{grid-template-columns:20px 1fr}details{margin:4px 0}summary{cursor:pointer;color:var(--ink);padding:3px 0}select{max-width:100%}
label span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:760px){#app{grid-template-columns:1fr;grid-template-rows:auto 55vh 1fr}#panel{border-left:0;border-top:1px solid var(--line)}}
</style></head><body><div id="app">
<div id="bar"><input id="name" type="text" value="pose" title="姿势名字 / pose name">
<button id="download" class="primary">保存姿势</button>
<label class="file" style="display:inline-block">载入<input id="openfile" type="file" accept=".json" hidden></label>
<label class="file" style="display:inline-block">载入模型<input id="openmodel" type="file" accept=".vrm" hidden></label>
<button id="reset">恢复初版</button>
<span id="views"></span>
<select id="light" title="灯光"><option value="day">灯光：白天</option><option value="evening">灯光：傍晚</option></select>
<label style="display:inline-flex;gap:4px;margin:0;white-space:nowrap"><input id="breathe" type="checkbox" checked>呼吸</label>
<select id="refsel"><option value="">参考图：无</option>${opts}</select><label class="file" style="display:inline-block">选参考图<input id="refpick" type="file" accept="image/*" hidden></label><input id="refop" type="range" min="20" max="100" value="85" style="width:70px" title="参考图透明度">
<span id="status"></span></div>
<div id="view"><img id="ref" alt=""></div><div id="panel"></div></div>
<script>/* three.js MIT, @pixiv/three-vrm MIT */${js}</script></body></html>`);
console.log('index.html', (js.length / 1024).toFixed(0), 'KB ->', out);
