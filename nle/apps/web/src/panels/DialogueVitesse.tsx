/**
 * Vitesse et durée d'un clip (§38).
 *
 * Vitesse et durée sont deux vues du MÊME nombre : la portion de source
 * consommée est fixe, donc durée = source / vitesse. Les deux champs sont donc
 * liés — modifier l'un recalcule l'autre — ce qui est exactement le
 * comportement des NLE, et évite de laisser l'utilisateur saisir un couple
 * incohérent que l'application devrait ensuite arbitrer en silence.
 */
import { useMemo, useState } from 'react';
import { approximate } from '@valideo/time-core';
import type { ClipDoc } from '@valideo/project-model';
import { sourceFramesUsed, toTimelineFrames } from '@valideo/timeline-model';
import type { TimelineContext } from '@valideo/timeline-model';
import { Modale } from './Modale.js';

export interface ReglagesVitesse {
  readonly speed: { readonly n: number; readonly d: number };
  readonly reverse: boolean;
  readonly frameSampling: ClipDoc['frameSampling'];
  readonly ripple: boolean;
}

const ECHANTILLONNAGES: readonly { id: ClipDoc['frameSampling']; libelle: string }[] = [
  { id: 'nearest', libelle: 'Image la plus proche' },
  { id: 'blend', libelle: 'Fondu d’images' },
  { id: 'opticalFlow', libelle: 'Flux optique' },
];

export function DialogueVitesse({
  clip,
  contexte,
  onFermer,
  onAppliquer,
}: {
  clip: ClipDoc;
  contexte: TimelineContext;
  onFermer: () => void;
  onAppliquer: (reglages: ReglagesVitesse) => void;
}): React.JSX.Element {
  const pourcentInitial = (clip.speed.n / clip.speed.d) * 100;
  const [pourcent, setPourcent] = useState(pourcentInitial.toFixed(2).replace(/\.?0+$/, ''));
  const [inverse, setInverse] = useState(clip.reverse);
  const [echantillonnage, setEchantillonnage] = useState<ClipDoc['frameSampling']>(
    clip.frameSampling,
  );
  const [ripple, setRipple] = useState(false);

  const utilisees = useMemo(() => sourceFramesUsed(clip, contexte), [clip, contexte]);

  const valeur = Number.parseFloat(pourcent.replace(',', '.'));
  const valide = Number.isFinite(valeur) && valeur > 0;

  /** Durée résultante, calculée exactement comme le fera l'opération de montage. */
  const dureeResultante = useMemo(() => {
    if (!valide) return null;
    const vitesse = approximate(valeur / 100, 10_000);
    const projete: ClipDoc = { ...clip, speed: { n: vitesse.n, d: vitesse.d } };
    return Math.max(1, toTimelineFrames(projete, utilisees, contexte));
  }, [clip, contexte, utilisees, valeur, valide]);

  const appliquer = (): void => {
    if (!valide) return;
    const vitesse = approximate(valeur / 100, 10_000);
    onAppliquer({
      speed: { n: vitesse.n, d: vitesse.d },
      reverse: inverse,
      frameSampling: echantillonnage,
      ripple,
    });
  };

  return (
    <Modale titre={`Vitesse et durée — ${clip.name}`} onFermer={onFermer} onValider={appliquer}>
      <div className="grille-formulaire">
        <label htmlFor="vitesse-pourcent">Vitesse</label>
        <div className="champ-avec-unite">
          <input
            id="vitesse-pourcent"
            data-test="vitesse-pourcent"
            type="text"
            inputMode="decimal"
            value={pourcent}
            onChange={(e) => setPourcent(e.target.value)}
            aria-invalid={!valide}
          />
          <span className="unite">%</span>
        </div>

        <label htmlFor="vitesse-duree">Durée</label>
        <div className="champ-avec-unite">
          <input
            id="vitesse-duree"
            data-test="vitesse-duree"
            type="text"
            inputMode="numeric"
            value={dureeResultante ?? ''}
            onChange={(e) => {
              // Saisir une durée revient à saisir la vitesse correspondante :
              // c'est le même nombre vu de l'autre côté de la division.
              const images = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(images) || images < 1) return;
              setPourcent(((utilisees / images) * 100).toFixed(2).replace(/\.?0+$/, ''));
            }}
          />
          <span className="unite">images</span>
        </div>

        <label htmlFor="vitesse-inverse">Marche arrière</label>
        <input
          id="vitesse-inverse"
          data-test="vitesse-inverse"
          type="checkbox"
          checked={inverse}
          onChange={(e) => setInverse(e.target.checked)}
        />

        <label htmlFor="vitesse-echantillonnage">Interpolation</label>
        <select
          id="vitesse-echantillonnage"
          data-test="vitesse-echantillonnage"
          value={echantillonnage}
          onChange={(e) => setEchantillonnage(e.target.value as ClipDoc['frameSampling'])}
        >
          {ECHANTILLONNAGES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.libelle}
            </option>
          ))}
        </select>

        <label htmlFor="vitesse-ripple">Décaler les clips suivants</label>
        <input
          id="vitesse-ripple"
          data-test="vitesse-ripple"
          type="checkbox"
          checked={ripple}
          onChange={(e) => setRipple(e.target.checked)}
        />
      </div>

      {!valide && (
        <p className="note-modale alerte">
          La vitesse doit être un nombre strictement positif.
        </p>
      )}

      {/* §1003 : ce qui n'existe pas est ANNONCÉ, jamais présenté comme une
          case à cocher inerte. */}
      <p className="note-modale">
        <strong>Conservation de la hauteur du son : indisponible.</strong> Elle
        demanderait un étirement temporel du son à hauteur constante, qui n’est
        pas implémenté. À vitesse modifiée, le son du clip suit la vidéo et sa
        hauteur change.
      </p>
      <p className="note-modale">
        L’interpolation <em>Flux optique</em> et le <em>Fondu d’images</em> sont
        enregistrés dans le document mais le rendu utilise l’image la plus
        proche : les deux autres modes ne sont pas implémentés.
      </p>
    </Modale>
  );
}
