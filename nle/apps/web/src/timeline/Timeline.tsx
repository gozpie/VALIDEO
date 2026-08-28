/**
 * Panneau Timeline.
 *
 * Point d architecture (section 2) : pendant un geste -- deplacement, trim,
 * scrub -- AUCUN etat React n est modifie. Le geste vit dans une `ref` mutable
 * et le canvas est redessine dans une boucle d animation. React n intervient
 * qu au relachement, pour appliquer la commande.
 *
 * C est ce qui permet a un deplacement de rester fluide sur une sequence dense :
 * le cout par image est celui d un `dessinerTimeline`, mesure a 0,1 ms sur
 * 10 000 clips, pas celui d un arbre de composants.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildRenderModel,
  clampScroll,
  collectSnapTargets,
  fit,
  hitTest,
  marqueeSelect,
  scrollBy,
  scrollIntoView,
  snapClipMove,
  snapFrame,
  ticks,
  viewport as creerViewport,
  xToTime,
  xToTimeExact,
  zoomAt,
} from '@valideo/timeline-engine';
import type { Viewport } from '@valideo/timeline-engine';
import {
  clipEnd,
  findClip,
  linkedClips,
  moveClipCommand,
  razorCommand,
  rateStretchCommand,
  rollCommand,
  sequenceDuration,
  slideCommand,
  slipCommand,
  trimCommand,
} from '@valideo/timeline-model';
import { setTrackFlagsCommand, selectTrackForward } from '@valideo/timeline-model';
import {
  IconeCible,
  IconeMuet,
  IconeOeil,
  IconeSolo,
  IconeSync,
  IconeVerrou,
} from '../panels/Icones.js';
import type { ActionsEditeur, EtatEditeur } from '../store.js';
import { readWaveform } from '@valideo/audio-engine';
import { CacheVignettes } from '../media/thumbnails.js';
import { HAUTEUR_REGLE, dessinerTimeline, timebaseDeSequence } from './draw.js';
import type { ApercuGeste, FournisseurFormeOnde, FournisseurVignette } from './draw.js';

type Geste =
  | { type: 'aucun' }
  | { type: 'scrub' }
  | {
      type: 'deplacement';
      clipId: string;
      ids: Set<string>;
      imageDepart: number;
      xDepart: number;
      yDepart: number;
      dx: number;
      dy: number;
      accroche: number | null;
    }
  | { type: 'trim'; clipId: string; bord: 'in' | 'out'; xDepart: number; delta: number }
  | { type: 'roll'; trackId: string; image: number; xDepart: number; delta: number }
  | { type: 'slip'; clipId: string; xDepart: number; delta: number }
  | { type: 'slide'; clipId: string; xDepart: number; delta: number }
  | { type: 'etirement'; clipId: string; xDepart: number; dureeDepart: number; duree: number }
  | { type: 'rectangle'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'main'; xDepart: number };

export interface ProprietesTimeline {
  readonly etat: EtatEditeur;
  readonly actions: ActionsEditeur;
  readonly vue: Viewport;
  readonly definirVue: (v: Viewport | ((v: Viewport) => Viewport)) => void;
  readonly defilementVertical: number;
  readonly definirDefilementVertical: (v: number) => void;
}

export function Timeline({
  etat,
  actions,
  vue,
  definirVue,
  defilementVertical,
  definirDefilementVertical,
}: ProprietesTimeline): React.JSX.Element {
  const toileRef = useRef<HTMLCanvasElement | null>(null);
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const gesteRef = useRef<Geste>({ type: 'aucun' });
  const [taille, setTaille] = useState({ largeur: 800, hauteur: 300 });
  const [curseur, setCurseur] = useState('default');
  /** Compteur incrémenté quand une vignette devient prête, pour redessiner. */
  const [generationVignettes, setGenerationVignettes] = useState(0);

  const cacheVignettesRef = useRef<CacheVignettes | null>(null);
  if (cacheVignettesRef.current === null) {
    cacheVignettesRef.current = new CacheVignettes(400, () => setGenerationVignettes((g) => g + 1));
  }
  const cacheVignettes = cacheVignettesRef.current;

  const base = useMemo(() => timebaseDeSequence(etat.sequence), [etat.sequence]);
  const duree = useMemo(() => sequenceDuration(etat.sequence), [etat.sequence]);

  // Mesure du conteneur : la timeline suit la taille du panneau.
  //
  // La largeur mesurée est REMONTÉE dans le viewport partagé. Sans cela, l'état
  // conserverait sa largeur initiale arbitraire, et tout ce qui en dépend --
  // ajustement de la séquence, ancrage du zoom, bornage du défilement -- se
  // calculerait sur une vue qui n'existe pas.
  useLayoutEffect(() => {
    const noeud = conteneurRef.current;
    if (noeud === null) return undefined;
    const observateur = new ResizeObserver((entrees) => {
      const rect = entrees[0]?.contentRect;
      if (rect === undefined) return;
      const largeur = Math.max(1, rect.width);
      setTaille({ largeur, hauteur: Math.max(1, rect.height) });
      definirVue((v) =>
        v.width === largeur ? v : creerViewport(v.scroll, v.pixelsPerFrame, largeur),
      );
    });
    observateur.observe(noeud);
    return () => observateur.disconnect();
  }, [definirVue]);

  const vueMesuree = useMemo<Viewport>(
    () => creerViewport(vue.scroll, vue.pixelsPerFrame, taille.largeur),
    [vue.scroll, vue.pixelsPerFrame, taille.largeur],
  );

  const modele = useMemo(
    () =>
      buildRenderModel(etat.sequence, vueMesuree, {
        verticalScroll: defilementVertical,
        viewportHeight: taille.hauteur - HAUTEUR_REGLE,
        selection: etat.selection,
        playhead: etat.tete,
      }),
    [etat.sequence, etat.selection, etat.tete, vueMesuree, defilementVertical, taille.hauteur],
  );

  const graduations = useMemo(() => ticks(vueMesuree, base, 90), [vueMesuree, base]);

  const mediasParId = useMemo(
    () => new Map(etat.document.media.map((m) => [m.id, m])),
    [etat.document.media],
  );

  // Pendant la lecture, le décodeur doit tenir la cadence : on ne lui demande
  // pas de vignettes en même temps.
  useEffect(() => {
    cacheVignettes.suspendre(etat.enLecture);
  }, [cacheVignettes, etat.enLecture]);

  /**
   * Vignette d'un clip, si elle est déjà décodée.
   *
   * Le rendu est synchrone : il ne peut pas attendre. Une vignette absente est
   * demandée puis omise ; elle apparaîtra au rendu suivant (§18).
   */
  const vignette = useMemo<FournisseurVignette>(
    () => (clip, secondesDansLeClip) => {
      if (clip.mediaId === null) return null;
      const source = etat.sourcesVideo.get(clip.mediaId);
      const media = mediasParId.get(clip.mediaId);
      if (source === undefined || media === undefined || !source.infos.decodable) return null;
      const cadenceSource = media.duration.base.rate.n / media.duration.base.rate.d;
      if (cadenceSource <= 0) return null;
      const vitesse = clip.speed.n / clip.speed.d;
      const secondes = clip.sourceIn / cadenceSource + secondesDansLeClip * vitesse;
      return cacheVignettes.obtenir(clip.mediaId, source, secondes);
    },
    [cacheVignettes, etat.sourcesVideo, mediasParId],
  );

  /**
   * Forme d onde d un clip, lue dans la pyramide de pics du média.
   *
   * On ne calcule que la portion VISIBLE du clip, une colonne par pixel : un
   * clip de deux heures dont on voit trois secondes ne coûte que ces trois
   * secondes (§19, §55).
   */
  const formeOnde = useMemo<FournisseurFormeOnde>(
    () => (clip, colonnes) => {
      if (clip.mediaId === null) return null;
      const pyramide = etat.pics.get(clip.mediaId);
      const media = mediasParId.get(clip.mediaId);
      if (pyramide === undefined || media === undefined) return null;

      const cadenceSource = media.duration.base.rate.n / media.duration.base.rate.d;
      const cadenceSequence = base.rate.n / base.rate.d;
      const vitesse = clip.speed.n / clip.speed.d;
      if (cadenceSource <= 0 || cadenceSequence <= 0) return null;

      // Instant source correspondant à une position de timeline, en secondes.
      const secondesA = (x: number): number => {
        const decalage = xToTimeExact(vueMesuree, x) - clip.start;
        return clip.sourceIn / cadenceSource + (decalage * vitesse) / cadenceSequence;
      };

      const debut = secondesA(clip.x) * pyramide.sampleRate;
      const fin = secondesA(clip.x + clip.width) * pyramide.sampleRate;
      if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return null;
      return readWaveform(pyramide, 0, debut, fin, colonnes);
    },
    [base.rate.d, base.rate.n, etat.pics, mediasParId, vueMesuree],
  );

  /** Redessine immediatement, sans passer par React. */
  const redessiner = useCallback(() => {
    const toile = toileRef.current;
    if (toile === null) return;
    const ctx = toile.getContext('2d');
    if (ctx === null) return;

    const geste = gesteRef.current;
    let apercu: ApercuGeste | null = null;
    if (geste.type === 'deplacement') {
      apercu = {
        clipIds: geste.ids,
        decalageX: geste.dx,
        decalageY: geste.dy,
        accroche: geste.accroche,
        rectangle: null,
      };
    } else if (geste.type === 'rectangle') {
      apercu = {
        clipIds: new Set<string>(),
        decalageX: 0,
        decalageY: 0,
        accroche: null,
        rectangle: { x1: geste.x1, y1: geste.y1, x2: geste.x2, y2: geste.y2 },
      };
    }

    dessinerTimeline(ctx, {
      sequence: etat.sequence,
      modele,
      viewport: vueMesuree,
      largeur: taille.largeur,
      hauteur: taille.hauteur,
      tete: etat.tete,
      graduations,
      base,
      debutTimecode: etat.sequence.startTimecode,
      geste: apercu,
      dpr: window.devicePixelRatio || 1,
      formeOnde,
      vignette,
    });
  }, [
    etat.sequence,
    etat.tete,
    modele,
    vueMesuree,
    taille,
    graduations,
    base,
    formeOnde,
    vignette,
  ]);

  // Dimensionnement du canvas en pixels physiques : sans cela le rendu est flou
  // sur un écran à haute densité.
  useLayoutEffect(() => {
    const toile = toileRef.current;
    if (toile === null) return;
    const dpr = window.devicePixelRatio || 1;
    toile.width = Math.round(taille.largeur * dpr);
    toile.height = Math.round(taille.hauteur * dpr);
    redessiner();
  }, [taille, redessiner]);

  useEffect(() => {
    redessiner();
    // `generationVignettes` n'est pas lu par `redessiner` : il sert uniquement
    // à redéclencher le dessin quand une vignette vient d'être décodée.
  }, [redessiner, generationVignettes]);

  const positionLocale = useCallback(
    (e: React.PointerEvent | PointerEvent): { x: number; y: number } => {
      const toile = toileRef.current;
      if (toile === null) return { x: 0, y: 0 };
      const rect = toile.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const ciblesAccroche = useCallback(
    (exclus: ReadonlySet<string>) =>
      collectSnapTargets(etat.sequence, vueMesuree, { playhead: etat.tete, exclude: exclus }),
    [etat.sequence, vueMesuree, etat.tete],
  );

  const surPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = positionLocale(e);
      (e.target as Element).setPointerCapture(e.pointerId);

      // La règle : on scrube, quel que soit l'outil.
      if (y < HAUTEUR_REGLE) {
        gesteRef.current = { type: 'scrub' };
        actions.definirTete(Math.max(0, xToTime(vueMesuree, x)));
        return;
      }

      const yPiste = y - HAUTEUR_REGLE;
      const impact = hitTest(modele, vueMesuree, x, yPiste);
      const image = Math.max(0, xToTime(vueMesuree, x));

      if (etat.outil === 'hand') {
        gesteRef.current = { type: 'main', xDepart: x };
        return;
      }

      if (etat.outil === 'trackSelect') {
        if (impact.trackId !== null) {
          actions.definirSelection(
            selectTrackForward(etat.sequence, impact.trackId, image, e.shiftKey),
          );
        }
        return;
      }

      if (etat.outil === 'razor') {
        if (impact.trackId !== null) {
          actions.executer(razorCommand(image, [impact.trackId], etat.contexte));
        }
        return;
      }

      if (impact.clipId === null) {
        actions.definirSelection([]);
        gesteRef.current = { type: 'rectangle', x1: x, y1: yPiste, x2: x, y2: yPiste };
        return;
      }

      const clipId = impact.clipId;
      const trouve = findClip(etat.sequence, clipId);
      if (trouve === undefined) return;

      // Sélection : le clic sélectionne, et entraîne les clips liés (§78, §80).
      const lies = linkedClips(etat.sequence, trouve.clip).map((c) => c.id);
      if (!etat.selection.has(clipId)) {
        actions.definirSelection(e.shiftKey ? [...etat.selection, ...lies] : lies);
      } else if (e.shiftKey) {
        actions.basculerSelection(clipId, true);
      }

      const surBord = impact.kind === 'clipEdgeIn' || impact.kind === 'clipEdgeOut';
      const bord = impact.kind === 'clipEdgeIn' ? 'in' : 'out';

      switch (etat.outil) {
        case 'slip':
          gesteRef.current = { type: 'slip', clipId, xDepart: x, delta: 0 };
          return;
        case 'slide':
          gesteRef.current = { type: 'slide', clipId, xDepart: x, delta: 0 };
          return;
        case 'rateStretch':
          gesteRef.current = {
            type: 'etirement',
            clipId,
            xDepart: x,
            dureeDepart: trouve.clip.duration,
            duree: trouve.clip.duration,
          };
          return;
        case 'rolling':
          if (surBord) {
            const coupe = bord === 'in' ? trouve.clip.start : clipEnd(trouve.clip);
            gesteRef.current = {
              type: 'roll',
              trackId: trouve.track.id,
              image: coupe,
              xDepart: x,
              delta: 0,
            };
            return;
          }
          break;
        default:
          break;
      }

      if (surBord) {
        gesteRef.current = { type: 'trim', clipId, bord, xDepart: x, delta: 0 };
        return;
      }

      const ids = new Set(etat.selection.has(clipId) ? [...etat.selection, ...lies] : lies);
      gesteRef.current = {
        type: 'deplacement',
        clipId,
        ids,
        imageDepart: trouve.clip.start,
        xDepart: x,
        yDepart: y,
        dx: 0,
        dy: 0,
        accroche: null,
      };
    },
    [actions, etat, modele, positionLocale, vueMesuree],
  );

  const surPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = positionLocale(e);
      const geste = gesteRef.current;

      if (geste.type === 'aucun') {
        // Le curseur annonce ce que fera le clic (§77).
        const impact = hitTest(modele, vueMesuree, x, y - HAUTEUR_REGLE);
        const surBord = impact.kind === 'clipEdgeIn' || impact.kind === 'clipEdgeOut';
        setCurseur(
          y < HAUTEUR_REGLE
            ? 'ew-resize'
            : etat.outil === 'razor'
              ? 'crosshair'
              : etat.outil === 'hand'
                ? 'grab'
                : surBord
                  ? 'col-resize'
                  : impact.kind === 'clip'
                    ? 'grab'
                    : 'default',
        );
        return;
      }

      switch (geste.type) {
        case 'scrub':
          actions.definirTete(Math.max(0, xToTime(vueMesuree, x)));
          return;
        case 'main':
          definirVue((v) => scrollBy(v, geste.xDepart - x));
          gesteRef.current = { ...geste, xDepart: x };
          return;
        case 'rectangle':
          gesteRef.current = { ...geste, x2: x, y2: y - HAUTEUR_REGLE };
          redessiner();
          return;
        case 'deplacement': {
          const brut = geste.imageDepart + (x - geste.xDepart) / vueMesuree.pixelsPerFrame;
          const trouve = findClip(etat.sequence, geste.clipId);
          const duree = trouve?.clip.duration ?? 0;
          const resultat = snapClipMove(
            Math.round(brut),
            duree,
            ciblesAccroche(geste.ids),
            vueMesuree,
            8,
            etat.accrochage,
          );
          const image = Math.max(0, resultat.frame);
          gesteRef.current = {
            ...geste,
            dx: (image - geste.imageDepart) * vueMesuree.pixelsPerFrame,
            dy: y - geste.yDepart,
            accroche: resultat.target === null ? null : resultat.target.frame,
          };
          redessiner();
          return;
        }
        case 'trim':
        case 'roll':
        case 'slip':
        case 'slide': {
          const delta = Math.round((x - geste.xDepart) / vueMesuree.pixelsPerFrame);
          gesteRef.current = { ...geste, delta };
          setCurseur('col-resize');
          return;
        }
        case 'etirement': {
          const delta = Math.round((x - geste.xDepart) / vueMesuree.pixelsPerFrame);
          gesteRef.current = { ...geste, duree: Math.max(1, geste.dureeDepart + delta) };
          return;
        }
        default:
          return;
      }
    },
    [actions, ciblesAccroche, definirVue, etat, modele, positionLocale, redessiner, vueMesuree],
  );

  const surPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const geste = gesteRef.current;
      const { x, y } = positionLocale(e);
      gesteRef.current = { type: 'aucun' };

      switch (geste.type) {
        case 'deplacement': {
          const image = geste.imageDepart + Math.round(geste.dx / vueMesuree.pixelsPerFrame);
          if (image !== geste.imageDepart) {
            // Une piste d arrivée différente serait un changement de piste : on
            // le déduit du calque survolé au relâchement.
            const pisteArrivee = modele.tracks.find(
              (t) => y - HAUTEUR_REGLE >= t.y && y - HAUTEUR_REGLE < t.y + t.height,
            );
            const trouve = findClip(etat.sequence, geste.clipId);
            const memeType =
              pisteArrivee !== undefined &&
              trouve !== undefined &&
              pisteArrivee.kind === trouve.track.kind;
            actions.executer(
              moveClipCommand(
                {
                  clipId: geste.clipId,
                  toStart: Math.max(0, image),
                  ...(memeType && pisteArrivee !== undefined
                    ? { toTrackId: pisteArrivee.trackId }
                    : {}),
                },
                etat.contexte,
              ),
            );
          }
          break;
        }
        case 'trim':
          if (geste.delta !== 0) {
            actions.executer(
              trimCommand(
                {
                  clipId: geste.clipId,
                  edge: geste.bord,
                  delta: geste.delta,
                  mode: etat.outil === 'ripple' ? 'ripple' : 'normal',
                },
                etat.contexte,
              ),
            );
          }
          break;
        case 'roll':
          if (geste.delta !== 0) {
            actions.executer(rollCommand(geste.trackId, geste.image, geste.delta, etat.contexte));
          }
          break;
        case 'slip':
          if (geste.delta !== 0)
            actions.executer(slipCommand(geste.clipId, geste.delta, etat.contexte));
          break;
        case 'slide':
          if (geste.delta !== 0)
            actions.executer(slideCommand(geste.clipId, geste.delta, etat.contexte));
          break;
        case 'etirement':
          if (geste.duree !== geste.dureeDepart) {
            actions.executer(rateStretchCommand(geste.clipId, geste.duree, etat.contexte));
          }
          break;
        case 'rectangle': {
          const ids = marqueeSelect(modele, geste.x1, geste.y1, x, y - HAUTEUR_REGLE);
          actions.definirSelection(ids);
          break;
        }
        default:
          break;
      }
      redessiner();
    },
    [actions, etat, modele, positionLocale, redessiner, vueMesuree],
  );

  // Molette : zoom autour du pointeur avec Ctrl ou Cmd, défilement sinon (§17).
  useEffect(() => {
    const toile = toileRef.current;
    if (toile === null) return undefined;
    const surMolette = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = toile.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (e.ctrlKey || e.metaKey) {
        definirVue((v) =>
          clampScroll(
            zoomAt(
              creerViewport(v.scroll, v.pixelsPerFrame, taille.largeur),
              x,
              Math.pow(1.0025, -e.deltaY),
            ),
            duree,
          ),
        );
      } else if (e.shiftKey) {
        definirVue((v) =>
          clampScroll(
            scrollBy(creerViewport(v.scroll, v.pixelsPerFrame, taille.largeur), e.deltaY),
            duree,
          ),
        );
      } else {
        definirVue((v) =>
          clampScroll(
            scrollBy(
              creerViewport(v.scroll, v.pixelsPerFrame, taille.largeur),
              e.deltaX || e.deltaY,
            ),
            duree,
          ),
        );
        definirDefilementVertical(
          Math.max(0, defilementVertical + (e.deltaX === 0 ? 0 : e.deltaY)),
        );
      }
    };
    toile.addEventListener('wheel', surMolette, { passive: false });
    return () => toile.removeEventListener('wheel', surMolette);
  }, [definirVue, definirDefilementVertical, defilementVertical, duree, taille.largeur]);

  // La tête de lecture reste visible quand on navigue au clavier.
  useEffect(() => {
    definirVue((v) =>
      scrollIntoView(creerViewport(v.scroll, v.pixelsPerFrame, taille.largeur), etat.tete, 60),
    );
  }, [etat.tete, definirVue, taille.largeur]);

  return (
    <div className="timeline-corps">
      <EntetesPistes
        modele={modele}
        defilement={defilementVertical}
        etat={etat}
        actions={actions}
      />
      {/* État du viewport exposé pour les tests de bout en bout : c'est la seule
          façon de vérifier le zoom et le défilement, qui vivent dans un canvas. */}
      <div
        className="timeline-toile"
        ref={conteneurRef}
        data-scroll={Math.round(vueMesuree.scroll)}
        data-echelle={vueMesuree.pixelsPerFrame.toFixed(4)}
        data-largeur={Math.round(vueMesuree.width)}
      >
        <canvas
          ref={toileRef}
          style={{ cursor: curseur }}
          onPointerDown={surPointerDown}
          onPointerMove={surPointerMove}
          onPointerUp={surPointerUp}
          onPointerCancel={surPointerUp}
        />
      </div>
    </div>
  );
}

