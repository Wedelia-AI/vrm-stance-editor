# Preset pack format

`pack/pack.json` (relative paths inside it are relative to `pack/`). Every section is optional.

```jsonc
{
  "name": "My model — local only",
  // colour options: each option replaces the base texture of the listed materials (null = the model's own)
  "textures": [
    { "label": "Hair colour", "materials": ["Hair_mat"], "options": [
      { "label": "default", "file": null }, { "label": "pink", "file": "tex/hair_pink.png" } ] }
  ],
  // outfit sets: meshes to show / hide
  "outfits": [ { "label": "Casual", "show": ["Shirt", "Skirt"], "hide": ["Coat"] } ],
  "defaultOutfit": "Casual",
  // on/off toggles (e.g. the model author's menu): what "on" and "off" set
  "toggles": [ { "label": "Cat ears",
                 "on":  { "visible": { "Ears": true },  "morphs": {} },
                 "off": { "visible": { "Ears": false }, "morphs": { "Hair": { "Ears_hole_x": 1 } } } } ],
  // morph names (prefix match) to keep out of the shape list
  "hideMorphs": ["Shrink_"],
  // face presets: morph weights 0..1, applied on top of the VRM expressions; mesh names are informational,
  // a key applies to every mesh that has a morph of that name
  "expressions": [ { "label": "Joy", "group": "1", "morphs": { "Face": { "eye_joy": 1, "mouth_smile": 0.75 } } } ]
}
```

Mesh names are the scene object names three.js gives the VRM's meshes (a multi-material mesh is listed once, by its
group name). Material names are the glTF material names.
