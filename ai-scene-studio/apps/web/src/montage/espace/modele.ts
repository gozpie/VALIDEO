/**
 * Modèle d'espace de travail : un arbre binaire de découpes (§6, §73).
 *
 * Ce fichier ne connaît ni React, ni le DOM, ni les panneaux réels de VALIDEO.
 * Il manipule des identifiants opaques. C'est ce qui le rend testable sans
 * navigateur, et c'est la même séparation que `timeline-engine` applique au
 * rendu de la timeline (ADR-014).
 *
 * POURQUOI UN ARBRE, ET PAS UNE GRILLE. Une grille CSS impose ses rangées et
 * ses colonnes : déplacer un panneau y demande de recalculer toute la
 * matrice, et certaines dispositions n'y sont tout simplement pas
 * exprimables. Un arbre binaire exprime n'importe quelle disposition
 * rectangulaire, et chaque déplacement n'est qu'une insertion locale.
 *
 * INVARIANTS, tenus par `normaliser()` après chaque opération :
 *  - une zone contient au moins un panneau ;
 *  - le panneau actif d'une zone appartient à cette zone ;
 *  - une division a exactement deux enfants ;
 *  - un panneau n'apparaît qu'une seule fois dans tout l'arbre.
 *
 * Une opération qui violerait un invariant retourne l'arbre inchangé plutôt
 * que de produire une disposition cassée — même règle que les opérations de
 * montage (ADR-011).
 */

/** Côté d'une zone visé par un dépôt. `centre` = ajouter en onglet. */
export type Cote = 'centre' | 'gauche' | 'droite' | 'haut' | 'bas';

/** `colonnes` : enfants côte à côte. `rangees` : enfants l'un sur l'autre. */
export type Axe = 'colonnes' | 'rangees';

/** Feuille : un groupe d'onglets. */
export interface Zone {
  readonly type: 'zone';
  readonly id: string;
  readonly panneaux: readonly string[];
  readonly actif: string;
}

/** Nœud interne : deux enfants séparés par une poignée déplaçable. */
export interface Division {
  readonly type: 'division';
  readonly id: string;
  readonly axe: Axe;
  /** Part du PREMIER enfant, dans ]0, 1[. */
  readonly fraction: number;
  readonly premier: Noeud;
  readonly second: Noeud;
}

export type Noeud = Zone | Division;

/**
 * Bornes d'une fraction. Une division ne peut pas réduire un côté à néant :
 * un panneau invisible mais présent est un piège — on ne le retrouve plus.
 */
export const FRACTION_MIN = 0.08;
export const FRACTION_MAX = 0.92;

/**
 * Repères d'aimantation. Ce sont les proportions qu'un monteur vise
 * réellement : la moitié, les tiers, les quarts. Le seuil est exprimé en
 * PIXELS par l'appelant, pas en fraction : à l'écran, « ça colle » se juge en
 * distance perçue, et une tolérance en fraction serait deux fois plus large
 * sur un panneau deux fois plus petit.
 */
export const REPERES = [0.25, 1 / 3, 0.5, 2 / 3, 0.75] as const;

export function estZone(n: Noeud): n is Zone {
  return n.type === 'zone';
}

/** Borne une fraction dans ]0, 1[ sans jamais produire NaN. */
export function bornerFraction(f: number, min = FRACTION_MIN, max = FRACTION_MAX): number {
  if (!Number.isFinite(f)) return 0.5;
  const bas = Math.min(min, max);
  const haut = Math.max(min, max);
  return Math.min(haut, Math.max(bas, f));
}

/**
 * Aimante une fraction sur le repère le plus proche, si l'écart est sous le
 * seuil. `taillePx` est la taille de la division dans l'axe considéré : c'est
 * elle qui convertit un seuil en pixels en tolérance de fraction.
 */
