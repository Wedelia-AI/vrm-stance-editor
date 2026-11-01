// Motion agent for the stance editor (11-02): serves the editor folder and turns a sentence into goal keys with the
// local Claude Code CLI (`claude -p`, the machine's own login: no API key in the page). Self-check: the editor posts
// a still of every key, Claude looks at them and returns a corrected spec.
// usage: node tools/motion_agent.mjs dist [port=8940] [host=127.0.0.1]   (needs the Claude Code CLI logged in; MOTION_MODEL=sonnet)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const [root, port = '8940', host = '127.0.0.1'] = process.argv.slice(2);
if (!root) { console.error('usage: node motion_agent.mjs <editor dir> [port] [host]'); process.exit(1); }
const MODEL = process.env.MOTION_MODEL || 'sonnet';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.vrm': 'application/octet-stream' };

const FORMAT = `You write key poses for a short habitual motion of an anime girl standing in an idle stance. Reply with ONLY a JSON
object: {"name": "<snake_case>", "note": "<one short Chinese sentence on what you did>", "keys": [ ... ]}.

Each key: {"t": seconds, "ease": "平滑" | "缓入缓出" | "线性", "arms": [goal...], "sliders": {name: value}, "add": {bone: [x, y, z]}}.
- The first key must be {"t": 0} (the stance as is) and the last key must also be a bare stance key (the motion returns),
  e.g. {"t": 2.8, "ease": "缓入缓出"}. Total length 1.5-4 s. Keys 0.2-0.6 s apart; add in-between keys so a hand travels
  around the body instead of through it (e.g. come down in front of the chest before returning).
- arm goal: {"side": "right" | "left", "headPoint": [x, y, z], "finger": [x, y, z], "palm": [x, y, z], "poleHead": [x, y, z]}.
  headPoint = where the WRIST goes, in the HEAD frame: metres, x = her own left, y = up, z = forward (out of her face).
  The fingers extend ~0.08 m beyond the wrist along "finger"; "palm" = the direction the palm faces; "poleHead" = a
  point (head frame) the elbow should bend toward, usually down and out on that side, e.g. right arm [-0.25, -0.55, 0.2].
  Keep the wrist at least ~0.11 m from the head centre sideways and ~0.07 m in front of the face, or the hand sinks
  into the head / hair. A hand not mentioned in a key stays in the stance pose.
- sliders: the stance controls, absolute values (only list the ones you change). Finger curl sliders are % of the relaxed
  curl: 0 = straight, 100 = relaxed, 550 = closed fist. Thumb curl rFThumb/lFThumb 0..100, fold-in rThumbIn/lThumbIn 0..100.
  Index pointing = {rFThumb: 100, rFIndex: 25, rFMiddle: 500, rFRing: 550, rFLittle: 550, rThumbIn: 60}.
- add: extra degrees on a bone after solving, Euler XYZ in the bone's own frame; use it for small repeated swings,
  e.g. a wrist waving {"rightHand": [0, 0, 14]} then [0, 0, -10]. Bones: head, neck, chest, spine, hips, leftHand, rightHand...
Use the body landmarks given (head frame) to place hands precisely. Keep it small, natural and in character.`;

const EXAMPLES = `Examples (her stance, right-handed):
1) "tuck hair behind the right ear":
{"name":"tuck_hair","keys":[{"t":0},
{"t":0.75,"ease":"缓入缓出","arms":[{"side":"right","headPoint":[-0.14,-0.06,0.04],"finger":[0.15,1,0.15],"palm":[1,0,0.3],"poleHead":[-0.22,-0.55,0.3]}],"sliders":{"rFIndex":60,"rFMiddle":60,"rFRing":80,"rFLittle":90,"headTilt":12}},
{"t":1.15,"arms":[{"side":"right","headPoint":[-0.135,-0.02,0.05],"finger":[0.1,0.9,-0.3],"palm":[1,0,0.2],"poleHead":[-0.22,-0.55,0.3]}],"sliders":{"rFIndex":35,"rFMiddle":45,"rFRing":65,"rFLittle":80,"headTilt":15}},
{"t":1.55,"arms":[{"side":"right","headPoint":[-0.13,-0.03,0.025],"finger":[0.1,0.5,-0.85],"palm":[1,0.1,0.1],"poleHead":[-0.22,-0.55,0.3]}],"sliders":{"rFIndex":45,"rFMiddle":55,"rFRing":75,"rFLittle":85,"headTilt":14}},
{"t":2.05,"ease":"缓入缓出","arms":[{"side":"right","headPoint":[-0.13,-0.2,0.07],"finger":[0.2,-0.6,0.5],"palm":[0.8,0,0.3],"poleHead":[-0.2,-0.6,0.1]}],"sliders":{"headTilt":11}},
{"t":2.8,"ease":"缓入缓出"}]}
2) "thinking, index finger taps the chin": right wrist at [-0.02,-0.105,0.115], finger [0.05,1,-0.35], palm [0.3,-0.2,-1], index-pointing sliders,
   left wrist [-0.07,-0.34,0.12] finger [-1,0.1,0.4] palm [0,1,0.2] poleHead [0.25,-0.5,0] (propping the right elbow); taps = keys
   0.25 s apart moving the right wrist y by -0.015 and back; headTilt 12, headPitch -2.
3) "small wave": right wrist [-0.19,-0.13,0.13], finger [0.15,1,0.1], palm [0,0,1], fingers open (rFIndex 15, rFMiddle 15, rFRing 20,
   rFLittle 25), keys every 0.25 s alternating add {"rightHand":[0,0,14]} / [0,0,-10], headTilt 13.`;

