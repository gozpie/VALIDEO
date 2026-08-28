/**
 * Persistance de la disposition des panneaux.
 *
 * POURQUOI `localStorage` ET PAS `@valideo/storage`. Le stockage du projet
 * garde le TRAVAIL : il est versionné, migré, sauvegardé, et il suit le projet
 * d'une machine à l'autre. Une disposition de panneaux n'est rien de tout
 * cela — c'est une préférence de poste de travail, propre à cet écran et à ce
 * navigateur. La mélanger au projet ferait voyager la disposition d'un
 * portable 13 pouces jusqu'à une station à deux écrans.
 *
 * Toute lecture et toute écriture sont gardées : en navigation privée, ou avec
 * les données de site bloquées, l'accès lui-même peut lever. Un espace de
 * travail qui refuse de s'afficher parce qu'il n'a pas pu lire une préférence
 * serait un mauvais compromis.
 */
import { lireDisposition, type Noeud } from './modele.js';

const CLE = 'valideo.nle.espace.v1';

export function chargerDisposition(): Noeud | null {
  try {
    const brut = window.localStorage.getItem(CLE);
    if (brut === null) return null;
    return lireDisposition(JSON.parse(brut));
  } catch {
    return null;
  }
}

export function enregistrerDisposition(n: Noeud): void {
  try {
    window.localStorage.setItem(CLE, JSON.stringify(n));
  } catch {
    // Disposition non conservée. Sans conséquence sur le travail en cours :
    // rien à signaler à l'utilisateur, qui n'y peut rien.
  }
}

export function oublierDisposition(): void {
  try {
    window.localStorage.removeItem(CLE);
  } catch {
    // Idem.
  }
}