export function aimanter(
  fraction: number,
  taillePx: number,
  seuilPx: number,
  reperesSupplementaires: readonly number[] = [],
): number {
  if (!Number.isFinite(fraction)) return 0.5;
  if (taillePx <= 0 || seuilPx <= 0) return fraction;
  const tolerance = seuilPx / taillePx;
  let meilleur = fraction;
  let ecartMin = tolerance;
  for (const r of [...REPERES, ...reperesSupplementaires]) {
    const ecart = Math.abs(fraction - r);
    if (ecart < ecartMin) {
      ecartMin = ecart;
      meilleur = r;
    }
  }
  return meilleur;
}

/** Tous les panneaux de l'arbre, dans l'ordre de parcours. */
export function panneauxDe(n: Noeud): string[] {
  if (estZone(n)) return [...n.panneaux];
  return [...panneauxDe(n.premier), ...panneauxDe(n.second)];
}

/** Toutes les zones de l'arbre. */
export function zonesDe(n: Noeud): Zone[] {
  if (estZone(n)) return [n];
  return [...zonesDe(n.premier), ...zonesDe(n.second)];
}

/** La zone qui contient ce panneau, ou `null`. */
export function zoneContenant(n: Noeud, panneau: string): Zone | null {
  return zonesDe(n).find((z) => z.panneaux.includes(panneau)) ?? null;
}

/**
 * Identifiant neuf, dérivé de ceux déjà présents.
 *
 * Volontairement DÉTERMINISTE : pas de `crypto.randomUUID()`. Un modèle pur
 * dont la sortie change à chaque appel ne se teste pas par comparaison, et
 * une disposition enregistrée doit se relire à l'identique.
 */
function idNeuf(n: Noeud, prefixe: 'z' | 'd'): string {
  let max = 0;
  const visiter = (x: Noeud): void => {
    const m = new RegExp(`^${prefixe}(\\d+)$`).exec(x.id);
    if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]));
    if (!estZone(x)) {
      visiter(x.premier);
      visiter(x.second);
    }
  };
  visiter(n);
  return `${prefixe}${max + 1}`;
}

/**
 * Rétablit les invariants : zones vides supprimées, divisions à enfant unique
 * remplacées par cet enfant, panneau actif recalé.
 *
 * Retourne `null` si l'arbre entier est vide — l'appelant décide alors quoi
 * faire, plutôt que de recevoir une zone fantôme.
 */
export function normaliser(n: Noeud): Noeud | null {
  if (estZone(n)) {
    const premierPanneau = n.panneaux[0];
    if (premierPanneau === undefined) return null;
    if (n.panneaux.includes(n.actif)) return n;
    return { ...n, actif: premierPanneau };
  }
  const premier = normaliser(n.premier);
  const second = normaliser(n.second);
  if (premier === null && second === null) return null;
  if (premier === null) return second;
  if (second === null) return premier;
  if (premier === n.premier && second === n.second) return n;
  return { ...n, premier, second };
}

/** Remplace une zone par un nœud quelconque, partout où elle apparaît. */
function remplacerZone(n: Noeud, idZone: string, remplacant: Noeud): Noeud {
  if (estZone(n)) return n.id === idZone ? remplacant : n;
  const premier = remplacerZone(n.premier, idZone, remplacant);
  const second = remplacerZone(n.second, idZone, remplacant);
  if (premier === n.premier && second === n.second) return n;
  return { ...n, premier, second };
}

/** Retire un panneau de toutes les zones, sans normaliser. */
function retirerBrut(n: Noeud, panneau: string): Noeud {
  if (estZone(n)) {
    if (!n.panneaux.includes(panneau)) return n;
    return { ...n, panneaux: n.panneaux.filter((p) => p !== panneau) };
  }
  const premier = retirerBrut(n.premier, panneau);
  const second = retirerBrut(n.second, panneau);
  if (premier === n.premier && second === n.second) return n;
  return { ...n, premier, second };
}

