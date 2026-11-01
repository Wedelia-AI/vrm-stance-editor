// Hands as spring-bone colliders (11-02, Jack: motions ignored physics): a palm sphere and a finger capsule on each
// raw hand bone, added to every hair / clothes spring except the ones hanging off that arm (its own sleeve straps),
// so a hand passing the hair pushes it aside the way the body colliders already do.
import * as THREE from 'three';
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere, VRMSpringBoneColliderShapeCapsule } from '@pixiv/three-vrm';

export function addHandColliders(vrm, { palm = 0.04, finger = 0.018 } = {}) {
  const sm = vrm.springBoneManager, H = vrm.humanoid; if (!sm || !H) return [];
  vrm.scene.updateMatrixWorld(true);
  const added = [];
  for (const side of ['left', 'right']) {
    const hand = H.getRawBoneNode(`${side}Hand`), mid = H.getRawBoneNode(`${side}MiddleDistal`) || H.getRawBoneNode(`${side}MiddleProximal`);
    if (!hand || !mid) continue;
    const local = w => hand.worldToLocal(w.clone());
    const tipW = mid.getWorldPosition(new THREE.Vector3()), handW = hand.getWorldPosition(new THREE.Vector3());
    const palmC = local(handW.clone().lerp(tipW, 0.35)), tip = local(tipW);
    const sphere = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ offset: palmC, radius: palm }));
    const capsule = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeCapsule({ offset: palmC, tail: tip, radius: finger }));
    hand.add(sphere, capsule);
    const group = { colliders: [sphere, capsule], name: `${side}Hand` };
    const arm = new Set([`${side}Shoulder`, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`].map(b => H.getRawBoneNode(b)).filter(Boolean));
    for (const j of sm.joints) {
      let o = j.bone.parent, own = false; while (o) { if (arm.has(o)) { own = true; break; } o = o.parent; }
      if (!own) j.colliderGroups.push(group);
    }
    added.push(sphere, capsule);
  }
  sm._isSortedJointsDirty = true;   // re-sort so the new colliders' bones are updated before the joints that hit them
  return added;
}
