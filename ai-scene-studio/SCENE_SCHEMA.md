# Format canonique de scène (v1)

La scène et ses révisions sont la **source de vérité** du produit. Le format est du JSON
versionné, indépendant de Three.js et de Blender. Implémentation de référence :
`packages/scene-schema` (Zod). JSON Schema structurel généré : `packages/scene-schema/schema/scene.v1.schema.json`.

## Racine

| Champ                                                                 | Type                                                       | Notes                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `schemaVersion`                                                       | `1`                                                        | Entier. Incrémenté à chaque changement non rétrocompatible.                            |
| `sceneId`                                                             | UUID                                                       | Stable sur toutes les révisions.                                                       |
| `coordinateSystem`                                                    | `{ handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }` | Constantes (voir conventions).                                                         |
| `units`                                                               | `{ length: "meter", angle: "radian" }`                     | Constantes.                                                                            |
| `fps`                                                                 | `{ numerator, denominator }`                               | Rationnel : 24000/1001 = 23,976 i/s exact.                                             |
| `durationFrames`                                                      | entier ≥ 1                                                 |                                                                                        |
| `nodes`, `cameras`, `lights`, `materials`, `animations`, `references` | tableaux                                                   |                                                                                        |
| `renderSettings`                                                      | objet                                                      | Résolution, plage de frames, samples, transparence, motion blur, AA, color management. |

Tous les identifiants sont des UUID **uniques dans toute la scène** (toutes collections
confondues) ; les assets sont référencés par `assetId`, jamais par nom de fichier.

## Conventions

### Axes et unités

- Repère **main droite**, **+Y vers le haut**, **−Z vers l'avant**, unités en **mètres**, angles en **radians**.
- C'est la convention de **glTF 2.0** et de Three.js : import/export glTF et rendu Three.js n'ont **aucune conversion d'axes**.
- Une caméra ou une lumière d'orientation identité regarde vers −Z local, avec +Y local vers le haut.

### Transformations

- `transform = { position: [x,y,z], rotation: [x,y,z,w], scale: [x,y,z] }`.
- Rotation : **quaternion unitaire, ordre XYZW** (tolérance de norme 1e‑4). Pas d'angles d'Euler stockés.
- Composition : `M = T · R · S` ; la transformation monde d'un enfant vaut `M_parent · M_local`.

### Conversion vers Blender (Z-up)

