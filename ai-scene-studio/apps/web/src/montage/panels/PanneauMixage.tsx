/**
 * Mixage : un fader par piste son, un fader général, et les niveaux réels mesurés sur la sortie audio
 * pendant la lecture.
 */
import { useEffect, useRef } from 'react';
import { setTrackFlagsCommand, volumeGeneralCommand } from '@valideo/timeline-model';
import type { ActionsEditeur, EtatEditeur } from '../store';

const DB_MIN = -60;
const DB_MAX = 12;

function libelleDb(db: number): string {
  if (db <= DB_MIN) return '−∞';
  return `${db > 0 ? '+' : ''}${db.toFixed(1).replace('.', ',').replace('-', '−')}`;
}

function Fader({
  nom,
  db,
  actif,
  test,
  surChange,
  barreRef,
  enfants,
}: {
  nom: string;
  db: number;
  actif: boolean;
  test: string;
  surChange: (db: number) => void;
  barreRef: (noeud: HTMLSpanElement | null) => void;
  enfants?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="tranche" data-test={test}>
      <span className="tranche-nom">{nom}</span>
      <div className="tranche-corps">
        <input
          type="range"
          className="fader"
          aria-label={`Volume ${nom}`}
          min={DB_MIN}
          max={DB_MAX}
          step={0.5}
          value={db}
          disabled={!actif}
          onChange={(e) => surChange(Number(e.target.value))}
          onDoubleClick={() => surChange(0)}
          onPointerUp={(e) => e.currentTarget.blur()}
        />
        <span className="vumetre">
          <span ref={barreRef} />
        </span>
      </div>
      <span className="tranche-valeur mono">{libelleDb(db)}</span>
      <span className="tranche-boutons">{enfants}</span>
    </div>
  );
}

/** Hauteur de barre pour un niveau en dBFS : -60 en bas, 0 en haut. */
function hauteurNiveau(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export function PanneauMixage({
  etat,
  actions,
  canEdit,
  niveaux,
}: {
  etat: EtatEditeur;
  actions: ActionsEditeur;
  canEdit: boolean;
  /** Niveaux de crête courants en dBFS, par piste, et `general` pour la sortie. */
  niveaux: () => ReadonlyMap<string, number>;
}): React.JSX.Element {
  const pistes = etat.sequence.tracks
    .filter((t) => t.kind === 'audio')
    .sort((a, b) => a.index - b.index);
  const barres = useRef(new Map<string, HTMLSpanElement>());
  const tenir = (id: string) => (noeud: HTMLSpanElement | null) => {
    if (noeud === null) barres.current.delete(id);
    else barres.current.set(id, noeud);
  };

  // Hors de React : soixante mises à jour par seconde ne doivent pas redessiner le panneau.
  useEffect(() => {
    if (!etat.enLecture) {
      for (const barre of barres.current.values()) barre.style.height = '0';
      return undefined;
    }
    let id = 0;
    const suivre = (): void => {
      const valeurs = niveaux();
      for (const [cle, barre] of barres.current) {
        const db = valeurs.get(cle) ?? -Infinity;
        barre.style.height = `${hauteurNiveau(db)}%`;
        barre.classList.toggle('sature', db >= 0);
      }
      id = requestAnimationFrame(suivre);
    };
    id = requestAnimationFrame(suivre);
    return () => cancelAnimationFrame(id);
  }, [etat.enLecture, niveaux]);

  return (
    <section className="panneau">
      <div className="panneau-corps mixage" data-test="panneau-mixage">
        {pistes.map((piste) => (
          <Fader
            key={piste.id}
            nom={piste.name}
            db={piste.gainDb}
            actif={canEdit && !piste.locked}
            test={`fader-${piste.name}`}
            barreRef={tenir(piste.id)}
            surChange={(db) =>
              actions.executer({
                ...setTrackFlagsCommand(piste.id, { gainDb: db }, 'Volume de piste'),
                mergeKey: `volume:${piste.id}`,
              })
            }
            enfants={
              <>
                <button
                  type="button"
                  className={piste.muted ? 'on' : ''}
                  title="Couper le son de la piste"
                  aria-pressed={piste.muted}
                  disabled={!canEdit || piste.locked}
                  onClick={() =>
                    actions.executer(
                      setTrackFlagsCommand(piste.id, { muted: !piste.muted }, 'Couper le son'),
                    )
                  }
                >
                  M
                </button>
                <button
                  type="button"
                  className={piste.solo ? 'on' : ''}
                  title="Écouter cette piste seule"
                  aria-pressed={piste.solo}
                  disabled={!canEdit || piste.locked}
                  onClick={() =>
                    actions.executer(
                      setTrackFlagsCommand(piste.id, { solo: !piste.solo }, 'Solo de piste'),
                    )
                  }
                >
                  S
                </button>
              </>
            }
          />
        ))}
        <span className="mixage-sep" />
        <Fader
          nom="Film"
          db={etat.sequence.masterGainDb}
          actif={canEdit}
          test="fader-general"
          barreRef={tenir('general')}
          surChange={(db) => actions.executer(volumeGeneralCommand(db))}
        />
      </div>
    </section>
  );
}
