/**
 * Catalogue des panneaux de l'espace Montage (§6).
 *
 * Le modèle d'arbre ne connaît que des identifiants. C'est ICI, et seulement
 * ici, qu'on dit quels panneaux existent et comment ils s'appellent — de la
 * même façon que `keyboard` sépare le catalogue d'actions de leurs touches.
 * Ajouter un panneau se fait donc en deux endroits : cette table, et le rendu
 * correspondant dans `App.tsx`.
 */
import type { Noeud } from './modele.js';

export const PANNEAUX = ['source', 'programme', 'projet', 'info', 'timeline'] as const;

export type IdPanneau = (typeof PANNEAUX)[number];

export const TITRES: Readonly<Record<IdPanneau, string>> = {
  source: 'Moniteur Source',
  programme: 'Moniteur Programme',
  projet: 'Projet',
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
 * Disposition par défaut : celle d'un banc de montage.
 *
 * Moniteurs en haut, Projet et Historique au milieu, timeline en bas sur toute
 * la largeur. C'est exactement la disposition figée que cette version
 * remplace — un utilisateur qui ne touche à rien ne doit rien voir changer.
 */
export function dispositionParDefaut(): Noeud {
  return {
    type: 'division',
    id: 'd1',
    axe: 'rangees',
    fraction: 0.56,
    premier: {
      type: 'division',
      id: 'd2',
      axe: 'rangees',
      fraction: 0.6,
      premier: {
        type: 'division',
        id: 'd3',
        axe: 'colonnes',
        fraction: 0.5,
        premier: { type: 'zone', id: 'z1', panneaux: ['source'], actif: 'source' },
        second: { type: 'zone', id: 'z2', panneaux: ['programme'], actif: 'programme' },
      },
      second: {
        type: 'division',
        id: 'd4',
        axe: 'colonnes',
        fraction: 0.5,
        premier: { type: 'zone', id: 'z3', panneaux: ['projet'], actif: 'projet' },
        second: { type: 'zone', id: 'z4', panneaux: ['info'], actif: 'info' },
      },
    },
    second: { type: 'zone', id: 'z5', panneaux: ['timeline'], actif: 'timeline' },
  };
}
