# Décisions d'architecture (ADR)

Chaque décision structurante est consignée ici avec son contexte et ses
conséquences. Une décision n'est pas révisée pour suivre une mode technique
(§1001) mais seulement si son contexte change.

---

## ADR-001 — Le NLE vit dans `nle/`, l'application VALIDEO existante n'est pas touchée

**Contexte.** Le dépôt contient déjà VALIDEO, une application PHP/MySQL de
validation client (commentaires horodatés, annotations SVG). Le cahier des
charges décrit un produit différent : un NLE web.

**Décision.** Le NLE est un monorepo autonome dans `nle/`. Aucun fichier PHP
existant n'est modifié.

**Conséquences.** Les deux produits évoluent séparément. Une passerelle
(ouvrir une séquence NLE depuis une vidéo VALIDEO) reste possible plus tard,
via une frontière explicite. Décision réversible à coût nul.

---

## ADR-002 — Le temps est rationnel et entier, jamais flottant

**Contexte.** §12 l'exige. 23.976 n'existe pas : c'est 24000/1001. Accumuler
`1/23.976` en `number` dérive de plusieurs images sur une timeline longue.

**Décision.** Trois niveaux :

1. `Rational` — fraction exacte `n/d`, normalisée, arithmétique entière. Bascule
   sur `bigint` quand un produit intermédiaire déborde ; **lève** plutôt que de
   retourner un résultat faux.
2. `TimeBase` — cadence rationnelle + mode `NDF`/`DF`.
3. `RationalTime` — **entier d'images** rattaché à une timebase. C'est l'unité
   de travail de tout le moteur.

Les secondes ne servent qu'aux frontières (audio, export, affichage) et sont
alors calculées en rationnel exact, jamais accumulées.

**Conséquences.** Additionner deux temps de timebases différentes **lève une
erreur** ; il faut appeler `rescale()` explicitement. C'est volontairement
pénible : c'est la classe de bug qui désynchronise un montage.

---

## ADR-003 — Le drop-frame est un étiquetage, pas une durée

**Contexte.** Confusion classique : croire que le DF « saute des images ».

**Décision.** `rescale()` ignore le mode DF/NDF. 100 images en 29.97 DF valent
exactement 100 images en 29.97 NDF. Seuls `formatTimecode`/`parseTimecode`
connaissent le drop-frame.

**Conséquences.** `parseTimecode('00:01:00;00', DF)` **lève** : cette étiquette
n'existe pas. Le moteur ne peut pas produire silencieusement un timecode
impossible.

**Fait de métier consigné.** Aucun nombre entier d'images à 30000/1001 ne vaut
exactement une heure (3600 × 30000/1001 = 107892,107…). Le DF ramène
l'étiquette `01:00:00;00` sur 107892 images, qui durent 3599,9964 s : il reste
**3,6 ms d'erreur par heure**. À 44,1 kHz cela fait 159 échantillons — un
moteur qui supposerait 3600 s désynchroniserait l'audio. Test :
`rational-time.test.ts`.

---

## ADR-004 — Unité de ticks interne exacte, distincte de celle d'Adobe

**Contexte.** Adobe utilise 254 016 000 000 ticks/seconde. Cette valeur se
factorise en 2¹⁰ × 3⁴ × 5⁶ × 7² : divisible par 24, 25, 30, 48, 50, 60, 100,
120 — mais **pas par 1001** (= 7 × 11 × 13, il manque 11 et 13). L'unité
d'Adobe n'est donc pas exacte sur les cadences NTSC.

**Décision.** L'unité interne est celle d'Adobe × 143 (= 11 × 13), soit
36 324 288 000 000 ticks/seconde : divisible par 1001 et par toutes les
cadences entières. `ADOBE_TICKS_PER_SECOND` reste exporté pour l'interchange
Adobe, où l'arrondi est alors assumé et documenté.

**Conséquences.** API en `bigint` (une heure ≈ 1,3 × 10¹⁷ ticks, hors entiers
sûrs de JS). Les ticks servent **uniquement** aux frontières d'import/export
(AAF, FCPXML, OTIO) ; le moteur travaille en images entières.

---

## ADR-005 — L'image `n` couvre `[n/rate, (n+1)/rate[`, on échantillonne au centre

**Contexte.** Convertir une source 50 fps vers une timeline 25 fps en
échantillonnant sur la frontière d'image expose aux erreurs d'arrondi de bord.

**Décision.** Convention semi-ouverte, et `sourceFrameAt()` échantillonne au
**centre** de l'image de destination.

**Conséquences.** À cadences identiques, l'image `n` donne exactement l'image
`n` (testé sur 500 images en 25 et en 23.976). Pas de décalage d'une image aux
raccords.
