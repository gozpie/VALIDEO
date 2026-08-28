import { describe, expect, it } from 'vitest';
import {
  activer,
  aimanter,
  coteVise,
  bornerFraction,
  deposer,
  estZone,
  lireDisposition,
  normaliser,
  panneauxDe,
  reconcilier,
  redimensionner,
  retirer,
  zoneContenant,
  zonesDe,
  type Cote,
  type Noeud,
  type Zone,
} from './modele.js';

function zone(id: string, ...panneaux: string[]): Zone {
  const actif = panneaux[0];
  if (actif === undefined) throw new Error('zone de test sans panneau');
  return { type: 'zone', id, panneaux, actif };
}

/** Deux colonnes : [a | b], puis la timeline en dessous. */
function arbreExemple(): Noeud {
  return {
    type: 'division',
    id: 'd1',
    axe: 'rangees',
    fraction: 0.6,
    premier: {
      type: 'division',
      id: 'd2',
      axe: 'colonnes',
      fraction: 0.5,
      premier: zone('z1', 'source'),
      second: zone('z2', 'programme'),
    },
    second: zone('z3', 'timeline'),
  };
}

/**
 * Vérifie les invariants de §6 sur tout l'arbre. Appelé après CHAQUE opération
 * des tests, comme `timeline-model` le fait pour ses opérations de montage
 * (ADR-011) : une disposition cassée doit être attrapée à l'endroit où elle
 * naît, pas trois gestes plus loin.
 */
function verifierInvariants(n: Noeud): void {
  const vus = new Set<string>();
  const visiter = (x: Noeud): void => {
    if (estZone(x)) {
      expect(x.panneaux.length).toBeGreaterThan(0);
      expect(x.panneaux).toContain(x.actif);
      for (const p of x.panneaux) {
        expect(vus.has(p), `panneau ${p} présent deux fois`).toBe(false);
        vus.add(p);
      }
      return;
    }
    expect(x.fraction).toBeGreaterThan(0);
    expect(x.fraction).toBeLessThan(1);
    visiter(x.premier);
    visiter(x.second);
  };
  visiter(n);
}

describe('bornes et aimantation', () => {
  it('borne une fraction et refuse NaN', () => {
    expect(bornerFraction(0.5)).toBe(0.5);
    expect(bornerFraction(-3)).toBe(0.08);
    expect(bornerFraction(42)).toBe(0.92);
    expect(bornerFraction(Number.NaN)).toBe(0.5);
  });

  it('aimante sur le repère le plus proche sous le seuil', () => {
    // 8 px d'écart sur 1000 px de large, seuil à 12 px : ça colle.
    expect(aimanter(0.508, 1000, 12)).toBe(0.5);
    // 40 px d'écart : ça ne colle pas, la valeur reste celle du geste.
    expect(aimanter(0.54, 1000, 12)).toBe(0.54);
  });

  it("exprime le seuil en pixels, donc s'adapte à la taille du panneau", () => {
    // Le MÊME écart de fraction colle sur un panneau large et pas sur un
    // étroit : 0,02 vaut 20 px sur 1000, mais seulement 4 px sur 200.
    expect(aimanter(0.52, 1000, 24)).toBe(0.5);
    expect(aimanter(0.52, 200, 24)).toBe(0.5);
    expect(aimanter(0.52, 5000, 24)).toBe(0.52);
  });

  it('accepte des repères supplémentaires, pour aligner sur une poignée voisine', () => {
    expect(aimanter(0.395, 1000, 12, [0.4])).toBe(0.4);
  });
});

