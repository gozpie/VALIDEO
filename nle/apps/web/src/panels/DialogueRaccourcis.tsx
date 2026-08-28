/**
 * Table des raccourcis clavier (§34).
 *
 * Elle est ENGENDRÉE depuis la table effectivement en vigueur, pas rédigée à
 * la main : une liste écrite séparément se désynchronise du premier
 * changement de préréglage, et affiche alors des raccourcis qui n'existent
 * plus. Ce qui est montré ici est ce que le résolveur applique.
 */
import { useMemo, useState } from 'react';
import { ACTIONS, formatChord } from '@valideo/keyboard';
import type { KeyMap } from '@valideo/keyboard';
import { Modale } from './Modale.js';

const NOMS_CATEGORIE: Readonly<Record<string, string>> = {
  lecture: 'Lecture',
  navigation: 'Navigation',
  montage: 'Montage',
  outils: 'Outils',
  affichage: 'Affichage',
  fichier: 'Fichier',
  pistes: 'Pistes',
};

export function DialogueRaccourcis({
  clavier,
  onFermer,
}: {
  clavier: KeyMap;
  onFermer: () => void;
}): React.JSX.Element {
  const [filtre, setFiltre] = useState('');

  const lignes = useMemo(() => {
    const plateforme = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other';
    const parAction = new Map<string, string[]>();
    for (const b of clavier.bindings) {
      const liste = parAction.get(b.actionId) ?? [];
      liste.push(formatChord(b.chord, plateforme));
      parAction.set(b.actionId, liste);
    }
    const terme = filtre.trim().toLowerCase();
    return ACTIONS.filter((a) => parAction.has(a.id))
      .map((a) => ({
        id: a.id,
        libelle: a.label,
        categorie: NOMS_CATEGORIE[a.category] ?? a.category,
        touches: (parAction.get(a.id) ?? []).join(' ou '),
      }))
      .filter(
        (l) =>
          terme === '' ||
          l.libelle.toLowerCase().includes(terme) ||
          l.touches.toLowerCase().includes(terme) ||
          l.categorie.toLowerCase().includes(terme),
      );
  }, [clavier, filtre]);

  return (
    <Modale titre={`Raccourcis clavier — ${clavier.label}`} onFermer={onFermer}>
      <div className="grille-formulaire">
        <label htmlFor="filtre-raccourcis">Filtrer</label>
        <input
          id="filtre-raccourcis"
          data-test="filtre-raccourcis"
          type="text"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="Nom d’action ou touche"
        />
      </div>
      <table className="table-raccourcis" data-test="table-raccourcis">
        <tbody>
          {lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.libelle}</td>
              <td className="categorie">{l.categorie}</td>
              <td className="mono touches">{l.touches}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lignes.length === 0 && <p className="note-modale">Aucun raccourci ne correspond.</p>}
      <p className="note-modale">
        Les raccourcis suivent la POSITION physique des touches, pas la lettre imprimée : sur un
        clavier AZERTY, la touche à la place du Q américain déclenche l’action de « Q ».
      </p>
    </Modale>
  );
}
