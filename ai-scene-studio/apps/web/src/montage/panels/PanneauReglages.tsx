/**
 * Réglages de ce qui est sélectionné : calque (opacité, fusion, position, échelle, rotation, images
 * clés), titre, son (volume, panoramique), fondus, transition.
 *
 * Une sélection de plusieurs clips reçoit le réglage partout. Chaque valeur passe par l'historique ; un
 * curseur tiré ne fait qu'une annulation.
 */
import { ChevronLeft, ChevronRight, Diamond, Trash2 } from 'lucide-react';
import type { BlendMode, ClipDoc, ParameterDoc, TitleDoc } from '@valideo/project-model';
import { transaction } from '@valideo/command-system';
import {
  TRANSITIONS_IMAGE,
  TRANSITION_SON,
  basculerCle,
  cleA,
  ecrireParametre,
  findClip,
  modifierClipsCommand,
  modifierTransitionCommand,
  nomTransition,
  nombreA,
  poserTransitionCommand,
  retirerTransitionCommand,
  transitionsEffectives,
  vecteurA,
} from '@valideo/timeline-model';
import type { TransitionEffective } from '@valideo/timeline-model';
import type { ActionsEditeur, EtatEditeur } from '../store';

const FUSIONS: readonly (readonly [BlendMode, string])[] = [
  ['normal', 'Normal'],
  ['multiply', 'Produit'],
  ['screen', 'Superposition (écran)'],
  ['overlay', 'Incrustation'],
  ['softLight', 'Lumière tamisée'],
  ['hardLight', 'Lumière crue'],
  ['darken', 'Obscurcir'],
  ['lighten', 'Éclaircir'],
  ['colorDodge', 'Densité couleur −'],
  ['colorBurn', 'Densité couleur +'],
  ['difference', 'Différence'],
  ['exclusion', 'Exclusion'],
];

const POSITIONS_TITRE: readonly (readonly [number, number])[] = [
  [0.2, 0.14],
  [0.5, 0.14],
  [0.8, 0.14],
  [0.2, 0.5],
  [0.5, 0.5],
  [0.8, 0.5],
  [0.2, 0.84],
  [0.5, 0.84],
  [0.8, 0.84],
];

function tempsDans(clip: ClipDoc, tete: number): number {
  return Math.max(0, Math.min(clip.duration - 1, tete - clip.start));
}

type Lecteur = (clip: ClipDoc) => ParameterDoc;
type Ecrivain = (clip: ClipDoc, p: ParameterDoc) => ClipDoc;

interface Propriete {
  readonly id: string;
  readonly nom: string;
  readonly lire: Lecteur;
  readonly ecrire: Ecrivain;
}

const OPACITE: Propriete = {
  id: 'opacite',
  nom: 'Opacité',
  lire: (c) => c.opacity,
  ecrire: (c, p) => ({ ...c, opacity: p }),
};
const POSITION: Propriete = {
  id: 'position',
  nom: 'Position',
  lire: (c) => c.transform.position,
  ecrire: (c, p) => ({ ...c, transform: { ...c.transform, position: p } }),
};
const ECHELLE: Propriete = {
  id: 'echelle',
  nom: 'Échelle',
  lire: (c) => c.transform.scale,
  ecrire: (c, p) => ({ ...c, transform: { ...c.transform, scale: p } }),
};
const ROTATION: Propriete = {
  id: 'rotation',
  nom: 'Rotation',
  lire: (c) => c.transform.rotation,
  ecrire: (c, p) => ({ ...c, transform: { ...c.transform, rotation: p } }),
};
const VOLUME: Propriete = {
  id: 'volume',
  nom: 'Volume',
  lire: (c) => c.audio.gainDb,
  ecrire: (c, p) => ({ ...c, audio: { ...c.audio, gainDb: p } }),
};
const PANORAMIQUE: Propriete = {
  id: 'pan',
  nom: 'Panoramique',
  lire: (c) => c.audio.pan,
  ecrire: (c, p) => ({ ...c, audio: { ...c.audio, pan: p } }),
};

