/**
 * Catalogue des panneaux de l'espace Montage (§6).
 *
 * Le modèle d'arbre ne connaît que des identifiants. C'est ICI, et seulement
 * ici, qu'on dit quels panneaux existent et comment ils s'appellent — de la
 * même façon que `keyboard` sépare le catalogue d'actions de leurs touches.
 * Ajouter un panneau se fait donc en deux endroits : cette table, et le rendu
 * correspondant dans `App.tsx`.
 */
import type { Noeud } from './modele';

export const PANNEAUX = ['plans', 'programme', 'projet', 'info', 'timeline'] as const;

export type IdPanneau = (typeof PANNEAUX)[number];

export const TITRES: Readonly<Record<IdPanneau, string>> = {
  plans: 'Plans du film',
  programme: 'Film',
  projet: 'Médias',
  info: 'Historique',
  timeline: 'Timeline',
};

/**
 * Zone d'accueil des panneaux qu'une disposition enregistrée ne connaît pas
 * encore. La timeline est toujours présente et toujours large : un panneau qui
 * y réapparaît est vu tout de suite.
 */
export const ACCUEIL: IdPanneau = 'timeline';

export function estIdPanneau(x: string): x is IdPanneau {
  return (PANNEAUX as readonly string[]).includes(x);
}

/**
 * Disposition par défaut : les plans à gauche (les médias en second onglet), le film au centre,
 * l'historique à droite, et la timeline en bas sur toute la largeur.
 */
export function dispositionParDefaut(): Noeud {
  return {
    type: 'division',
    id: 'd1',
    axe: 'rangees',
    fraction: 0.58,
    premier: {
      type: 'division',
      id: 'd2',
      axe: 'colonnes',
      fraction: 0.27,
      premier: { type: 'zone', id: 'z1', panneaux: ['plans', 'projet'], actif: 'plans' },
      second: {
        type: 'division',
        id: 'd3',
        axe: 'colonnes',
        fraction: 0.74,
        premier: { type: 'zone', id: 'z2', panneaux: ['programme'], actif: 'programme' },
        second: { type: 'zone', id: 'z3', panneaux: ['info'], actif: 'info' },
      },
    },
    second: { type: 'zone', id: 'z5', panneaux: ['timeline'], actif: 'timeline' },
  };
}
