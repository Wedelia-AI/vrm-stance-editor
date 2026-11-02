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

## Backdrops (optional)

`pack/backdrops.json` adds a backdrop picker next to the light switch. Picking a plate shows it behind the model
(the floor grid hides) and switches the light to the plate's period, with the key light from the given side:

```jsonc
{ "backdrops": [
  { "file": "bd-day_meadow.jpg", "period": "day", "side": "right" },        // period: day | evening | night
  { "file": "bd-night_room.jpg", "period": "night", "side": "left" }        // side: where the key light comes from
] }
```

The plates sit next to it in `pack/`. The light presets (day / evening / night, with a warm fill from the other side
at night) match the scene that plays the character, so a stance can be checked against the light it will be seen in.
