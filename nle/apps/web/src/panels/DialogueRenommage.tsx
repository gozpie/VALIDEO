/**
 * Renommage d'un clip ou d'une piste.
 *
 * Le champ est sélectionné à l'ouverture : renommer commence presque toujours
 * par tout remplacer, et obliger à sélectionner d'abord ferait perdre le geste.
 */
import { useState } from 'react';
import { Modale } from './Modale.js';

export function DialogueRenommage({
  initial,
  titre,
  onFermer,
  onValider,
}: {
  initial: string;
  titre: string;
  onFermer: () => void;
  onValider: (nom: string) => void;
}): React.JSX.Element {
  const [nom, setNom] = useState(initial);
  return (
    <Modale titre={titre} onFermer={onFermer} onValider={() => onValider(nom)}>
      <div className="grille-formulaire">
        <label htmlFor="renommage-nom">Nom</label>
        <input
          id="renommage-nom"
          data-test="renommage-nom"
          type="text"
          value={nom}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setNom(e.target.value)}
        />
      </div>
    </Modale>
  );
}