function claude(prompt, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', MODEL, '--output-format', 'json', ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
      try { const r = JSON.parse(out).result || ''; const m = r.match(/\{[\s\S]*\}/); resolve(JSON.parse(m[0])); }
      catch (e) { reject(new Error('could not parse the reply: ' + out.slice(0, 300))); }
    });
    p.stdin.end(prompt);
  });
}
function validate(spec) {
  if (!spec || !Array.isArray(spec.keys) || spec.keys.length < 2) throw new Error('spec without keys');
  spec.keys.sort((a, b) => a.t - b.t);
  for (const k of spec.keys) for (const g of k.arms || []) for (const f of ['headPoint', 'finger', 'palm', 'poleHead'])
    if (g[f] && !(Array.isArray(g[f]) && g[f].length === 3 && g[f].every(Number.isFinite))) throw new Error(`bad ${f}`);
  return spec;
}
const context = b => `Body landmarks in the head frame (metres): ${JSON.stringify(b.landmarks)}
Stance sliders you may change: ${JSON.stringify(b.sliders)}
Current stance slider values: ${JSON.stringify(b.stance?.sliders || {})}`;

async function generate(b) {
  return validate(await claude(`${FORMAT}\n\n${EXAMPLES}\n\n${context(b)}\n\nMotion to make: ${b.description}`));
}
async function refine(b) {
  const dir = await mkdtemp(join(tmpdir(), 'motion-'));
  try {
    const files = [];
    for (const [i, d] of (b.shots || []).entries()) { const f = join(dir, `key${i}.jpg`); await writeFile(f, Buffer.from(d.split(',')[1], 'base64')); files.push(f); }
    const prompt = `${FORMAT}\n\n${context(b)}\n\nThe motion "${b.description}" was generated as this spec:\n${JSON.stringify(b.spec)}\n\n` +
      `Stills of each key in order (front view, upper body), read them: ${files.join(', ')}\n` +
      `Check each key against the description: is the hand where it should be (touching, not inside the head/hair/body, visible),` +
      ` are the fingers and palm right, does the head follow naturally, does the hand path avoid the body? Return the corrected` +
      ` full spec (same JSON format), with "note" saying in one Chinese sentence what you changed.`;
    return validate(await claude(prompt, ['--allowedTools', 'Read', '--add-dir', dir]));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url.startsWith('/api/motion')) {
      let body = ''; for await (const c of req) body += c;
      const b = JSON.parse(body); const t0 = Date.now();
      const spec = req.url.startsWith('/api/motion/refine') ? await refine(b) : await generate(b);
      console.log(new Date().toISOString(), req.url, JSON.stringify(b.description), `${Date.now() - t0} ms`, spec.keys.length, 'keys');
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ spec }));
    }
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const f = join(root, path.endsWith('/') ? path + 'editor.html' : path);
    if (!f.startsWith(normalize(root))) { res.writeHead(403); return res.end(); }
    const data = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(data);
  } catch (e) {
    const notFound = e.code === 'ENOENT'; res.writeHead(notFound ? 404 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: notFound ? 'not found' : String(e.message || e) })); if (!notFound) console.error(e);
  }
}).listen(+port, host, () => console.log(`motion agent on http://${host}:${port}/ (model ${MODEL})`));
