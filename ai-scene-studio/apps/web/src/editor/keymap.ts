'use client';

import { useEffect, useState } from 'react';

export type Keymap = 'blender' | 'standard';
const KEY = 'ass.editor.keymap';

/** Disposition des raccourcis, mémorisée dans le navigateur (Blender par défaut). */
export function useKeymap(): [Keymap, (keymap: Keymap) => void] {
  const [keymap, setKeymap] = useState<Keymap>('blender');
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'blender' || stored === 'standard') setKeymap(stored);
  }, []);
  return [
    keymap,
    (value: Keymap) => {
      window.localStorage.setItem(KEY, value);
      setKeymap(value);
    },
  ];
}

/** Aide affichée dans l'éditeur : raccourcis de la disposition choisie. */
export const SHORTCUTS: Record<Keymap, [string, string][]> = {
  blender: [
    [
      'G / R / S',
      'Déplacer / pivoter / mettre à l’échelle, puis X, Y ou Z pour contraindre l’axe (Z = vertical)',
    ],
    ['Maj+A', 'Menu d’ajout'],
    ['Maj+D', 'Dupliquer'],
    ['X / Suppr', 'Supprimer'],
    ['H / Maj+H / Alt+H', 'Masquer / masquer le reste / tout afficher'],
    ['A / Alt+A', 'Tout sélectionner / tout désélectionner'],
    ['B', 'Sélection rectangle'],
    ['Ctrl+P / Alt+P', 'Parenter à l’actif / retirer le parent'],
    ['Alt+G / Alt+R / Alt+S', 'Effacer position / rotation / échelle'],
    ['I / Alt+I', 'Poser / supprimer les clés de la sélection'],
    [
      'Pavé 1 / 3 / 7 (Ctrl : opposé)',
      'Vue avant / droite / dessus (chiffres du clavier acceptés)',
    ],
    ['Pavé 5 / Pavé 0', 'Perspective ⇄ orthographique / vue caméra'],
    ['Pavé . / Origine', 'Cadrer la sélection / tout'],
    ['Espace', 'Lecture / pause'],
    ['← / → , Maj+← / Maj+→', 'Frame précédente / suivante, début / fin'],
    ['↑ / ↓', 'Clé suivante / précédente'],
    ['Ctrl+Z / Ctrl+Maj+Z', 'Annuler / rétablir (⌘ sur Mac)'],
    ['Ctrl+S', 'Enregistrer'],
  ],
  standard: [
    ['W / E / R', 'Déplacer / pivoter / mettre à l’échelle'],
    ['F', 'Cadrer la sélection'],
    ['H', 'Masquer / afficher'],
    ['B', 'Sélection rectangle'],
    ['Suppr', 'Supprimer'],
    ['⌘D / ⌘G', 'Dupliquer / grouper'],
    ['K', 'Clé de transformation'],
    ['Espace, ← / →, Origine / Fin', 'Lecture, frames, début / fin'],
    ['⌘C / ⌘V', 'Copier / coller les clés'],
    ['⌘Z / ⇧⌘Z', 'Annuler / rétablir'],
    ['⌘S', 'Enregistrer'],
  ],
};
