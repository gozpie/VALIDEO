/**
 * Panneau combine Historique et Informations (§43, §69).
 *
 * L historique est cliquable : on peut revenir a n importe quelle etape, ce que
 * le moteur de commandes rend possible parce qu il conserve les etats et non
 * des operations inverses.
 */
import { useMemo } from 'react';
import type { ActionsEditeur, EtatEditeur } from '../store.js';

export interface ProprietesInfo {
  readonly etat: EtatEditeur;
  readonly actions: ActionsEditeur;
  readonly timecode: (image: number) => string;
  readonly duree: number;
}

export function PanneauInfo({ etat, actions, timecode, duree }: ProprietesInfo): React.JSX.Element {
  const infos = useMemo(
    () => [
      ['Séquence', etat.sequence.name],
      [
        'Cadence',
        `${(etat.sequence.timebase.rate.n / etat.sequence.timebase.rate.d).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} i/s ${etat.sequence.timebase.mode}`,
      ],
      ['Base de temps', `${etat.sequence.timebase.rate.n}/${etat.sequence.timebase.rate.d}`],
      ['Image', `${etat.sequence.settings.width} × ${etat.sequence.settings.height}`],
      ['Échantillonnage', `${etat.sequence.settings.audioSampleRate} Hz`],
      ['Espace de travail', etat.sequence.settings.workingColorSpace],
      ['Début séquence', timecode(0)],
      ['Durée', `${timecode(duree)} (${duree} images)`],
      [
        'Pistes',
        `${etat.sequence.tracks.filter((t) => t.kind === 'video').length} vidéo, ${etat.sequence.tracks.filter((t) => t.kind === 'audio').length} audio`,
      ],
    ],
    [duree, etat.sequence, timecode],
  );

  return (
    <section className="panneau">
      <div className="panneau-entete">
        <span className="espace" />
        <span>
          {etat.historique.labels.length} étape{etat.historique.labels.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="panneau-corps">
        <div className="liste-historique">
          <ul>
            <li
              className={etat.historique.position === -1 ? 'courant' : ''}
              onClick={() => actions.allerA(-1)}
              onKeyDown={(e) => e.key === 'Enter' && actions.allerA(-1)}
              role="button"
              tabIndex={0}
            >
              Ouverture du projet
            </li>
            {etat.historique.labels.map((libelle, i) => (
              <li
                key={`${libelle}-${i}`}
                className={
                  i === etat.historique.position
                    ? 'courant'
                    : i > etat.historique.position
                      ? 'annulee'
                      : ''
                }
                onClick={() => actions.allerA(i)}
                onKeyDown={(e) => e.key === 'Enter' && actions.allerA(i)}
                role="button"
                tabIndex={0}
              >
                {libelle}
              </li>
            ))}
          </ul>
        </div>

        <div className="panneau-entete" style={{ marginTop: 8 }}>
          <span className="titre">Réglages de séquence</span>
        </div>
        {infos.map(([cle, valeur]) => (
          <div className="info-cle" key={cle}>
            <span>{cle}</span>
            <span className={cle === 'Durée' || cle === 'Début séquence' ? 'mono' : ''}>
              {valeur}
            </span>
          </div>
        ))}

        <div className="message avert">
          <strong>Ce qui n’est pas encore construit.</strong> Lecture vidéo et audio, vignettes,
          formes d’onde, effets, étalonnage, export. Le montage, l’annulation, le zoom et
          l’accrochage, eux, s’appuient sur un moteur réel et testé.
        </div>
      </div>
    </section>
  );
}