Blender utilise main droite, **+Z vers le haut**, −Y « vers l'avant ». Le passage canonique → Blender
est la rotation de +90° autour de X : `R(x, y, z) = (x, −z, y)`. On applique un **changement de base**
(comme l'importeur glTF de Blender), qui conserve la géométrie :

| Grandeur            | Canonique             | Blender                                                                                                   |
| ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| Position / sommets  | `(x, y, z)`           | `(x, −z, y)`                                                                                              |
| Quaternion          | `[x, y, z, w]` (XYZW) | `(w, x, −z, y)` (ordre WXYZ de Blender)                                                                   |
| Échelle             | `(sx, sy, sz)`        | `(sx, sz, sy)`                                                                                            |
| Caméras et lumières | `q`                   | `q_blender ⊗ Rx(+90°)` : correction locale, car Blender oriente caméras et lumières vers −Z local en Z-up |

La conversion inverse s'obtient en appliquant `R⁻¹(x, y, z) = (x, z, −y)`. Ces formules seront couvertes
par des tests de rendu en phase 4 (axes, cadrage, focales).

### Temps

- Le temps canonique est le **numéro de frame entier** (frame 0 = première image).
- Conversion en secondes (affichage, encodage) : `t = frame × denominator / numerator`.
- L'évaluation de l'animation est déterministe à toute frame, indépendamment de la cadence d'affichage. Seuls
  les sous-échantillonnages internes (motion blur) peuvent évaluer à une frame fractionnaire.

### Caméras physiques

- `focalLengthMm`, `sensorWidthMm`, `sensorHeightMm`, `nearClip`, `farClip` (m), `focusDistance` (m, `null` = pas de profondeur de champ), `aperture` (f-stops).
- **Ajustement capteur horizontal** : `FOVh = 2·atan(sensorWidth / (2·focal))`, puis
  `FOVv = 2·atan(tan(FOVh/2) / aspect)` avec `aspect = width/height` du rendu.
  Équivalents : Blender `sensor_fit = 'HORIZONTAL'` ; Three.js `PerspectiveCamera.fov = FOVv` (en degrés).
- Orthographique : `orthographicHeight` (m) obligatoire, ignoré sinon.

### Lumières

- Unités photométriques glTF (`KHR_lights_punctual`) : lux pour `directional`, candela pour `point`/`spot`.
- Couleurs **linéaires** (pas sRGB). Les conversions vers les unités Blender (W) seront documentées en phase 4.

### Matériaux et couleurs

- Modèle PBR metallic-roughness (glTF). `baseColor`, `emissive` : RGB **linéaire** dans l'espace de travail.
- Espace de travail : `renderSettings.colorManagement.workingSpace` (`linear_rec709` par défaut, `acescg` prévu).
- Les textures couleur sont décodées sRGB → linéaire au chargement ; les textures de données (normales) restent linéaires.

### Nœuds

- `type` : `group`, `empty`, `primitive` (avec `primitive` : cube, sphere, cylinder, plane, cone, torus), `model`, `image_plane` (ces deux derniers exigent `assetId`).
- `renderMode` : `proxy` (contrôle de composition, pas forcément visible au final), `final_3d` (rendu géométrique déterministe), `hybrid` (rendu 3D intégré à des couches IA).
- `locked` : verrouillage des paramètres dans l'éditeur. Il est distinct du verrouillage d'une couche rendue, porté par les versions de rendu, et de la régénération IA.
- `layer`, `passIndex` (entier unique > 0 pour la passe Object ID ; 0 = aucun), `visible`, `castShadow`, `receiveShadow`, `materialOverrides` (`slot` ou `*`).
- Primitives (dimensions unitaires, centrées à l'origine, axe principal +Y) : cube 1 m, sphère Ø 1 m, cylindre/cône Ø 1 m × 1 m, plan 1 × 1 m dans XZ (normale +Y), tore (rayon 0,5 m, tube 0,125 m).

### Animation

- `AnimationTrack = { id, targetId, propertyPath, valueType, extrapolation, keyframes[] }`.
- Propriétés animables (table `ANIMATABLE_PROPERTIES`, extensible) : `transform.position|rotation|scale`, `visible`,
  `camera.focalLengthMm|focusDistance|aperture`, `light.intensity|color`, `material.opacity`.
- `Keyframe = { frame (entier), value, interpolation, inHandle, outHandle }`. L'interpolation porte sur le segment **de cette clé vers la suivante**.
- Interpolations : `step`, `linear`, `bezier` (poignées `{ frameOffset, valueOffset[] }` relatives à la clé), `ease_in`, `ease_out`, `ease_in_out`.
- Rotations : `linear` = **slerp** par le plus court chemin ; `ease_*` = slerp avec temps remappé ; `bezier` interdit (pas de Bézier composante par composante sur un quaternion).
- Booléens : `step` uniquement.
- Extrapolation hors des clés : `constant`, `linear`, `cycle`.

## Validation

`validateScene()` applique la structure **et** l'intégrité : unicité des ID, existence des parents,
absence de cycle, cohérence type/primitive/asset, matériaux référencés, `passIndex` uniques,
`farClip > nearClip`, cônes de spot, cibles et types des pistes, tri strict des keyframes,
dimensions des poignées, plage de rendu dans la durée.

Le JSON Schema ne couvre que la **structure** : le backend devra réimplémenter les règles d'intégrité
(phase 1, Pydantic) et les tester sur les mêmes fixtures (`tests/fixtures/scenes`).

## Migrations

`migrateScene(raw)` lit `schemaVersion`, applique la chaîne `SCENE_MIGRATIONS[N]` (N → N+1),
refuse les versions futures, puis valide le résultat. Règles :

1. Toute modification non rétrocompatible incrémente `CURRENT_SCHEMA_VERSION` et ajoute une migration pure.
2. Les révisions stockées ne sont **jamais** réécrites : la migration se fait à la lecture, et une nouvelle révision est créée à l'enregistrement.
3. Chaque migration est accompagnée d'une fixture « avant/après ».
4. Après modification de `src/scene.ts`, exécuter `pnpm schema:generate` (la CI vérifie que le JSON Schema est à jour).