/** Valeur courante, telle que la clé la retiendrait. */
function valeurDe(p: ParameterDoc, t: number, defaut: number | readonly [number, number]) {
  return typeof defaut === 'number' ? nombreA(p, t, defaut) : [...vecteurA(p, t, defaut)];
}

export function PanneauReglages({
  etat,
  actions,
  canEdit,
  cadence,
  cadrage,
}: {
  etat: EtatEditeur;
  actions: ActionsEditeur;
  canEdit: boolean;
  cadence: number;
  /** Échelle qui ferait remplir le cadre à ce média, ou `null` si elle n'a pas de sens. */
  cadrage: (clip: ClipDoc) => number | null;
}): React.JSX.Element {
  const transition = etat.sequence.tracks
    .flatMap((t) => transitionsEffectives(t))
    .find((t) => t.id === etat.transitionSelectionnee);

  if (transition !== undefined) {
    return (
      <Cadre>
        <ReglagesTransition
          transition={transition}
          etat={etat}
          actions={actions}
          canEdit={canEdit}
          cadence={cadence}
        />
      </Cadre>
    );
  }

  const clips = [...etat.selection].flatMap((id) => {
    const trouve = findClip(etat.sequence, id);
    return trouve === undefined ? [] : [trouve.clip];
  });
  const titres = clips.filter((c) => c.kind === 'title');
  const images = clips.filter((c) => c.kind !== 'audio');
  const sons = clips.filter((c) => c.kind === 'audio');
  if (clips.length === 0) {
    return (
      <Cadre>
        <p className="reglages-vide">
          Sélectionnez un clip ou une transition sur la timeline pour régler son image, son son et
          ses fondus.
        </p>
      </Cadre>
    );
  }

  const appliquer = (
    cibles: readonly ClipDoc[],
    changer: (clip: ClipDoc) => ClipDoc,
    libelle: string,
    cle: string,
  ): void => {
    actions.executer(
      modifierClipsCommand(
        cibles.map((c) => c.id),
        changer,
        libelle,
        `${cle}:${cibles.map((c) => c.id).join(',')}`,
      ),
    );
  };
  const ligne = (
    cibles: readonly ClipDoc[],
    propriete: Propriete,
    defaut: number | readonly [number, number],
    corps: (valeur: number | number[], ecrire: (v: number | number[]) => void) => React.ReactNode,
  ): React.ReactNode => {
    const clip = cibles[0];
    if (clip === undefined) return null;
    const p = propriete.lire(clip);
    const t = tempsDans(clip, etat.tete);
    const dedans = etat.tete >= clip.start && etat.tete < clip.start + clip.duration;
    const ecrire = (v: number | number[]): void =>
      appliquer(
        cibles,
        (c) => propriete.ecrire(c, ecrireParametre(propriete.lire(c), tempsDans(c, etat.tete), v)),
        propriete.nom,
        propriete.id,
      );
    const cles = [...p.keyframes].map((k) => k.time).sort((a, b) => a - b);
    const precedente = [...cles].reverse().find((k) => k < t);
    const suivante = cles.find((k) => k > t);
    return (
      <div className="reglage" key={propriete.id} data-test={`reglage-${propriete.id}`}>
        <span className="reglage-nom">{propriete.nom}</span>
        <span className="reglage-valeur">{corps(valeurDe(p, t, defaut), ecrire)}</span>
        <span className="reglage-cles">
          <button
            type="button"
            title="Image clé précédente"
            aria-label="Image clé précédente"
            disabled={precedente === undefined}
            onClick={() => {
              if (precedente !== undefined) actions.definirTete(clip.start + precedente);
            }}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            type="button"
            className={cleA(p, t) !== undefined ? 'on' : ''}
            title={
              dedans
                ? 'Poser ou retirer une image clé ici : la valeur s’animera d’une clé à l’autre'
                : 'Placez la tête de lecture dans le clip pour poser une image clé'
            }
            aria-label="Image clé"
            aria-pressed={cleA(p, t) !== undefined}
            disabled={!canEdit || !dedans}
            data-test={`cle-${propriete.id}`}
            onClick={() =>
              actions.executer(
                modifierClipsCommand(
                  cibles.map((c) => c.id),
                  (c) => {
                    const tc = tempsDans(c, etat.tete);
                    const pc = propriete.lire(c);
                    const v = valeurDe(pc, tc, defaut);
                    return propriete.ecrire(c, basculerCle(pc, tc, v));
                  },
                  'Image clé',
                ),
              )
            }
          >
            <Diamond size={11} fill={cleA(p, t) !== undefined ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            title="Image clé suivante"
            aria-label="Image clé suivante"
            disabled={suivante === undefined}
            onClick={() => {
              if (suivante !== undefined) actions.definirTete(clip.start + suivante);
            }}
          >
            <ChevronRight size={12} />
          </button>
        </span>
      </div>
    );
  };

  const curseur = (
    min: number,
    max: number,
    pas: number,
    unite: string,
    test: string,
  ): ((valeur: number | number[], ecrire: (v: number | number[]) => void) => React.ReactNode) =>
    function Curseur(valeur, ecrire) {
      const v = typeof valeur === 'number' ? valeur : (valeur[0] ?? 0);
      return (
        <>
          <input
            type="range"
            min={min}
            max={max}
            step={pas}
            value={v}
            disabled={!canEdit}
            onChange={(e) => ecrire(Number(e.target.value))}
            onPointerUp={(e) => e.currentTarget.blur()}
            aria-label={test}
          />
          <input
            type="number"
            className="nombre"
            min={min}
            max={max}
            step={pas}
            value={Math.round(v * 100) / 100}
            disabled={!canEdit}
            data-test={`valeur-${test}`}
            onChange={(e) => ecrire(Number(e.target.value))}
          />
          <span className="unite">{unite}</span>
        </>
      );
    };

  const premiereImage = images[0];
  const titrePrincipal = titres[0]?.title ?? null;

  return (
    <Cadre>
      {titres.length > 0 && titrePrincipal !== null && (
        <ReglagesTitre
          titre={titrePrincipal}
          canEdit={canEdit}
          surChange={(modifs) =>
            appliquer(
              titres,
              (c) => {
                if (c.title === null) return c;
                const suivant = { ...c.title, ...modifs };
                return modifs.text === undefined
                  ? { ...c, title: suivant }
                  : { ...c, title: suivant, name: modifs.text.split('\n')[0] || 'Titre' };
              },
              'Modifier le titre',
              'titre',
            )
          }
        />
      )}

      {premiereImage !== undefined && (
        <>
          <h4>Image</h4>
          {ligne(images, OPACITE, 100, curseur(0, 100, 1, '%', 'opacite'))}
          <div className="reglage">
            <span className="reglage-nom">Fusion</span>
            <span className="reglage-valeur">
              <select
                value={premiereImage.blendMode}
                disabled={!canEdit}
                data-test="fusion"
                onChange={(e) => {
                  const mode = e.target.value as BlendMode;
                  appliquer(images, (c) => ({ ...c, blendMode: mode }), 'Mode de fusion', 'fusion');
                  e.target.blur();
                }}
              >
                {FUSIONS.map(([id, nom]) => (
                  <option key={id} value={id}>
                    {nom}
                  </option>
                ))}
              </select>
            </span>
            <span className="reglage-cles" />
          </div>
          {ligne(images, ECHELLE, [100, 100], (valeur, ecrire) =>
            curseur(
              1,
              400,
              1,
              '%',
              'echelle',
            )(valeur, (v) => {
              const n = typeof v === 'number' ? v : (v[0] ?? 100);
              ecrire([n, n]);
            }),
          )}
          {ligne(images, POSITION, [0, 0], (valeur, ecrire) => {
            const [x, y] = Array.isArray(valeur) ? valeur : [0, 0];
            return (
              <>
                <label className="paire">
                  X
                  <input
                    type="number"
                    className="nombre"
                    value={Math.round(x ?? 0)}
                    disabled={!canEdit}
                    data-test="valeur-position-x"
                    onChange={(e) => ecrire([Number(e.target.value), y ?? 0])}
                  />
                </label>
                <label className="paire">
                  Y
                  <input
                    type="number"
                    className="nombre"
                    value={Math.round(y ?? 0)}
                    disabled={!canEdit}
                    onChange={(e) => ecrire([x ?? 0, Number(e.target.value)])}
                  />
                </label>
              </>
            );
          })}
          {ligne(images, ROTATION, 0, curseur(-180, 180, 1, '°', 'rotation'))}
          <div className="reglage-actions">
            <button
              type="button"
              disabled={!canEdit}
              title="L’image entière tient dans le cadre (100 %)"
              onClick={() =>
                appliquer(
                  images,
                  (c) => ({
                    ...c,
                    transform: {
                      ...c.transform,
                      scale: { value: [100, 100], keyframes: [] },
                      position: { value: [0, 0], keyframes: [] },
                      rotation: { value: 0, keyframes: [] },
                    },
                  }),
                  'Recadrer',
                  'cadre',
                )
              }
            >
              Ajuster
            </button>
            <button
              type="button"
              disabled={!canEdit || cadrage(premiereImage) === null}
              title="Agrandit l’image jusqu’à couvrir tout le cadre, sans bande"
              onClick={() =>
                appliquer(
                  images,
                  (c) => {
                    const e = cadrage(c) ?? 100;
                    return {
                      ...c,
                      transform: {
                        ...c.transform,
                        scale: { value: [e, e], keyframes: [] },
                        position: { value: [0, 0], keyframes: [] },
                      },
                    };
                  },
                  'Remplir le cadre',
                  'cadre',
                )
              }
            >
              Remplir
            </button>
            <button
              type="button"
              disabled={!canEdit}
              data-test="zoom-lent"
              title="Pose deux images clés : un lent zoom avant du début à la fin du clip"
              onClick={() =>
                appliquer(
                  images,
                  (c) => {
                    const base = cadrage(c) ?? 100;
                    let p: ParameterDoc = { value: [base, base], keyframes: [] };
                    p = basculerCle(p, 0, [base, base]);
                    p = basculerCle(p, Math.max(1, c.duration - 1), [
                      Math.round(base * 112) / 100,
                      Math.round(base * 112) / 100,
                    ]);
                    return { ...c, transform: { ...c.transform, scale: p } };
                  },
                  'Zoom lent',
                  'zoom',
                )
              }
            >
              Zoom lent
            </button>
          </div>
        </>
      )}

      {sons.length > 0 && (
        <>
          <h4>Son</h4>
          {ligne(sons, VOLUME, 0, curseur(-60, 12, 0.5, 'dB', 'volume'))}
          {ligne(sons, PANORAMIQUE, 0, curseur(-1, 1, 0.05, '', 'pan'))}
        </>
      )}

      <h4>Fondus</h4>
      <ReglagesFondu
        clips={clips}
        etat={etat}
        actions={actions}
        canEdit={canEdit}
        cadence={cadence}
      />
    </Cadre>
  );
}

function Cadre({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="panneau">
      <div className="panneau-corps reglages" data-test="panneau-reglages">
        {children}
      </div>
    </section>
  );
}

function ReglagesTitre({
  titre,
  canEdit,
  surChange,
}: {
  titre: TitleDoc;
  canEdit: boolean;
  surChange: (modifs: Partial<TitleDoc>) => void;
}): React.JSX.Element {
  return (
    <>
      <h4>Titre</h4>
      <textarea
        className="titre-texte"
        rows={3}
        value={titre.text}
        disabled={!canEdit}
        data-test="titre-texte"
        aria-label="Texte du titre"
        onChange={(e) => surChange({ text: e.target.value })}
      />
      <div className="reglage">
        <span className="reglage-nom">Police</span>
        <span className="reglage-valeur">
          <select
            value={titre.font}
            disabled={!canEdit}
            onChange={(e) => {
              surChange({ font: e.target.value as TitleDoc['font'] });
              e.target.blur();
            }}
          >
            <option value="sans">Sans empattement</option>
            <option value="serif">Avec empattement</option>
            <option value="mono">Machine à écrire</option>
            <option value="display">Affiche</option>
          </select>
        </span>
        <span className="reglage-cles" />
      </div>
      <div className="reglage">
        <span className="reglage-nom">Taille</span>
        <span className="reglage-valeur">
          <input
            type="range"
            min={1}
            max={40}
            step={0.5}
            value={titre.size}
            disabled={!canEdit}
            aria-label="Taille du titre"
            onChange={(e) => surChange({ size: Number(e.target.value) })}
            onPointerUp={(e) => e.currentTarget.blur()}
          />
          <span className="unite mono">{titre.size}</span>
        </span>
        <span className="reglage-cles" />
      </div>
      <div className="reglage">
        <span className="reglage-nom">Style</span>
        <span className="reglage-valeur boutons">
          <input
            type="color"
            value={titre.color.slice(0, 7)}
            disabled={!canEdit}
            aria-label="Couleur du texte"
            onChange={(e) => surChange({ color: e.target.value })}
          />
          <button
            type="button"
            className={titre.bold ? 'on' : ''}
            aria-pressed={titre.bold}
            disabled={!canEdit}
            onClick={() => surChange({ bold: !titre.bold })}
          >
            <b>G</b>
          </button>
          <button
            type="button"
            className={titre.italic ? 'on' : ''}
            aria-pressed={titre.italic}
            disabled={!canEdit}
            onClick={() => surChange({ italic: !titre.italic })}
          >
            <i>I</i>
          </button>
          <button
            type="button"
            className={titre.shadow ? 'on' : ''}
            aria-pressed={titre.shadow}
            disabled={!canEdit}
            onClick={() => surChange({ shadow: !titre.shadow })}
          >
            Ombre
          </button>
          <button
            type="button"
            className={titre.background !== null ? 'on' : ''}
            aria-pressed={titre.background !== null}
            disabled={!canEdit}
            onClick={() =>
              surChange({ background: titre.background === null ? '#000000b3' : null })
            }
          >
            Bandeau
          </button>
        </span>
        <span className="reglage-cles" />
      </div>
      <div className="reglage">
        <span className="reglage-nom">Place</span>
        <span className="reglage-valeur">
          <span className="grille-places">
            {POSITIONS_TITRE.map(([x, y]) => (
              <button
                key={`${x}-${y}`}
                type="button"
                className={titre.x === x && titre.y === y ? 'on' : ''}
                aria-label={`Placer le titre (${Math.round(x * 100)} %, ${Math.round(y * 100)} %)`}
                disabled={!canEdit}
                onClick={() => surChange({ x, y })}
              />
            ))}
          </span>
        </span>
        <span className="reglage-cles" />
      </div>
    </>
  );
}

function ReglagesFondu({
  clips,
  etat,
  actions,
  canEdit,
  cadence,
}: {
  clips: readonly ClipDoc[];
  etat: EtatEditeur;
  actions: ActionsEditeur;
  canEdit: boolean;
  cadence: number;
}): React.JSX.Element {
  const transitionsDe = (clip: ClipDoc): readonly TransitionEffective[] => {
    const piste = etat.sequence.tracks.find((t) => t.id === clip.trackId);
    return piste === undefined ? [] : transitionsEffectives(piste);
  };
  const fondu = (clip: ClipDoc, bord: 'entree' | 'sortie'): TransitionEffective | undefined =>
    transitionsDe(clip).find((t) =>
      bord === 'entree' ? t.vers?.id === clip.id : t.de?.id === clip.id,
    );

  const regler = (bord: 'entree' | 'sortie', secondes: number): void => {
    const commandes = clips.flatMap((clip) => {
      const existante = fondu(clip, bord);
      const duree = Math.round(secondes * cadence);
      if (duree <= 0)
        return existante === undefined ? [] : [retirerTransitionCommand(existante.id)];
      if (existante !== undefined) {
        return [modifierTransitionCommand(existante.id, { duration: duree })];
      }
      return [
        poserTransitionCommand({
          trackId: clip.trackId,
          fromClipId: bord === 'sortie' ? clip.id : null,
          toClipId: bord === 'entree' ? clip.id : null,
          type: clip.kind === 'audio' ? TRANSITION_SON : 'dissolve',
          duration: duree,
        }),
      ];
    });
    if (commandes.length > 0) {
      actions.executer(
        transaction(bord === 'entree' ? 'Fondu d’entrée' : 'Fondu de sortie', commandes),
      );
    }
  };

  const premier = clips[0];
  const ligne = (bord: 'entree' | 'sortie', nom: string): React.JSX.Element => {
    const t = premier === undefined ? undefined : fondu(premier, bord);
    const secondes = t === undefined ? 0 : t.dureeDemandee / cadence;
    const croise = t?.de !== null && t?.vers !== null && t !== undefined;
    return (
      <div className="reglage">
        <span className="reglage-nom">{nom}</span>
        <span className="reglage-valeur">
          <input
            type="number"
            className="nombre"
            min={0}
            step={0.1}
            value={Math.round(secondes * 100) / 100}
            disabled={!canEdit}
            data-test={`fondu-${bord}`}
            onChange={(e) => regler(bord, Number(e.target.value))}
          />
          <span className="unite">s</span>
          {croise && t !== undefined && (
            <span className="reglage-note">
              {nomTransition(t.type)}, partagé avec le plan voisin
            </span>
          )}
        </span>
        <span className="reglage-cles" />
      </div>
    );
  };
  return (
    <>
      {ligne('entree', 'Entrée')}
      {ligne('sortie', 'Sortie')}
    </>
  );
}

function ReglagesTransition({
  transition,
  etat,
  actions,
  canEdit,
  cadence,
}: {
  transition: TransitionEffective;
  etat: EtatEditeur;
  actions: ActionsEditeur;
  canEdit: boolean;
  cadence: number;
}): React.JSX.Element {
  const son = etat.sequence.tracks.find((t) => t.id === transition.trackId)?.kind === 'audio';
  const croisee = transition.de !== null && transition.vers !== null;
  const reelle = (transition.fin - transition.debut) / cadence;
  return (
    <>
      <h4>{nomTransition(transition.type)}</h4>
      {!son && croisee && (
        <div className="reglage">
          <span className="reglage-nom">Type</span>
          <span className="reglage-valeur">
            <select
              value={transition.type}
              disabled={!canEdit}
              data-test="transition-type"
              onChange={(e) => {
                actions.executer(
                  modifierTransitionCommand(transition.id, { type: e.target.value }),
                );
                e.target.blur();
              }}
            >
              {TRANSITIONS_IMAGE.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
            </select>
          </span>
          <span className="reglage-cles" />
        </div>
      )}
      <div className="reglage">
        <span className="reglage-nom">Durée</span>
        <span className="reglage-valeur">
          <input
            type="number"
            className="nombre"
            min={0.04}
            step={0.1}
            value={Math.round((transition.dureeDemandee / cadence) * 100) / 100}
            disabled={!canEdit}
            data-test="transition-duree"
            onChange={(e) => {
              const secondes = Number(e.target.value);
              if (secondes > 0) {
                actions.executer(
                  modifierTransitionCommand(
                    transition.id,
                    { duration: secondes * cadence },
                    `duree-transition:${transition.id}`,
                  ),
                );
              }
            }}
          />
          <span className="unite">s</span>
          {Math.abs(transition.dureeDemandee / cadence - reelle) > 0.01 && (
            <span className="reglage-note">
              {reelle.toFixed(2).replace('.', ',')} s jouées : les plans sont trop courts
            </span>
          )}
        </span>
        <span className="reglage-cles" />
      </div>
      <div className="reglage-actions">
        <button
          type="button"
          disabled={!canEdit}
          data-test="retirer-transition"
          onClick={() => {
            if (actions.executer(retirerTransitionCommand(transition.id))) {
              actions.definirTransition(null);
            }
          }}
        >
          <Trash2 size={13} /> Retirer
        </button>
      </div>
    </>
  );
}
