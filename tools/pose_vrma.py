# Turn a pose saved by the stance editor into a looping VRMA idle: a key pose in VRM normalized space
# (rest = T-pose, faces +Z, character's left = +X; Euler XYZ degrees per humanoid bone, applied in each bone's frame)
# plus slow breathing / weight shift layered on top. Pin the feet in your player (the weight shift moves the hips).
# usage: python pose_vrma.py model.vrm pose.json out.vrma [seconds=8]
# pose.json: {"pose": {"head": [x, y, z], ...}, "breath": {"bone": [x, y, z] amplitude deg, ...},
#             "sway": {"bone": [x, y, z] deg, ...}, "hips_sway_cm": [x, z], "breath_s": 4.2, "sway_s": 7.3}
import json, struct, sys, math
import numpy as np

vrm_path, pose_path, out = sys.argv[1:4]; secs = float(sys.argv[4]) if len(sys.argv) > 4 else 8.0
P = json.load(open(pose_path))
raw = open(vrm_path, 'rb').read(); jl = struct.unpack_from('<I', raw, 12)[0]; G = json.loads(raw[20:20 + jl])
HB = {k: v['node'] for k, v in G['extensions']['VRMC_vrm']['humanoid']['humanBones'].items()}

def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def rot(v, q): return qmul(qmul(q, [*v, 0]), [-q[0], -q[1], -q[2], q[3]])[:3]
def euler(x, y, z):   # XYZ intrinsic, degrees (three.js Euler 'XYZ')
    h = [math.radians(a) / 2 for a in (x, y, z)]
    qx, qy, qz = ([math.sin(h[0]), 0, 0, math.cos(h[0])], [0, math.sin(h[1]), 0, math.cos(h[1])], [0, 0, math.sin(h[2]), math.cos(h[2])])
    return qmul(qmul(qx, qy), qz)

# world rest positions of the model's humanoid nodes, parents = nearest humanoid ancestor
par = {c: i for i, n in enumerate(G['nodes']) for c in n.get('children', [])}
def world(i):
    n = G['nodes'][i]; t = np.array(n.get('translation', [0, 0, 0]), float); q = np.array(n.get('rotation', [0, 0, 0, 1]), float)
    if i not in par: return t, q
    pt, pq = world(par[i]); return pt + rot(t, pq), qmul(pq, q)
node2bone = {v: k for k, v in HB.items()}
def hparent(i):
    while i in par:
        i = par[i]
        if i in node2bone: return node2bone[i]
    return None
W = {b: world(HB[b])[0] for b in HB}
order, seen = [], set()
def visit(b):
    if b in seen: return
    p = hparent(HB[b])
    if p: visit(p)
    seen.add(b); order.append(b)
for b in HB: visit(b)
idx = {b: i for i, b in enumerate(order)}
nodes = []
for b in order:
    p = hparent(HB[b]); t = W[b] - (W[p] if p else 0)
    nodes.append({'name': b, 'translation': [float(x) for x in t]})
for b in order:
    p = hparent(HB[b])
    if p: nodes[idx[p]].setdefault('children', []).append(idx[b])

fps = 30; n = int(secs * fps) + 1; ts = np.arange(n, dtype=np.float32) / fps
bs, ss = P.get('breath_s', 4.2), P.get('sway_s', 7.3)
tracks, bin_ = [], bytearray()
def add(arr):
    off = len(bin_); bin_.extend(np.asarray(arr, np.float32).tobytes()); return off
acc, views = [], []
def accessor(arr, typ, mm=False):
    arr = np.asarray(arr, np.float32); off = add(arr)
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
    a = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
    if mm: a['min'] = [float(arr.min())]; a['max'] = [float(arr.max())]
    acc.append(a); return len(acc) - 1
t_acc = accessor(ts, 'SCALAR', True)
samplers, channels = [], []
names = set(P.get('pose', {})) | set(P.get('breath', {})) | set(P.get('sway', {}))
for b in names:
    if b not in idx: print('skip unknown bone', b); continue
    base = P.get('pose', {}).get(b, [0, 0, 0]); br = P.get('breath', {}).get(b, [0, 0, 0]); sw = P.get('sway', {}).get(b, [0, 0, 0])
    qs = []
    for t in ts:
        a, s = math.sin(2 * math.pi * t / bs), math.sin(2 * math.pi * t / ss)
        qs.append(euler(*[base[k] + br[k] * a + sw[k] * s for k in range(3)]))
    samplers.append({'input': t_acc, 'output': accessor(np.array(qs), 'VEC4'), 'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers) - 1, 'target': {'node': idx[b], 'path': 'rotation'}})
hx, hz = P.get('hips_sway_cm', [0, 0]); ox, oz = P.get('hips_offset_cm', [0, 0])
hp = [nodes[idx['hips']]['translation'][k] for k in range(3)]
pos = [[hp[0] + ox / 100 + hx / 100 * math.sin(2 * math.pi * t / ss), hp[1], hp[2] + oz / 100 + hz / 100 * math.sin(2 * math.pi * t / ss + 1)] for t in ts]
samplers.append({'input': t_acc, 'output': accessor(np.array(pos), 'VEC3'), 'interpolation': 'LINEAR'})
channels.append({'sampler': len(samplers) - 1, 'target': {'node': idx['hips'], 'path': 'translation'}})
J = {'asset': {'version': '2.0', 'generator': 'pose_vrma.py'}, 'extensionsUsed': ['VRMC_vrm_animation'],
     'extensions': {'VRMC_vrm_animation': {'specVersion': '1.0', 'humanoid': {'humanBones': {b: {'node': idx[b]} for b in order}}}},
     'scene': 0, 'scenes': [{'nodes': [idx['hips']]}], 'nodes': nodes, 'animations': [{'name': 'idle', 'samplers': samplers, 'channels': channels}],
     'accessors': acc, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
jb = json.dumps(J, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4); bin_ += b'\0' * (-len(bin_) % 4)
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(jb) + len(bin_)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb
                      + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_))
print('POSE_VRMA_OK', out, len(channels), 'tracks', n, 'frames')