/** Ferme un panneau. Retourne l'arbre inchangé si c'était le dernier. */
export function retirer(n: Noeud, panneau: string): Noeud {
  if (panneauxDe(n).length <= 1) return n;
  return normaliser(retirerBrut(n, panneau)) ?? n;
}

/** Met un panneau au premier plan dans sa zone. */
export function activer(n: Noeud, panneau: string): Noeud {
  if (estZone(n)) {
    if (!n.panneaux.includes(panneau) || n.actif === panneau) return n;
    return { ...n, actif: panneau };
  }
  const premier = activer(n.premier, panneau);
  const second = activer(n.second, panneau);
  if (premier === n.premier && second === n.second) return n;
  return { ...n, premier, second };
}

/** Déplace la poignée d'une division. La fraction est bornée, jamais rejetée. */
export function redimensionner(n: Noeud, idDivision: string, fraction: number): Noeud {
  if (estZone(n)) return n;
  if (n.id === idDivision) {
    const f = bornerFraction(fraction);
    return f === n.fraction ? n : { ...n, fraction: f };
  }
  const premier = redimensionner(n.premier, idDivision, fraction);
  const second = redimensionner(n.second, idDivision, fraction);
  if (premier === n.premier && second === n.second) return n;
  return { ...n, premier, second };
}

/**
 * Dépose un panneau sur une zone, d'un côté donné.
 *
 * Le panneau est d'abord retiré de son emplacement d'origine, PUIS inséré.
 * L'ordre compte : déplacer un panneau à l'intérieur de sa propre zone doit
 * le réordonner, pas le dupliquer.
 *
 * Retourne l'arbre inchangé si le geste n'a pas de sens : zone inconnue,
 * panneau inconnu, ou dépôt d'un panneau seul sur sa propre zone (rien ne
 * bougerait, et la zone d'origine disparaîtrait sous nos pieds).
 */
export function deposer(n: Noeud, panneau: string, idZoneCible: string, cote: Cote): Noeud {
  const source = zoneContenant(n, panneau);
  if (source === null) return n;
  const cible = zonesDe(n).find((z) => z.id === idZoneCible);
  if (cible === undefined) return n;

  const seulDansSaZone = source.panneaux.length === 1;
  if (cible.id === source.id && (cote === 'centre' || seulDansSaZone)) return n;

  if (cote === 'centre') {
    const ampute = retirerBrut(n, panneau);
    // La zone cible relue APRÈS amputation : si le panneau en venait, son
    // contenu a changé, et repartir de l'objet d'origine le ressusciterait.
    const cibleFraiche = zonesDe(ampute).find((z) => z.id === cible.id);
    if (cibleFraiche === undefined) return n;
    const enrichie: Zone = {
      ...cibleFraiche,
      panneaux: [...cibleFraiche.panneaux, panneau],
      actif: panneau,
    };
    return normaliser(remplacerZone(ampute, cible.id, enrichie)) ?? n;
  }

  // Un côté : on divise la zone cible en deux, la nouvelle zone d'un côté.
  const zoneNeuve: Zone = { type: 'zone', id: idNeuf(n, 'z'), panneaux: [panneau], actif: panneau };
  const cibleAmputee = normaliser(retirerBrut(cible, panneau));
  const axe: Axe = cote === 'gauche' || cote === 'droite' ? 'colonnes' : 'rangees';
  const avant = cote === 'gauche' || cote === 'haut';

  // La cible privée du panneau déplacé peut devenir vide : le panneau était
  // seul dans la zone cible. Le dépôt se réduit alors à ne rien faire.
  if (cibleAmputee === null) return n;

  const division: Division = {
    type: 'division',
    id: idNeuf(n, 'd'),
    axe,
    fraction: 0.5,
    premier: avant ? zoneNeuve : cibleAmputee,
    second: avant ? cibleAmputee : zoneNeuve,
  };

  const ampute = retirerBrut(n, panneau);
  return normaliser(remplacerZone(ampute, cible.id, division)) ?? n;
}