function EntetesPistes({
  modele,
  etat,
  actions,
}: {
  modele: ReturnType<typeof buildRenderModel>;
  defilement: number;
  etat: EtatEditeur;
  actions: ActionsEditeur;
}): React.JSX.Element {
  const basculer = (
    trackId: string,
    flags: Parameters<typeof setTrackFlagsCommand>[1],
    libelle: string,
  ): void => {
    actions.executer(setTrackFlagsCommand(trackId, flags, libelle));
  };

  return (
    <div className="entetes-pistes">
      <div className="entete-regle" />
      {modele.tracks.map((piste) => (
        <div
          key={piste.trackId}
          className="entete-piste"
          style={{ top: piste.y + HAUTEUR_REGLE, height: piste.height }}
        >
          <span className="nom">{piste.name}</span>
          <button
            type="button"
            className={`bouton-piste ${piste.targeted ? 'cible' : ''}`}
            title="Cibler la piste"
            aria-pressed={piste.targeted}
            onClick={() =>
              basculer(
                piste.trackId,
                { targeted: !piste.targeted },
                piste.targeted ? 'Ne plus cibler la piste' : 'Cibler la piste',
              )
            }
          >
            <IconeCible />
          </button>
          <button
            type="button"
            className={`bouton-piste ${piste.locked ? 'on' : ''}`}
            title="Verrouiller la piste"
            aria-pressed={piste.locked}
            onClick={() =>
              basculer(
                piste.trackId,
                { locked: !piste.locked },
                piste.locked ? 'Déverrouiller la piste' : 'Verrouiller la piste',
              )
            }
          >
            <IconeVerrou />
          </button>
          <button
            type="button"
            className={`bouton-piste ${piste.syncLock ? 'on' : ''}`}
            title="Verrouillage de synchronisation"
            aria-pressed={piste.syncLock}
            onClick={() =>
              basculer(piste.trackId, { syncLock: !piste.syncLock }, 'Synchronisation de piste')
            }
          >
            <IconeSync />
          </button>
          {piste.kind === 'video' ? (
            <button
              type="button"
              className={`bouton-piste ${piste.enabled ? 'on' : ''}`}
              title="Afficher la piste"
              aria-pressed={piste.enabled}
              onClick={() =>
                basculer(
                  piste.trackId,
                  { enabled: !piste.enabled },
                  piste.enabled ? 'Masquer la piste' : 'Afficher la piste',
                )
              }
            >
              <IconeOeil />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`bouton-piste ${piste.muted ? 'on' : ''}`}
                title="Couper le son de la piste"
                aria-pressed={piste.muted}
                onClick={() =>
                  basculer(
                    piste.trackId,
                    { muted: !piste.muted },
                    piste.muted ? 'Réactiver le son' : 'Couper le son',
                  )
                }
              >
                <IconeMuet />
              </button>
              <button
                type="button"
                className={`bouton-piste ${piste.solo ? 'on' : ''}`}
                title="Solo"
                aria-pressed={piste.solo}
                onClick={() => basculer(piste.trackId, { solo: !piste.solo }, 'Solo de piste')}
              >
                <IconeSolo />
              </button>
            </>
          )}
        </div>
      ))}
      {etat.sequence.tracks.length === 0 && <div className="entete-piste">Aucune piste</div>}
    </div>
  );
}

export { fit as ajusterVue, snapFrame as accrocherImage };