describe('côté visé par un dépôt', () => {
  const rect = { left: 0, top: 0, width: 400, height: 200 };

  it('vise le centre au milieu, un bord près du bord', () => {
    expect(coteVise(200, 100, rect)).toBe('centre');
    expect(coteVise(10, 100, rect)).toBe('gauche');
    expect(coteVise(390, 100, rect)).toBe('droite');
    expect(coteVise(200, 5, rect)).toBe('haut');
    expect(coteVise(200, 195, rect)).toBe('bas');
  });

  it("dans un coin, c'est le bord LE PLUS PROCHE qui gagne", () => {
    // Coin haut-gauche d'une zone deux fois plus large que haute : 12 px du
    // bord gauche valent 3 % de la largeur, 12 px du haut en valent 6 %. Le
    // bord gauche est donc le plus proche EN PROPORTION, et c'est lui qui
    // doit l'emporter — un test « gauche d'abord » passerait ici par hasard,
    // celui-ci vérifie l'inverse juste en dessous.
    expect(coteVise(12, 12, rect)).toBe('gauche');
    expect(coteVise(30, 6, rect)).toBe('haut');
  });

  it('reste défini sur une zone de taille nulle', () => {
    expect(coteVise(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBe('centre');
  });
});

describe('parcours', () => {
  it('liste les panneaux et les zones', () => {
    const a = arbreExemple();
    expect(panneauxDe(a)).toEqual(['source', 'programme', 'timeline']);
    expect(zonesDe(a).map((z) => z.id)).toEqual(['z1', 'z2', 'z3']);
    expect(zoneContenant(a, 'programme')?.id).toBe('z2');
    expect(zoneContenant(a, 'inconnu')).toBeNull();
  });
});

describe('dépôt', () => {
  it('met un panneau en onglet quand on le dépose au centre', () => {
    const a = deposer(arbreExemple(), 'source', 'z2', 'centre');
    verifierInvariants(a);
    const z2 = zonesDe(a).find((z) => z.id === 'z2');
    expect(z2?.panneaux).toEqual(['programme', 'source']);
    // Le panneau déposé passe au premier plan : sinon on le « perd » derrière
    // celui qui était là, et le geste paraît sans effet.
    expect(z2?.actif).toBe('source');
    // La zone d'origine, devenue vide, a disparu.
    expect(zonesDe(a).map((z) => z.id)).not.toContain('z1');
  });

  it('crée une division quand on dépose sur un côté', () => {
    const a = deposer(arbreExemple(), 'timeline', 'z2', 'bas');
    verifierInvariants(a);
    expect(panneauxDe(a).sort()).toEqual(['programme', 'source', 'timeline']);
    const division = zonesDe(a);
    expect(division).toHaveLength(3);
  });

  it("respecte le côté visé : à gauche le nouveau venu passe d'abord", () => {
    const a = deposer(arbreExemple(), 'timeline', 'z1', 'gauche');
    verifierInvariants(a);
    // L'ordre de parcours reflète l'ordre visuel : timeline avant source.
    expect(panneauxDe(a)).toEqual(['timeline', 'source', 'programme']);
    const b = deposer(arbreExemple(), 'timeline', 'z1', 'droite');
    expect(panneauxDe(b)).toEqual(['source', 'timeline', 'programme']);
  });

  it('ne fait rien si le panneau est déjà seul dans la zone visée', () => {
    const a = arbreExemple();
    expect(deposer(a, 'source', 'z1', 'centre')).toBe(a);
    expect(deposer(a, 'source', 'z1', 'droite')).toBe(a);
  });

  it('réordonne au lieu de dupliquer quand la zone contient déjà le panneau', () => {
    const groupe: Noeud = zone('z1', 'a', 'b', 'c');
    const apres = deposer(groupe, 'a', 'z1', 'centre');
    // Un panneau déjà présent au centre de sa propre zone : rien à faire.
    expect(apres).toBe(groupe);
    const scinde = deposer(groupe, 'a', 'z1', 'droite');
    verifierInvariants(scinde);
    expect(panneauxDe(scinde).sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignore une zone ou un panneau inconnus', () => {
    const a = arbreExemple();
    expect(deposer(a, 'source', 'zX', 'gauche')).toBe(a);
    expect(deposer(a, 'fantome', 'z2', 'gauche')).toBe(a);
  });
});

describe('fermeture', () => {
  it('supprime la zone devenue vide et remonte le voisin', () => {
    const a = retirer(arbreExemple(), 'source');
    verifierInvariants(a);
    expect(panneauxDe(a)).toEqual(['programme', 'timeline']);
    expect(zonesDe(a)).toHaveLength(2);
  });

  it('refuse de fermer le dernier panneau', () => {
    const seul: Noeud = zone('z1', 'timeline');
    expect(retirer(seul, 'timeline')).toBe(seul);
  });

  it("recale l'onglet actif quand c'est lui qu'on ferme", () => {
    const groupe: Noeud = { ...zone('z1', 'a', 'b'), actif: 'b' };
    const arbre: Noeud = {
      type: 'division',
      id: 'd1',
      axe: 'colonnes',
      fraction: 0.5,
      premier: groupe,
      second: zone('z2', 'c'),
    };
    const apres = retirer(arbre, 'b');
    verifierInvariants(apres);
    expect(zonesDe(apres)[0]?.actif).toBe('a');
  });
});

describe('activation et redimensionnement', () => {
  it("met un onglet au premier plan sans toucher au reste de l'arbre", () => {
    const groupe: Noeud = zone('z1', 'a', 'b');
    const apres = activer(groupe, 'b');
    expect(estZone(apres) && apres.actif).toBe('b');
    // Panneau absent : aucun changement, et la même référence est rendue.
    expect(activer(groupe, 'z')).toBe(groupe);
  });

  it('borne la fraction au lieu de refuser le geste', () => {
    const a = redimensionner(arbreExemple(), 'd1', 5);
    verifierInvariants(a);
    expect(!estZone(a) && a.fraction).toBe(0.92);
  });

  it('ignore une division inconnue', () => {
    const a = arbreExemple();
    expect(redimensionner(a, 'dX', 0.3)).toBe(a);
  });
});

describe('réconciliation', () => {
  it('ajoute les panneaux apparus depuis la disposition enregistrée', () => {
    const a = reconcilier(
      arbreExemple(),
      ['source', 'programme', 'timeline', 'projet'],
      'timeline',
    );
    expect(a).not.toBeNull();
    if (a === null) return;
    verifierInvariants(a);
    expect(zoneContenant(a, 'projet')?.id).toBe('z3');
  });

  it('retire les panneaux qui ont disparu du logiciel', () => {
    const a = reconcilier(arbreExemple(), ['source', 'timeline'], 'timeline');
    expect(a).not.toBeNull();
    if (a === null) return;
    verifierInvariants(a);
    expect(panneauxDe(a).sort()).toEqual(['source', 'timeline']);
  });
});

describe('relecture depuis le stockage', () => {
  it("relit à l'identique ce qu'il a écrit", () => {
    const a = arbreExemple();
    expect(lireDisposition(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it('refuse en bloc une forme inattendue plutôt que de la réparer', () => {
    expect(lireDisposition(null)).toBeNull();
    expect(lireDisposition('bonjour')).toBeNull();
    expect(lireDisposition({ type: 'zone', id: 'z1', panneaux: [], actif: 'a' })).toBeNull();
    // actif hors de la liste
    expect(lireDisposition({ type: 'zone', id: 'z1', panneaux: ['a'], actif: 'b' })).toBeNull();
    // axe inconnu
    expect(
      lireDisposition({
        type: 'division',
        id: 'd1',
        axe: 'diagonale',
        fraction: 0.5,
        premier: { type: 'zone', id: 'z1', panneaux: ['a'], actif: 'a' },
        second: { type: 'zone', id: 'z2', panneaux: ['b'], actif: 'b' },
      }),
    ).toBeNull();
  });

  it('refuse un panneau présent à deux endroits', () => {
    expect(
      lireDisposition({
        type: 'division',
        id: 'd1',
        axe: 'colonnes',
        fraction: 0.5,
        premier: { type: 'zone', id: 'z1', panneaux: ['a'], actif: 'a' },
        second: { type: 'zone', id: 'z2', panneaux: ['a'], actif: 'a' },
      }),
    ).toBeNull();
  });

  it('borne une fraction aberrante venue du stockage', () => {
    const relu = lireDisposition({
      type: 'division',
      id: 'd1',
      axe: 'colonnes',
      fraction: 1e9,
      premier: { type: 'zone', id: 'z1', panneaux: ['a'], actif: 'a' },
      second: { type: 'zone', id: 'z2', panneaux: ['b'], actif: 'b' },
    });
    expect(relu).not.toBeNull();
    if (relu === null) return;
    verifierInvariants(relu);
  });
});

describe('normalisation', () => {
  it("rend null pour un arbre entièrement vide, plutôt qu'une zone fantôme", () => {
    expect(normaliser({ type: 'zone', id: 'z1', panneaux: [], actif: 'a' })).toBeNull();
  });
});

/**
 * Fuzz déterministe, sur le modèle de `timeline-model`.
 *
 * Une disposition se manipule des centaines de fois par session, et les
 * enchaînements qui cassent sont ceux auxquels on ne pense pas : fermer la
 * zone qu'on vient de créer, déposer un panneau sur lui-même, vider une
 * branche entière. Sept graines, mille gestes chacune, invariants vérifiés
 * après chaque geste.
 */
describe('fuzz', () => {
  const COTES: readonly Cote[] = ['centre', 'gauche', 'droite', 'haut', 'bas'];
  const PANNEAUX = ['source', 'programme', 'projet', 'info', 'timeline'];

  function alea(graine: number): () => number {
    let s = graine >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  for (const graine of [1, 2, 3, 4, 5, 6, 7]) {
    it(`enchaîne 1000 gestes sans casser un invariant (graine ${graine})`, () => {
      const r = alea(graine);
      const pioche = <T>(xs: readonly T[]): T => {
        const x = xs[Math.floor(r() * xs.length)];
        if (x === undefined) throw new Error('pioche vide');
        return x;
      };
      let arbre: Noeud = {
        type: 'zone',
        id: 'z0',
        panneaux: [...PANNEAUX],
        actif: 'timeline',
      };
      for (let i = 0; i < 1000; i += 1) {
        const geste = Math.floor(r() * 4);
        const zs = zonesDe(arbre);
        if (geste === 0) {
          arbre = deposer(arbre, pioche(PANNEAUX), pioche(zs).id, pioche(COTES));
        } else if (geste === 1) {
          arbre = retirer(arbre, pioche(PANNEAUX));
        } else if (geste === 2) {
          arbre = activer(arbre, pioche(PANNEAUX));
        } else {
          const divisions: string[] = [];
          const collecter = (n: Noeud): void => {
            if (estZone(n)) return;
            divisions.push(n.id);
            collecter(n.premier);
            collecter(n.second);
          };
          collecter(arbre);
          if (divisions.length > 0) {
            arbre = redimensionner(arbre, pioche(divisions), r() * 2 - 0.5);
          }
        }
        verifierInvariants(arbre);
        // Un panneau fermé doit pouvoir revenir : la réconciliation est le
        // seul chemin de retour, elle ne doit jamais échouer.
        const complet = reconcilier(arbre, PANNEAUX, 'timeline');
        expect(complet).not.toBeNull();
        if (complet !== null) {
          verifierInvariants(complet);
          expect(panneauxDe(complet).sort()).toEqual([...PANNEAUX].sort());
        }
      }
    });
  }
});
