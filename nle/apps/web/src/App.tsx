/**
 * Espace de travail Montage (§5, §6).
 *
 * Ce que cette interface fait REELLEMENT : monter. Déplacer, trimer, couper,
 * ripple, roll, slip, slide, étirer, annuler, refaire, zoomer, accrocher, au
 * clavier comme à la souris — le tout à travers le moteur testé.
 *
 * Ce qu'elle ne fait PAS, et qu'elle annonce clairement plutôt que de le
 * simuler (§1003) : lire de la vidéo, afficher des vignettes, afficher des
 * formes d'onde, exporter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTimecode, parseTimecodeEntry, rational } from '@valideo/time-core';
import { DEFAULT_KEYMAP, KeyResolver, ShuttleController } from '@valideo/keyboard';
import type { KeyContext } from '@valideo/keyboard';
import {
  addEditCommand,
  deleteClipsCommand,
  nextEditPoint,
  previousEditPoint,
  sequenceDuration,
} from '@valideo/timeline-model';
import {
  clampScroll,
  fit,
  timeToX,
  viewport as creerViewport,
  zoomAt,
  zoomCentered,
} from '@valideo/timeline-engine';
import type { Viewport } from '@valideo/timeline-engine';
import { Timeline } from './timeline/Timeline.js';
import { timebaseDeSequence } from './timeline/draw.js';
import { useEditeur } from './store.js';
import type { Outil } from './store.js';
import { PanneauMedias } from './panels/PanneauMedias.js';
import { PanneauProjet } from './panels/PanneauProjet.js';
import { Moniteur } from './panels/Moniteur.js';
import { MoniteurProgramme } from './panels/MoniteurProgramme.js';
import { PanneauInfo } from './panels/PanneauInfo.js';
import { usePersistance } from './persistance.js';
import { TransportAudio } from './playback/transport.js';

const OUTILS: readonly { id: Outil; libelle: string; touche: string; titre: string }[] = [
  { id: 'selection', libelle: 'V', touche: 'V', titre: 'Sélection' },
  { id: 'trackSelect', libelle: 'A', touche: 'A', titre: 'Sélection de piste' },
  { id: 'ripple', libelle: 'B', touche: 'B', titre: 'Ripple' },
  { id: 'rolling', libelle: 'N', touche: 'N', titre: 'Rolling' },
  { id: 'rateStretch', libelle: 'R', touche: 'R', titre: 'Étirement temporel' },
  { id: 'razor', libelle: 'C', touche: 'C', titre: 'Lame' },
  { id: 'slip', libelle: 'Y', touche: 'Y', titre: 'Slip' },
  { id: 'slide', libelle: 'U', touche: 'U', titre: 'Slide' },
  { id: 'hand', libelle: 'H', touche: 'H', titre: 'Main' },
];

const OUTIL_PAR_ACTION: Readonly<Record<string, Outil>> = {
  'tool.selection': 'selection',
  'tool.trackSelectForward': 'trackSelect',
  'tool.ripple': 'ripple',
  'tool.rolling': 'rolling',
  'tool.rateStretch': 'rateStretch',
  'tool.razor': 'razor',
  'tool.slip': 'slip',
  'tool.slide': 'slide',
  'tool.hand': 'hand',
};

export function App(): React.JSX.Element {
  const [etat, actions] = useEditeur();
  const [vue, definirVue] = useState<Viewport>(() => creerViewport(0, 1.4, 800));
  const [defilementVertical, definirDefilementVertical] = useState(0);
  const [shuttle] = useState(() => new ShuttleController());
  const [vitesse, definirVitesse] = useState(0);
  const [clipsMuets, definirClipsMuets] = useState<readonly string[]>([]);

  // Références lues par le transport : il vit hors du cycle de rendu React et
  // ne doit pas être recréé à chaque import de média.
  const tamponsRef = useRef(etat.tampons);
  tamponsRef.current = etat.tampons;
  const mediasRef = useRef(new Map(etat.document.media.map((m) => [m.id, m])));
  mediasRef.current = new Map(etat.document.media.map((m) => [m.id, m]));

  /** Cadence d'un média, pour convertir une position de timeline en position source. */
  const cadenceMedia = useCallback((mediaId: string): number => {
    const media = mediasRef.current.get(mediaId);
    return media === undefined ? 0 : media.duration.base.rate.n / media.duration.base.rate.d;
  }, []);

  const persistance = usePersistance({
    document: etat.document,
    modifie: etat.historique.dirty,
    surChargement: actions.chargerDocument,
    surEnregistrement: actions.enregistrer,
  });

  const base = useMemo(() => timebaseDeSequence(etat.sequence), [etat.sequence]);

  /**
   * Transport audio. L'horloge audio est maître (§22) : la tête de lecture est
   * DÉRIVÉE de `AudioContext.currentTime`, jamais incrémentée à la main.
   */
  const transportRef = useRef<TransportAudio | null>(null);
  if (transportRef.current === null) {
    transportRef.current = new TransportAudio({
      tampon: (mediaId) => tamponsRef.current.get(mediaId) ?? null,
      cadenceSource: (mediaId) => {
        const media = mediasRef.current.get(mediaId);
        return media === undefined
          ? null
          : rational(media.duration.base.rate.n, media.duration.base.rate.d);
      },
      surFin: () => {
        shuttle.stop();
        definirVitesse(0);
      },
    });
  }
  const transport = transportRef.current;
  const duree = useMemo(() => sequenceDuration(etat.sequence), [etat.sequence]);
  const resolveur = useMemo(
    () =>
      new KeyResolver(
        DEFAULT_KEYMAP,
        navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other',
      ),
    [],
  );

  const timecode = useCallback(
    (image: number) => formatTimecode(etat.sequence.startTimecode + image, base),
    [base, etat.sequence.startTimecode],
  );

  /**
   * Zoom clavier et zoom des boutons : centres sur la TETE DE LECTURE quand elle
   * est visible, comme dans tout NLE. Zoomer sur le milieu de la vue eloigne du
   * point de travail a chaque cran, ce qui oblige a repositionner sans cesse.
   */
  const zoomer = useCallback(
    (facteur: number) => {
      definirVue((v) => {
        const vue = creerViewport(v.scroll, v.pixelsPerFrame, v.width);
        const x = timeToX(vue, etat.tete);
        const suivante =
          x >= 0 && x <= vue.width ? zoomAt(vue, x, facteur) : zoomCentered(vue, facteur);
        return facteur < 1 ? clampScroll(suivante, duree) : suivante;
      });
    },
    [duree, etat.tete],
  );

  const ajuster = useCallback(() => {
    definirVue((v) =>
      fit(creerViewport(v.scroll, v.pixelsPerFrame, v.width), Math.max(1, duree), 20),
    );
  }, [duree]);

  /**
   * Navigation par points de montage : elle se limite aux pistes CIBLÉES, comme
   * dans tout NLE. Sans cette restriction, la tête s'arrêterait sur le moindre
   * raccord d'une piste de titrage qu'on ne regarde pas.
   * Si aucune piste n'est ciblée, on retombe sur l'ensemble des pistes.
   */
  const pistesNavigables = useMemo(() => {
    const ciblees = etat.sequence.tracks.filter((t) => t.targeted).map((t) => t.id);
    return ciblees.length > 0 ? ciblees : etat.sequence.tracks.map((t) => t.id);
  }, [etat.sequence.tracks]);

  const executerAction = useCallback(
    (actionId: string): boolean => {
      const outil = OUTIL_PAR_ACTION[actionId];
      if (outil !== undefined) {
        actions.definirOutil(outil);
        return true;
      }

      switch (actionId) {
        case 'edit.undo':
          actions.annuler();
          return true;
        case 'edit.redo':
          actions.retablir();
          return true;
        case 'file.save':
          void persistance.enregistrer(etat.document);
          return true;
        case 'timeline.toggleSnap':
          actions.basculerAccrochage();
          return true;
        case 'timeline.zoomIn':
          zoomer(1.4);
          return true;
        case 'timeline.zoomOut':
          zoomer(1 / 1.4);
          return true;
        case 'timeline.zoomToFit':
          ajuster();
          return true;
        case 'nav.nextFrame':
          actions.definirTete(etat.tete + 1);
          return true;
        case 'nav.previousFrame':
          actions.definirTete(etat.tete - 1);
          return true;
        case 'nav.nextFrame5':
          actions.definirTete(etat.tete + 5);
          return true;
        case 'nav.previousFrame5':
          actions.definirTete(etat.tete - 5);
          return true;
        case 'nav.start':
          actions.definirTete(0);
          return true;
        case 'nav.end':
          actions.definirTete(duree);
          return true;
        case 'nav.nextEdit': {
          const p = nextEditPoint(etat.sequence, etat.tete, pistesNavigables);
          if (p !== null) actions.definirTete(p);
          return true;
        }
        case 'nav.previousEdit': {
          const p = previousEditPoint(etat.sequence, etat.tete, pistesNavigables);
          if (p !== null) actions.definirTete(p);
          return true;
        }
        case 'edit.addEdit':
          actions.executer(addEditCommand(etat.tete, etat.contexte));
          return true;
        case 'edit.delete':
        case 'edit.rippleDelete': {
          if (etat.selection.size === 0) return true;
          // Une seule commande pour toute la sélection : sinon supprimer cinq
          // clips demanderait cinq annulations, et un ripple appliqué clip par
          // clip retirerait les mauvaises plages.
          const supprime = actions.executer(
            deleteClipsCommand([...etat.selection], etat.contexte, actionId === 'edit.rippleDelete'),
          );
          if (supprime) actions.definirSelection([]);
          return true;
        }
        case 'playback.shuttleForward':
          shuttle.pressL();
          definirVitesse(shuttle.rate());
          return true;
        case 'playback.shuttleReverse':
          shuttle.pressJ();
          definirVitesse(shuttle.rate());
          return true;
        case 'playback.stop':
          shuttle.pressK();
          shuttle.releaseK();
          definirVitesse(shuttle.rate());
          return true;
        case 'playback.togglePlay':
          shuttle.togglePlay();
          definirVitesse(shuttle.rate());
          return true;
        default:
          return false;
      }
    },
    [actions, ajuster, duree, etat, persistance, pistesNavigables, shuttle, zoomer],
  );

  useEffect(() => {
    const surTouche = (e: KeyboardEvent): void => {
      const cible = e.target;
      if (cible instanceof HTMLInputElement || cible instanceof HTMLTextAreaElement) return;
      const contexte: KeyContext = 'timeline';
      const actionId = resolveur.resolve(
        {
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        },
        contexte,
      );
      if (actionId === null) return;
      if (executerAction(actionId)) e.preventDefault();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [executerAction, resolveur]);

  /**
   * Lecture.
   *
   * À vitesse 1, le son est joué et c'est l'horloge audio qui commande : la tête
   * de lecture se contente de LIRE la position du transport à chaque image
   * d'écran. Aux autres vitesses, aucun son n'est produit -- Web Audio ne sait
   * pas rejouer un tampon à l'envers, et au-delà de quelques fois la vitesse
   * nominale le son n'apporte plus rien (§32) -- et la tête avance alors sur
   * l'horloge du navigateur, ce que l'interface signale.
   */
  useEffect(() => {
    actions.definirEnLecture(vitesse !== 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitesse]);

  useEffect(() => {
    if (vitesse === 0) {
      transport.arreter();
      transport.placer(etat.tete);
      definirClipsMuets([]);
      return undefined;
    }

    let id = 0;

    if (vitesse === 1) {
      void transport.demarrer(etat.sequence, etat.tete, duree).then(() => {
        definirClipsMuets(transport.etat().ignores.map((i) => `${i.raison}`));
      });
      const suivre = (): void => {
        actions.definirTete(Math.min(duree, Math.round(transport.position())));
        id = requestAnimationFrame(suivre);
      };
      id = requestAnimationFrame(suivre);
      return () => {
        cancelAnimationFrame(id);
        transport.arreter();
      };
    }

    let dernier = performance.now();
    let brut = etat.tete;
    const pas = (maintenant: number): void => {
      const dt = (maintenant - dernier) / 1000;
      dernier = maintenant;
      brut += vitesse * dt * (base.rate.n / base.rate.d);
      const image = Math.max(0, Math.min(duree, Math.round(brut)));
      actions.definirTete(image);
      if (image >= duree || image <= 0) {
        shuttle.stop();
        definirVitesse(0);
        return;
      }
      id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
    // Volontairement déclenché par le seul changement de vitesse : relancer le
    // transport à chaque déplacement de tête le ferait bégayer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitesse]);

  const saisirTimecode = useCallback(() => {
    const saisie = window.prompt(
      'Aller au timecode (ex. 01:00:12:00, 1512, +10)',
      timecode(etat.tete),
    );
    if (saisie === null) return;
    try {
      const absolu = parseTimecodeEntry(saisie, base, etat.sequence.startTimecode + etat.tete);
      actions.definirTete(absolu - etat.sequence.startTimecode);
    } catch {
      // Une saisie invalide ne fait rien : pas de position inventée.
    }
  }, [actions, base, etat.sequence.startTimecode, etat.tete, timecode]);

  // Tant que le stockage n'a pas répondu, on n'affiche pas de document : sinon
  // le projet de démonstration apparaîtrait une fraction de seconde avant d'être
  // remplacé par le projet enregistré, ce qui est déroutant et fait croire à une
  // perte de travail.
  if (!persistance.pret) {
    return (
      <div className="app">
        <header className="barre-menu">
          <span className="marque">VALIDEO</span>
        </header>
        <div className="ouverture">Ouverture du projet…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="barre-menu">
        <span className="marque">VALIDEO</span>
        {[
          'Fichier',
          'Édition',
          'Clip',
          'Séquence',
          'Marqueur',
          'Graphiques',
          'Fenêtre',
          'Aide',
        ].map((m) => (
          <span className="menu" key={m}>
            {m}
          </span>
        ))}
        <span className="espace" />
        <span className="etiquette-etat partiel">Socle · montage fonctionnel</span>
      </header>

      {persistance.reprise.type === 'disponible' && (
        <div className="bandeau-reprise">
          <strong>Travail non enregistré retrouvé.</strong> Une session précédente s’est interrompue
          sans enregistrer&nbsp;; une sauvegarde automatique plus récente que le dernier
          enregistrement existe.
          <button type="button" className="actif" onClick={persistance.accepterReprise}>
            Récupérer
          </button>
          <button type="button" onClick={persistance.refuserReprise}>
            Ignorer
          </button>
        </div>
      )}

      {!persistance.persistant && (
        <div className="bandeau-reprise alerte">
          <strong>Aucun stockage persistant.</strong> Ce navigateur ne permet ni OPFS ni
          localStorage&nbsp;: le projet sera perdu à la fermeture de l’onglet.
        </div>
      )}

      <div className="espace-travail">
        <Moniteur titre="Moniteur Source" />
        <MoniteurProgramme
          sequence={etat.sequence}
          tete={etat.tete}
          tempsCode={timecode(etat.tete)}
          duree={timecode(duree)}
          sources={etat.sourcesVideo}
          mediaCadence={cadenceMedia}
          enLecture={vitesse !== 0}
        />

        <section className="panneau">
          <div className="panneau-entete">
            <span className="titre">Projet</span>
            <span className="espace" />
            <span>{etat.sequence.tracks.reduce((n, t) => n + t.clips.length, 0)} clips</span>
          </div>
          <div className="panneau-corps">
            <PanneauMedias etat={etat} actions={actions} timecode={timecode} />
            <div className="panneau-entete" style={{ marginTop: 8 }}>
              <span className="titre">Clips de la séquence</span>
            </div>
            <PanneauProjet sequence={etat.sequence} timecode={timecode} />
          </div>
        </section>

        <PanneauInfo etat={etat} actions={actions} timecode={timecode} duree={duree} />

        <section className="panneau zone-timeline" style={{ gridColumn: '1 / -1' }}>
          <div className="panneau-entete">
            <span className="titre">Timeline · {etat.sequence.name}</span>
            <span className="espace" />
            <button
              type="button"
              onClick={saisirTimecode}
              className="mono"
              title="Saisir un timecode (§16)"
            >
              {timecode(etat.tete)}
            </button>
          </div>

          <div className="timeline-outils">
            {OUTILS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`outil ${etat.outil === o.id ? 'actif' : ''}`}
                title={`${o.titre} (${o.touche})`}
                onClick={() => actions.definirOutil(o.id)}
              >
                {o.libelle}
              </button>
            ))}
            <span className="sep" />
            <button
              type="button"
              className={etat.accrochage ? 'actif' : ''}
              onClick={actions.basculerAccrochage}
              title="Accrochage magnétique (S)"
            >
              Accrochage
            </button>
            <span className="sep" />
            <button
              type="button"
              onClick={actions.annuler}
              disabled={!etat.historique.canUndo}
              title="Annuler"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={actions.retablir}
              disabled={!etat.historique.canRedo}
              title="Rétablir"
            >
              ↷
            </button>
            <span className="sep" />
            <button type="button" onClick={() => zoomer(1 / 1.6)} title="Zoom arrière">
              −
            </button>
            <button type="button" onClick={() => zoomer(1.6)} title="Zoom avant">
              +
            </button>
            <button type="button" onClick={ajuster} title="Ajuster la séquence">
              Ajuster
            </button>
            <span className="sep" />
            <button
              type="button"
              onClick={() => void persistance.enregistrer(etat.document)}
              disabled={persistance.etat === 'enregistrement'}
              title="Enregistrer le projet (Ctrl+S)"
            >
              Enregistrer
            </button>
            <span className="sep" />
            <button
              type="button"
              className={vitesse !== 0 ? 'actif' : ''}
              onClick={() => executerAction('playback.togglePlay')}
              title="Lecture / Pause (Espace)"
              data-test="lecture"
            >
              {vitesse !== 0 ? '⏸' : '▶'}
            </button>
            <span className="espace" style={{ flex: 1 }} />
            {vitesse !== 0 && (
              <span className="mono" data-test="etat-lecture">
                {vitesse > 0 ? `▶ ${vitesse}×` : `◀ ${-vitesse}×`}
                {vitesse === 1 ? ' · son' : ' · sans son'}
              </span>
            )}
          </div>

          <Timeline
            etat={etat}
            actions={actions}
            vue={vue}
            definirVue={definirVue}
            defilementVertical={defilementVertical}
            definirDefilementVertical={definirDefilementVertical}
          />
        </section>
      </div>

      <footer className="barre-etat">
        <span className="mono">{timecode(etat.tete)}</span>
        <span>
          {etat.sequence.settings.width}×{etat.sequence.settings.height}
        </span>
        <span>
          {(base.rate.n / base.rate.d).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} i/s{' '}
          {base.mode}
        </span>
        <span>
          {etat.selection.size} sélectionné{etat.selection.size > 1 ? 's' : ''}
        </span>
        <span className="espace" />
        {clipsMuets.length > 0 && (
          <span className="alerte" title={clipsMuets.join('\n')}>
            {clipsMuets.length} clip(s) non joué(s)
          </span>
        )}
        {persistance.erreur !== null && (
          <span className="alerte" title={persistance.erreur.detail ?? ''}>
            {persistance.erreur.message}
          </span>
        )}
        {etat.derniereErreur !== null && (
          <span className="alerte" title={etat.derniereErreur.detail ?? ''}>
            {etat.derniereErreur.message}
            {etat.derniereErreur.action !== undefined ? ` — ${etat.derniereErreur.action}` : ''}
          </span>
        )}
        <span title={`Stockage : ${persistance.nomStockage}`}>
          {persistance.etat === 'enregistrement'
            ? 'Enregistrement…'
            : persistance.etat === 'erreur'
              ? 'Échec de l’enregistrement'
              : etat.historique.dirty
                ? 'Modifié'
                : 'Enregistré'}
        </span>
      </footer>
    </div>
  );
}