/**
 * Réconcilie une disposition relue avec les panneaux réellement disponibles :
 * les inconnus sont retirés, les manquants sont ajoutés dans la zone d'accueil.
 *
 * Sans cette étape, ajouter un panneau à l'application le rendrait invisible
 * pour tout utilisateur ayant déjà une disposition enregistrée — un bug qui ne
 * se voit jamais en développement, puisque le développeur part d'un
 * navigateur vierge.
 */
export function reconcilier(n: Noeud, connus: readonly string[], accueil: string): Noeud | null {
  const presents = new Set(panneauxDe(n));
  let arbre: Noeud | null = n;
  for (const p of presents) {
    if (!connus.includes(p)) arbre = arbre === null ? null : normaliser(retirerBrut(arbre, p));
  }
  if (arbre === null) return null;
  const manquants = connus.filter((p) => !presents.has(p));
  if (manquants.length === 0) return arbre;
  const zoneAccueil = zoneContenant(arbre, accueil) ?? zonesDe(arbre)[0];
  if (zoneAccueil === undefined) return null;
  const enrichie: Zone = { ...zoneAccueil, panneaux: [...zoneAccueil.panneaux, ...manquants] };
  return normaliser(remplacerZone(arbre, zoneAccueil.id, enrichie));
}

/**
 * Relit une disposition venue du stockage.
 *
 * Toute forme inattendue est REFUSÉE en bloc plutôt que réparée au mieux : une
 * disposition à moitié comprise place des panneaux à des endroits que
 * personne n'a choisis, et l'utilisateur ne sait pas pourquoi. L'appelant
 * retombe alors sur la disposition par défaut (§1003).
 */
export function lireDisposition(brut: unknown): Noeud | null {
  const vus = new Set<string>();
  const lire = (x: unknown): Noeud | null => {
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    if (o['type'] === 'zone') {
      const { id, panneaux, actif } = o;
      if (typeof id !== 'string' || typeof actif !== 'string') return null;
      if (!Array.isArray(panneaux) || panneaux.length === 0) return null;
      if (!panneaux.every((p): p is string => typeof p === 'string')) return null;
      if (!panneaux.includes(actif)) return null;
      for (const p of panneaux) {
        if (vus.has(p)) return null; // un panneau ne peut pas être à deux endroits
        vus.add(p);
      }
      return { type: 'zone', id, panneaux: [...panneaux], actif };
    }
    if (o['type'] === 'division') {
      const { id, axe, fraction } = o;
      if (typeof id !== 'string') return null;
      if (axe !== 'colonnes' && axe !== 'rangees') return null;
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
      const premier = lire(o['premier']);
      const second = lire(o['second']);
      if (premier === null || second === null) return null;
      return { type: 'division', id, axe, fraction: bornerFraction(fraction), premier, second };
    }
    return null;
  };
  return lire(brut);
}

/** Bande, en part de la zone, qui vise un bord plutôt que le centre. */
export const BANDE_BORD = 0.24;

/**
 * Détermine le côté visé d'après la position du pointeur dans la zone.
 *
 * Le bord LE PLUS PROCHE gagne, et seulement s'il est dans sa bande. Un simple
 * `if (dx < 0.24) gauche` privilégierait toujours la gauche dans un coin, ce
 * qui rend le coin imprévisible.
 */
export function coteVise(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
): Cote {
  if (rect.width <= 0 || rect.height <= 0) return 'centre';
  const dx = (x - rect.left) / rect.width;
  const dy = (y - rect.top) / rect.height;
  const distances: readonly { cote: Cote; d: number }[] = [
    { cote: 'gauche', d: dx },
    { cote: 'droite', d: 1 - dx },
    { cote: 'haut', d: dy },
    { cote: 'bas', d: 1 - dy },
  ];
  let plusProche = distances[0] as { cote: Cote; d: number };
  for (const c of distances) if (c.d < plusProche.d) plusProche = c;
  return plusProche.d < BANDE_BORD ? plusProche.cote : 'centre';
}
