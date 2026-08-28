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
import { appError, isErr } from '@valideo/shared';
import type { AppError } from '@valideo/shared';
import { formatTimecode, parseTimecodeEntry, rational } from '@valideo/time-core';
import { ACTIONS, DEFAULT_KEYMAP, KeyResolver, ShuttleController } from '@valideo/keyboard';
import type { KeyContext } from '@valideo/keyboard';
import {
  addEditCommand,
  addMarkerCommand,
  addTrackCommand,
  changeSpeedCommand,
  copyClips,
  deleteClipsCommand,
  extractCommand,
  findClip,
  insertCommand,
  linkCommand,
  nextMarker,
  overwriteCommand,
  pasteCommand,
  previousMarker,
  removeTrackCommand,
  renameClipCommand,
  renameTrackCommand,
  replaceClipCommand,
  setClipEnabledCommand,
  setClipLabelCommand,
  setTrackFlagsCommand,
  rippleTrimToPlayheadCommand,
  unlinkCommand,
  liftCommand,
  nextEditPoint,
  previousEditPoint,
  sequenceDuration,
  setWorkAreaCommand,
  syncedTargets,
  workAreaRange,
} from '@valideo/timeline-model';
import type { ClipboardContent } from '@valideo/timeline-model';
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
import type { CibleMenu, DeposeMedia } from './timeline/Timeline.js';
import { MenuContextuel } from './panels/MenuContextuel.js';
import type { ElementMenu } from './panels/MenuContextuel.js';
import { timebaseDeSequence } from './timeline/draw.js';
import { useEditeur } from './store.js';
import type { Outil } from './store.js';
import { PanneauMedias } from './panels/PanneauMedias.js';
import { PanneauProjet } from './panels/PanneauProjet.js';
import { Moniteur } from './panels/Moniteur.js';
import { MoniteurProgramme } from './panels/MoniteurProgramme.js';
import { PanneauInfo } from './panels/PanneauInfo.js';
import { DialogueVitesse } from './panels/DialogueVitesse.js';
import { DialogueRenommage } from './panels/DialogueRenommage.js';
import { DialogueRaccourcis } from './panels/DialogueRaccourcis.js';
import type { ReglagesVitesse } from './panels/DialogueVitesse.js';
import { clipDepuisMedia, pisteDAccueil, typeDeMedia } from './media/placement.js';
import { usePersistance } from './persistance.js';
import { TransportAudio } from './playback/transport.js';

/**
 * Refus explicite d'une action de montage. §106 : dire ce qui s'est passe ET ce
 * que l'utilisateur peut faire -- jamais « une erreur est survenue ».
 */
function erreurMontage(message: string, action: string): AppError {
  return appError('EDIT_REJECTED', message, { action });
}

/** Palette d'étiquettes (§87). Fixe : ce sont des repères, pas de la décoration. */
const ETIQUETTES_MENU: readonly { readonly nom: string; readonly couleur: string }[] = [
  { nom: 'Violette', couleur: '#8f6fd0' },
  { nom: 'Fer', couleur: '#5c7aa8' },
  { nom: 'Caribéen', couleur: '#3f9ea0' },
  { nom: 'Forêt', couleur: '#5c9070' },
  { nom: 'Rose', couleur: '#c07090' },
  { nom: 'Mangue', couleur: '#c08f3f' },
];

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
  /** Lecture en boucle sur la plage marquée, ou sur toute la séquence. */
  const [boucle, definirBoucle] = useState(false);
  /**
   * Position à restaurer après une écoute autour du raccord. `null` hors
   * écoute : c'est ce qui distingue « la lecture s'est arrêtée » de « on n'a
   * jamais demandé d'écoute ».
   */
  const retourApresEcouteRef = useRef<number | null>(null);
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
  /**
   * Pistes sur lesquelles Lift et Extract operent : les pistes CIBLEES, et
   * elles seules. Contrairement a la navigation, il n'y a PAS de repli sur
   * toutes les pistes : retirer une plage partout parce que l'utilisateur a
   * oublie de cibler serait destructeur. On refuse et on le dit.
   */
  /**
   * Presse-papiers de montage. Volontairement HORS de l'historique : copier
   * n'est pas une modification du document, et une annulation ne doit pas
   * ressusciter un presse-papiers precedent. C'est aussi pourquoi il vit dans
   * une ref et non un etat -- rien a l'ecran n'en depend.
   */
  const pressePapiers = useRef<ClipboardContent | null>(null);

  /** Clip dont la boite « Vitesse et duree » est ouverte, s il y en a une. */
  const [clipVitesse, setClipVitesse] = useState<string | null>(null);

  /**
   * Le clip est relu dans la séquence COURANTE à chaque rendu, pas capturé à
   * l'ouverture : si une annulation le fait disparaître pendant que la boîte
   * est ouverte, elle se referme au lieu de rester sur un clip fantôme.
   */
  const clipSelectionneVitesse = useMemo(() => {
    if (clipVitesse === null) return null;
    return findClip(etat.sequence, clipVitesse)?.clip ?? null;
  }, [clipVitesse, etat.sequence]);

  const pistesAffectees = useMemo(
    () => etat.sequence.tracks.filter((t) => t.targeted && !t.locked).map((t) => t.id),
    [etat.sequence.tracks],
  );

  /** Pistes dont Extract retire la plage. La règle vit dans le moteur. */
  const pistesExtract = useMemo(() => syncedTargets(etat.sequence), [etat.sequence]);

  const pistesNavigables = useMemo(() => {
    const ciblees = etat.sequence.tracks.filter((t) => t.targeted).map((t) => t.id);
    return ciblees.length > 0 ? ciblees : etat.sequence.tracks.map((t) => t.id);
  }, [etat.sequence.tracks]);

  /**
   * Dépose d'un média sur la timeline.
   *
   * Trois gestes, trois opérations réelles : dépose simple = overwrite,
   * Ctrl = insert, Alt sur un clip = remplacement. Elles passent toutes par le
   * même calcul de durée que le bouton « Poser » et les raccourcis — un seul
   * endroit, `placement.ts`, pour qu'aucune des trois ne dérive d'une image.
   */
  const surDeposeMedia = useCallback(
    (depose: DeposeMedia) => {
      const asset = etat.document.media.find((m) => m.id === depose.mediaId);
      if (asset === undefined || depose.trackId === null) return;
      if (asset.status !== 'online') {
        actions.signalerErreur(
          appError('MEDIA_OFFLINE', `« ${asset.name} » est hors ligne.`, {
            action: 'Reliez-le à un fichier avant de le monter',
          }),
        );
        return;
      }
      const piste = etat.sequence.tracks.find((t) => t.id === depose.trackId);
      if (piste === undefined) return;
      if (piste.locked) {
        actions.signalerErreur(
          appError('TRACK_LOCKED', `La piste ${piste.name} est verrouillée.`, {
            action: 'Déverrouillez-la pour y déposer un média',
          }),
        );
        return;
      }
      // Une piste vidéo n'accueille pas un média sans image, et l'inverse non
      // plus : le dire vaut mieux que de poser un clip muet là où l'on
      // attendait du son.
      const type = typeDeMedia(asset);
      if (piste.kind !== type) {
        actions.signalerErreur(
          erreurMontage(
            `« ${asset.name} » est un média ${type === 'video' ? 'vidéo' : 'audio'}.`,
            `Déposez-le sur une piste ${type === 'video' ? 'vidéo' : 'audio'}`,
          ),
        );
        return;
      }

      if (depose.mode === 'replace' && depose.clipId !== null) {
        actions.executer(
          replaceClipCommand(
            { clipId: depose.clipId, mediaId: asset.id, name: asset.name, kind: type },
            etat.contexte,
          ),
        );
        return;
      }

      const clip = clipDepuisMedia(asset, etat.sequence, piste.id, depose.image);
      actions.executer(
        depose.mode === 'insert'
          ? insertCommand({ clip, trackId: piste.id, at: depose.image }, etat.contexte)
          : overwriteCommand({ clip, trackId: piste.id, at: depose.image }, etat.contexte),
      );
    },
    [actions, etat.contexte, etat.document.media, etat.sequence],
  );

  /** Menu contextuel ouvert, avec sa cible. `null` quand aucun n'est ouvert. */
  const [menu, setMenu] = useState<CibleMenu | null>(null);
  /** Menu de la barre supérieure ouvert, avec sa position. */
  const [menuBarre, setMenuBarre] = useState<{ nom: string; x: number; y: number } | null>(null);
  const [raccourcisOuverts, setRaccourcisOuverts] = useState(false);
  /** Ouvre le sélecteur de fichiers du panneau Médias. Fourni par ce panneau. */
  const ouvrirImportRef = useRef<(() => void) | null>(null);
  const enregistrerCommandeImport = useCallback((ouvrir: () => void) => {
    ouvrirImportRef.current = ouvrir;
  }, []);
  /** Élément en cours de renommage : clip ou piste. */
  const [renommage, setRenommage] = useState<
    { readonly type: 'clip' | 'piste'; readonly id: string; readonly nom: string } | null
  >(null);

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
        case 'marks.markIn':
          actions.executer(
            setWorkAreaCommand({ in: etat.tete, out: etat.sequence.workAreaOut }),
          );
          return true;
        case 'marks.markOut':
          // La sortie est EXCLUSIVE : marquer sur l'image courante doit inclure
          // cette image, comme dans tout NLE. D'où le +1.
          actions.executer(
            setWorkAreaCommand({ in: etat.sequence.workAreaIn, out: etat.tete + 1 }),
          );
          return true;
        case 'marks.clearIn':
          actions.executer(setWorkAreaCommand({ in: null, out: etat.sequence.workAreaOut }));
          return true;
        case 'marks.clearOut':
          actions.executer(setWorkAreaCommand({ in: etat.sequence.workAreaIn, out: null }));
          return true;
        case 'marks.goToIn':
          if (etat.sequence.workAreaIn !== null) actions.definirTete(etat.sequence.workAreaIn);
          return true;
        case 'marks.goToOut':
          // On se pose SUR la dernière image de la plage, pas après elle.
          if (etat.sequence.workAreaOut !== null) {
            actions.definirTete(Math.max(0, etat.sequence.workAreaOut - 1));
          }
          return true;
        case 'edit.lift':
        case 'edit.extract': {
          const plage = workAreaRange(etat.sequence);
          if (plage === null) {
            actions.signalerErreur(
              erreurMontage(
                'Aucune plage marquée.',
                'Posez un point d’entrée (I) et un point de sortie (O)',
              ),
            );
            return true;
          }
          if (pistesAffectees.length === 0) {
            actions.signalerErreur(
              erreurMontage(
                'Aucune piste ciblée.',
                'Ciblez au moins une piste avec le bouton de ciblage',
              ),
            );
            return true;
          }
          actions.executer(
            actionId === 'edit.lift'
              ? liftCommand({ ...plage, trackIds: pistesAffectees }, etat.contexte)
              : extractCommand({ ...plage, trackIds: pistesExtract }, etat.contexte),
          );
          return true;
        }
        case 'edit.selectAll':
          actions.definirSelection(
            etat.sequence.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.map((c) => c.id)),
          );
          return true;
        case 'edit.cut':
        case 'edit.copy': {
          if (etat.selection.size === 0) {
            actions.signalerErreur(
              erreurMontage('Rien à copier.', 'Sélectionnez au moins un clip'),
            );
            return true;
          }
          const copie = copyClips(etat.sequence, [...etat.selection]);
          if (isErr(copie)) {
            actions.signalerErreur(copie.error);
            return true;
          }
          pressePapiers.current = copie.value;
          if (actionId === 'edit.cut') {
            // Couper LAISSE le trou. C'est la convention de Premiere, et elle
            // est cohérente avec le reste de ce clavier : la variante qui
            // referme est Maj+Suppr, explicitement nommée « avec ripple ».
            // Refermer d'office ferait glisser tout le montage sous les pieds
            // de quelqu'un qui voulait seulement déplacer un plan ailleurs.
            const coupe = actions.executer(
              deleteClipsCommand([...etat.selection], etat.contexte, false),
            );
            if (coupe) actions.definirSelection([]);
          }
          return true;
        }
        case 'edit.paste':
        case 'edit.pasteInsert': {
          const contenu = pressePapiers.current;
          if (contenu === null) {
            actions.signalerErreur(
              erreurMontage('Le presse-papiers est vide.', 'Copiez d’abord un clip (Ctrl+C)'),
            );
            return true;
          }
          // Le collage atterrit sur les pistes CIBLÉES, jamais sur celles d'où
          // vient la copie : c'est ce qui permet de coller d'une séquence à
          // l'autre, ou de rebasculer une copie sur une autre piste.
          const cibleVideo =
            etat.sequence.tracks.find((t) => t.kind === 'video' && t.targeted && !t.locked) ?? null;
          const cibleAudio =
            etat.sequence.tracks.find((t) => t.kind === 'audio' && t.targeted && !t.locked) ?? null;
          if (cibleVideo === null && cibleAudio === null) {
            actions.signalerErreur(
              erreurMontage('Aucune piste ciblée.', 'Ciblez la piste où coller'),
            );
            return true;
          }
          actions.executer(
            pasteCommand(
              contenu,
              {
                at: etat.tete,
                videoTrackId: cibleVideo?.id ?? null,
                audioTrackId: cibleAudio?.id ?? null,
                insert: actionId === 'edit.pasteInsert',
              },
              etat.contexte,
            ),
          );
          return true;
        }
        case 'edit.speedDuration': {
          // Un seul clip : « vitesse et durée » demande une durée résultante,
          // qui n'a pas de sens commun à plusieurs clips de longueurs
          // différentes. On le dit plutôt que de traiter le premier venu.
          if (etat.selection.size !== 1) {
            actions.signalerErreur(
              erreurMontage(
                etat.selection.size === 0
                  ? 'Aucun clip sélectionné.'
                  : 'La vitesse se règle sur un seul clip à la fois.',
                'Sélectionnez un clip',
              ),
            );
            return true;
          }
          setClipVitesse([...etat.selection][0] ?? null);
          return true;
        }
        case 'marks.addMarker':
          actions.executer(addMarkerCommand({ time: etat.tete }));
          return true;
        case 'nav.nextMarker': {
          const m = nextMarker(etat.sequence, etat.tete);
          if (m !== null) actions.definirTete(m.time);
          else
            actions.signalerErreur(
              erreurMontage('Aucun marqueur après la tête de lecture.', 'Posez-en un avec M'),
            );
          return true;
        }
        case 'nav.previousMarker': {
          const m = previousMarker(etat.sequence, etat.tete);
          if (m !== null) actions.definirTete(m.time);
          else
            actions.signalerErreur(
              erreurMontage('Aucun marqueur avant la tête de lecture.', 'Posez-en un avec M'),
            );
          return true;
        }
        case 'edit.rippleTrimPrevious':
        case 'edit.rippleTrimNext':
          actions.executer(
            rippleTrimToPlayheadCommand(
              etat.tete,
              actionId === 'edit.rippleTrimPrevious' ? 'previous' : 'next',
              etat.contexte,
            ),
          );
          return true;
        case 'edit.linkToggle': {
          if (etat.selection.size < 1) {
            actions.signalerErreur(
              erreurMontage('Aucun clip sélectionné.', 'Sélectionnez les clips à lier'),
            );
            return true;
          }
          // Une sélection dont TOUT est déjà lié se délie ; sinon on lie. C'est
          // la bascule attendue, et elle ne peut pas surprendre : lier deux
          // clips déjà liés à d'autres groupes les réunit dans un seul.
          const ids = [...etat.selection];
          const dejaLies = ids.every((id) => findClip(etat.sequence, id)?.clip.linkGroup !== null);
          if (dejaLies) {
            actions.executer(unlinkCommand(ids));
            return true;
          }
          if (ids.length < 2) {
            actions.signalerErreur(
              erreurMontage(
                'Il faut au moins deux clips pour créer une liaison.',
                'Ajoutez un clip à la sélection',
              ),
            );
            return true;
          }
          actions.executer(linkCommand(ids));
          return true;
        }
        case 'edit.insert':
        case 'edit.overwrite': {
          // Ce qu'on pose est le média SÉLECTIONNÉ dans le panneau Médias.
          // C'est le rôle du moniteur source dans un NLE ; ici la sélection en
          // tient lieu, et l'absence de sélection est dite, pas ignorée.
          const asset = etat.document.media.find((m) => m.id === etat.mediaSelectionne);
          if (asset === undefined) {
            actions.signalerErreur(
              erreurMontage(
                'Aucun média sélectionné.',
                'Cliquez un média dans le panneau Médias',
              ),
            );
            return true;
          }
          if (asset.status !== 'online') {
            actions.signalerErreur(
              appError('MEDIA_OFFLINE', `« ${asset.name} » est hors ligne.`, {
                action: 'Reliez-le à un fichier avant de le monter',
              }),
            );
            return true;
          }
          const accueil = pisteDAccueil(etat.sequence, typeDeMedia(asset));
          if (isErr(accueil)) {
            actions.signalerErreur(accueil.error);
            return true;
          }
          const piste = accueil.value;
          const clip = clipDepuisMedia(asset, etat.sequence, piste.id, etat.tete);
          actions.executer(
            actionId === 'edit.insert'
              ? insertCommand({ clip, trackId: piste.id, at: etat.tete }, etat.contexte)
              : overwriteCommand({ clip, trackId: piste.id, at: etat.tete }, etat.contexte),
          );
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
        case 'file.import':
          ouvrirImportRef.current?.();
          return true;
        case 'track.toggleTargetV1':
        case 'track.toggleTargetA1': {
          const kind = actionId === 'track.toggleTargetV1' ? 'video' : 'audio';
          const piste = etat.sequence.tracks.find((t) => t.kind === kind && t.index === 0);
          if (piste === undefined) return true;
          actions.executer(
            setTrackFlagsCommand(piste.id, { targeted: !piste.targeted }, 'Cibler la piste'),
          );
          return true;
        }
        case 'timeline.toggleFullscreen':
          if (document.fullscreenElement === null) void document.documentElement.requestFullscreen();
          else void document.exitFullscreen();
          return true;
        case 'playback.loop':
          definirBoucle((v) => !v);
          return true;
        case 'playback.playAroundEdit': {
          // Convention NLE : on rejoue quelques secondes autour du raccord, puis
          // on rend la tête là où elle était. Sans ce retour, chaque écoute
          // déplacerait le point qu'on essaie justement de juger.
          const cadence = Math.max(1, Math.round(base.rate.n / base.rate.d));
          retourApresEcouteRef.current = etat.tete;
          actions.definirTete(Math.max(0, etat.tete - cadence * 2));
          shuttle.togglePlay();
          definirVitesse(shuttle.rate());
          return true;
        }
        // §1003 : ces actions ont une touche et un libellé, mais rien derrière.
        // Se taire laisserait croire à une frappe perdue ; on dit ce qui manque.
        case 'edit.nest':
        case 'edit.group':
        case 'tool.pen':
        case 'tool.zoom':
        case 'file.export':
        case 'file.saveAs':
        case 'file.commandPalette':
        case 'timeline.maximizePanel':
          actions.signalerErreur(
            appError('EDIT_REJECTED', `« ${libelleAction(actionId)} » n’est pas implémenté.`, {
              action: 'Cette commande fait partie du plan, pas encore du socle',
              detail: actionId,
            }),
          );
          return true;
        default:
          return false;
      }
    },
    [
      actions,
      ajuster,
      duree,
      etat,
      persistance,
      base.rate.d,
      base.rate.n,
      pistesAffectees,
      pistesExtract,
      pistesNavigables,
      shuttle,
      zoomer,
    ],
  );


  /**
   * Contenu du menu contextuel.
   *
   * Trois menus selon la cible — clip, espace vide, en-tête de piste — et un
   * seul principe : ce qui n'est pas applicable est GRISÉ avec sa raison, pas
   * masqué. Une entrée qui disparaît d'un clic à l'autre déplace toutes les
   * autres, et on finit par cliquer à côté.
   */
  const elementsMenu = useMemo<readonly ElementMenu[]>(() => {
    if (menu === null) return [];
    const sel = [...etat.selection];
    const clip = menu.clipId === null ? null : (findClip(etat.sequence, menu.clipId)?.clip ?? null);
    const piste =
      menu.trackId === null ? null : (etat.sequence.tracks.find((t) => t.id === menu.trackId) ?? null);
    const acte = (id: string): void => {
      executerAction(id);
    };

    // ---- En-tête de piste
    if (menu.source === 'entete' && piste !== null) {
      const basculer = (flags: Parameters<typeof setTrackFlagsCommand>[1], libelle: string) => () =>
        actions.executer(setTrackFlagsCommand(piste.id, flags, libelle));
      return [
        {
          id: 'piste-renommer',
          libelle: 'Renommer la piste…',
          onChoisir: () => setRenommage({ type: 'piste', id: piste.id, nom: piste.name }),
        },
        { separateur: true, id: 's1' },
        {
          id: 'piste-cibler',
          libelle: 'Cibler la piste',
          cochee: piste.targeted,
          onChoisir: basculer({ targeted: !piste.targeted }, 'Cibler la piste'),
        },
        {
          id: 'piste-verrou',
          libelle: 'Verrouiller la piste',
          cochee: piste.locked,
          onChoisir: basculer({ locked: !piste.locked }, 'Verrouiller la piste'),
        },
        {
          id: 'piste-sync',
          libelle: 'Verrouillage de synchronisation',
          cochee: piste.syncLock,
          onChoisir: basculer({ syncLock: !piste.syncLock }, 'Synchronisation de piste'),
        },
        piste.kind === 'video'
          ? {
              id: 'piste-visible',
              libelle: 'Afficher la piste',
              cochee: piste.enabled,
              onChoisir: basculer({ enabled: !piste.enabled }, 'Afficher la piste'),
            }
          : {
              id: 'piste-muet',
              libelle: 'Muet',
              cochee: piste.muted,
              onChoisir: basculer({ muted: !piste.muted }, 'Muet'),
            },
        { separateur: true, id: 's2' },
        {
          id: 'piste-hauteur',
          libelle: 'Hauteur de piste',
          sousMenu: [
            { id: 'hauteur-petite', libelle: 'Petite', onChoisir: basculer({ height: 34 }, 'Hauteur de piste') },
            { id: 'hauteur-moyenne', libelle: 'Moyenne', onChoisir: basculer({ height: 60 }, 'Hauteur de piste') },
            { id: 'hauteur-grande', libelle: 'Grande', onChoisir: basculer({ height: 110 }, 'Hauteur de piste') },
          ],
        },
        { separateur: true, id: 's3' },
        {
          id: 'piste-ajouter-dessous',
          libelle: `Ajouter une piste ${piste.kind === 'video' ? 'vidéo' : 'audio'} en dessous`,
          onChoisir: () => actions.executer(addTrackCommand(piste.kind, piste.index)),
        },
        {
          id: 'piste-ajouter-dessus',
          libelle: `Ajouter une piste ${piste.kind === 'video' ? 'vidéo' : 'audio'} au-dessus`,
          onChoisir: () => actions.executer(addTrackCommand(piste.kind, piste.index + 1)),
        },
        {
          id: 'piste-supprimer',
          libelle: 'Supprimer la piste',
          desactivee: etat.sequence.tracks.filter((t) => t.kind === piste.kind).length <= 1,
          raison: 'C’est la dernière piste de ce type.',
          onChoisir: () => actions.executer(removeTrackCommand(piste.id)),
        },
      ];
    }

    // ---- Clip
    if (menu.source === 'clip' && clip !== null) {
      const lie = clip.linkGroup !== null;
      return [
        { id: 'clip-couper', libelle: 'Couper', raccourci: 'Ctrl+X', onChoisir: () => acte('edit.cut') },
        { id: 'clip-copier', libelle: 'Copier', raccourci: 'Ctrl+C', onChoisir: () => acte('edit.copy') },
        {
          id: 'clip-coller',
          libelle: 'Coller',
          raccourci: 'Ctrl+V',
          desactivee: pressePapiers.current === null,
          raison: 'Le presse-papiers est vide.',
          onChoisir: () => acte('edit.paste'),
        },
        { separateur: true, id: 'c1' },
        { id: 'clip-effacer', libelle: 'Effacer', raccourci: 'Suppr', onChoisir: () => acte('edit.delete') },
        {
          id: 'clip-effacer-ripple',
          libelle: 'Supprimer et raccorder',
          raccourci: 'Maj+Suppr',
          onChoisir: () => acte('edit.rippleDelete'),
        },
        { separateur: true, id: 'c2' },
        {
          id: 'clip-vitesse',
          libelle: 'Vitesse et durée…',
          raccourci: 'Ctrl+R',
          desactivee: etat.selection.size !== 1,
          raison: 'La vitesse se règle sur un seul clip à la fois.',
          onChoisir: () => acte('edit.speedDuration'),
        },
        {
          id: 'clip-raccord',
          libelle: 'Ajouter un raccord',
          raccourci: 'Ctrl+K',
          onChoisir: () => acte('edit.addEdit'),
        },
        {
          id: 'clip-lier',
          libelle: lie ? 'Délier' : 'Lier',
          raccourci: 'Ctrl+Maj+L',
          desactivee: !lie && etat.selection.size < 2,
          raison: 'Il faut au moins deux clips pour créer une liaison.',
          onChoisir: () => acte('edit.linkToggle'),
        },
        {
          id: 'clip-actif',
          libelle: 'Activer le clip',
          cochee: clip.enabled,
          onChoisir: () => actions.executer(setClipEnabledCommand(sel, !clip.enabled)),
        },
        { separateur: true, id: 'c3' },
        {
          id: 'clip-renommer',
          libelle: 'Renommer…',
          desactivee: etat.selection.size !== 1,
          raison: 'Sélectionnez un seul clip pour le renommer.',
          onChoisir: () => setRenommage({ type: 'clip', id: clip.id, nom: clip.name }),
        },
        {
          id: 'clip-etiquette',
          libelle: 'Étiquette',
          sousMenu: [
            ...ETIQUETTES_MENU.map((e) => ({
              id: `etiquette-${e.couleur.slice(1)}`,
              libelle: e.nom,
              cochee: clip.label === e.couleur,
              onChoisir: () => actions.executer(setClipLabelCommand(sel, e.couleur)),
            })),
            { separateur: true as const, id: 'e-sep' },
            {
              id: 'etiquette-aucune',
              libelle: 'Aucune',
              cochee: clip.label === null,
              onChoisir: () => actions.executer(setClipLabelCommand(sel, null)),
            },
          ],
        },
        {
          id: 'clip-remplacer',
          libelle: 'Remplacer par le média sélectionné',
          desactivee: etat.mediaSelectionne === null,
          raison: 'Aucun média sélectionné dans le panneau Médias.',
          onChoisir: () => {
            const asset = etat.document.media.find((m) => m.id === etat.mediaSelectionne);
            if (asset === undefined) return;
            actions.executer(
              replaceClipCommand(
                { clipId: clip.id, mediaId: asset.id, name: asset.name, kind: typeDeMedia(asset) },
                etat.contexte,
              ),
            );
          },
        },
      ];
    }

    // ---- Espace vide ou règle
    return [
      {
        id: 'vide-coller',
        libelle: 'Coller',
        raccourci: 'Ctrl+V',
        desactivee: pressePapiers.current === null,
        raison: 'Le presse-papiers est vide.',
        onChoisir: () => acte('edit.paste'),
      },
      {
        id: 'vide-coller-inserer',
        libelle: 'Coller par insertion',
        raccourci: 'Ctrl+Maj+V',
        desactivee: pressePapiers.current === null,
        raison: 'Le presse-papiers est vide.',
        onChoisir: () => acte('edit.pasteInsert'),
      },
      { separateur: true, id: 'v1' },
      { id: 'vide-entree', libelle: 'Marquer l’entrée', raccourci: 'I', onChoisir: () => acte('marks.markIn') },
      { id: 'vide-sortie', libelle: 'Marquer la sortie', raccourci: 'O', onChoisir: () => acte('marks.markOut') },
      {
        id: 'vide-lift',
        libelle: 'Lift',
        raccourci: ';',
        desactivee: workAreaRange(etat.sequence) === null,
        raison: 'Aucune plage marquée.',
        onChoisir: () => acte('edit.lift'),
      },
      {
        id: 'vide-extract',
        libelle: 'Extract',
        raccourci: '’',
        desactivee: workAreaRange(etat.sequence) === null,
        raison: 'Aucune plage marquée.',
        onChoisir: () => acte('edit.extract'),
      },
      { separateur: true, id: 'v2' },
      { id: 'vide-marqueur', libelle: 'Ajouter un marqueur', raccourci: 'M', onChoisir: () => acte('marks.addMarker') },
      { separateur: true, id: 'v3' },
      {
        id: 'vide-piste-video',
        libelle: 'Ajouter une piste vidéo',
        onChoisir: () => actions.executer(addTrackCommand('video')),
      },
      {
        id: 'vide-piste-audio',
        libelle: 'Ajouter une piste audio',
        onChoisir: () => actions.executer(addTrackCommand('audio')),
      },
      { separateur: true, id: 'v4' },
      { id: 'vide-ajuster', libelle: 'Ajuster la séquence', raccourci: '\\', onChoisir: () => acte('timeline.zoomToFit') },
    ];
  }, [actions, etat, executerAction, menu]);


  /**
   * Menus de la barre supérieure.
   *
   * Ils étaient jusqu'ici de simples étiquettes inertes — exactement ce que
   * §1003 interdit. Chaque entrée déclenche désormais l'action réelle, ou est
   * grisée avec la raison. Les menus qui n'auraient rien à proposer
   * (« Graphiques », « Fenêtre ») ont été retirés plutôt que laissés vides.
   */
  const MENUS_BARRE = useMemo<
    readonly { readonly nom: string; readonly elements: readonly ElementMenu[] }[]
  >(() => {
    const acte = (id: string) => () => {
      executerAction(id);
    };
    const rienACopier = etat.selection.size === 0;
    const pressePapiersVide = pressePapiers.current === null;
    const clipUnique = etat.selection.size === 1;
    const clipCourant = clipUnique ? (findClip(etat.sequence, [...etat.selection][0] ?? '')?.clip ?? null) : null;

    return [
      {
        nom: 'Fichier',
        elements: [
          { id: 'bm-importer', libelle: 'Importer des médias…', raccourci: 'Ctrl+I', onChoisir: acte('file.import') },
          { separateur: true, id: 'bf1' },
          { id: 'bm-enregistrer', libelle: 'Enregistrer', raccourci: 'Ctrl+S', onChoisir: acte('file.save') },
          {
            id: 'bm-exporter',
            libelle: 'Exporter…',
            desactivee: true,
            raison: 'L’export n’est pas implémenté : il demande un encodeur, qui n’existe pas encore dans ce socle.',
          },
        ],
      },
      {
        nom: 'Édition',
        elements: [
          {
            id: 'bm-annuler',
            libelle: 'Annuler',
            raccourci: 'Ctrl+Z',
            desactivee: !etat.historique.canUndo,
            raison: 'Rien à annuler.',
            onChoisir: acte('edit.undo'),
          },
          {
            id: 'bm-retablir',
            libelle: 'Rétablir',
            raccourci: 'Ctrl+Maj+Z',
            desactivee: !etat.historique.canRedo,
            raison: 'Rien à rétablir.',
            onChoisir: acte('edit.redo'),
          },
          { separateur: true, id: 'be1' },
          { id: 'bm-couper', libelle: 'Couper', raccourci: 'Ctrl+X', desactivee: rienACopier, raison: 'Aucun clip sélectionné.', onChoisir: acte('edit.cut') },
          { id: 'bm-copier', libelle: 'Copier', raccourci: 'Ctrl+C', desactivee: rienACopier, raison: 'Aucun clip sélectionné.', onChoisir: acte('edit.copy') },
          { id: 'bm-coller', libelle: 'Coller', raccourci: 'Ctrl+V', desactivee: pressePapiersVide, raison: 'Le presse-papiers est vide.', onChoisir: acte('edit.paste') },
          { id: 'bm-coller-inserer', libelle: 'Coller par insertion', raccourci: 'Ctrl+Maj+V', desactivee: pressePapiersVide, raison: 'Le presse-papiers est vide.', onChoisir: acte('edit.pasteInsert') },
          { separateur: true, id: 'be2' },
          { id: 'bm-tout', libelle: 'Tout sélectionner', raccourci: 'Ctrl+A', onChoisir: acte('edit.selectAll') },
          { id: 'bm-effacer', libelle: 'Effacer', raccourci: 'Suppr', desactivee: rienACopier, raison: 'Aucun clip sélectionné.', onChoisir: acte('edit.delete') },
          { id: 'bm-effacer-ripple', libelle: 'Supprimer et raccorder', raccourci: 'Maj+Suppr', desactivee: rienACopier, raison: 'Aucun clip sélectionné.', onChoisir: acte('edit.rippleDelete') },
        ],
      },
      {
        nom: 'Clip',
        elements: [
          { id: 'bm-vitesse', libelle: 'Vitesse et durée…', raccourci: 'Ctrl+R', desactivee: !clipUnique, raison: 'Sélectionnez un seul clip.', onChoisir: acte('edit.speedDuration') },
          { id: 'bm-raccord', libelle: 'Ajouter un raccord', raccourci: 'Ctrl+K', onChoisir: acte('edit.addEdit') },
          { id: 'bm-lier', libelle: 'Lier / Délier', raccourci: 'Ctrl+Maj+L', desactivee: rienACopier, raison: 'Aucun clip sélectionné.', onChoisir: acte('edit.linkToggle') },
          {
            id: 'bm-actif',
            libelle: 'Activer le clip',
            cochee: clipCourant?.enabled === true,
            desactivee: rienACopier,
            raison: 'Aucun clip sélectionné.',
            onChoisir: () =>
              actions.executer(setClipEnabledCommand([...etat.selection], clipCourant?.enabled !== true)),
          },
          {
            id: 'bm-renommer',
            libelle: 'Renommer…',
            desactivee: clipCourant === null,
            raison: 'Sélectionnez un seul clip.',
            onChoisir: () => {
              if (clipCourant !== null) {
                setRenommage({ type: 'clip', id: clipCourant.id, nom: clipCourant.name });
              }
            },
          },
        ],
      },
      {
        nom: 'Séquence',
        elements: [
          { id: 'bm-piste-video', libelle: 'Ajouter une piste vidéo', onChoisir: () => actions.executer(addTrackCommand('video')) },
          { id: 'bm-piste-audio', libelle: 'Ajouter une piste audio', onChoisir: () => actions.executer(addTrackCommand('audio')) },
          { separateur: true, id: 'bs1' },
          { id: 'bm-entree', libelle: 'Marquer l’entrée', raccourci: 'I', onChoisir: acte('marks.markIn') },
          { id: 'bm-sortie', libelle: 'Marquer la sortie', raccourci: 'O', onChoisir: acte('marks.markOut') },
          {
            id: 'bm-lift',
            libelle: 'Lift',
            raccourci: ';',
            desactivee: workAreaRange(etat.sequence) === null,
            raison: 'Aucune plage marquée.',
            onChoisir: acte('edit.lift'),
          },
          {
            id: 'bm-extract',
            libelle: 'Extract',
            raccourci: '’',
            desactivee: workAreaRange(etat.sequence) === null,
            raison: 'Aucune plage marquée.',
            onChoisir: acte('edit.extract'),
          },
          { separateur: true, id: 'bs2' },
          { id: 'bm-ajuster', libelle: 'Ajuster la séquence', onChoisir: acte('timeline.zoomToFit') },
        ],
      },
      {
        nom: 'Marqueur',
        elements: [
          { id: 'bm-marqueur', libelle: 'Ajouter un marqueur', raccourci: 'M', onChoisir: acte('marks.addMarker') },
          { id: 'bm-marqueur-suivant', libelle: 'Marqueur suivant', raccourci: 'Maj+M', onChoisir: acte('nav.nextMarker') },
          { id: 'bm-marqueur-precedent', libelle: 'Marqueur précédent', raccourci: 'Ctrl+Maj+M', onChoisir: acte('nav.previousMarker') },
        ],
      },
      {
        nom: 'Aide',
        elements: [
          {
            id: 'bm-raccourcis',
            libelle: 'Raccourcis clavier…',
            onChoisir: () => setRaccourcisOuverts(true),
          },
        ],
      },
    ];
  }, [actions, etat, executerAction]);

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

    // Bornes de la lecture. Trois cas, dans cet ordre de priorité :
    //   1. écoute autour du raccord : on s'arrête après le point visé ;
    //   2. lecture en boucle sur la plage marquée, si elle existe ;
    //   3. sinon, toute la séquence.
    const cadence = Math.max(1, Math.round(base.rate.n / base.rate.d));
    const retour = retourApresEcouteRef.current;
    const plage = workAreaRange(etat.sequence);
    const debutLecture = retour !== null ? etat.tete : (boucle && plage !== null ? plage.start : 0);
    const finLecture =
      retour !== null
        ? Math.min(duree, retour + cadence * 2)
        : boucle && plage !== null
          ? plage.end
          : duree;

    if (vitesse === 1) {
      void transport.demarrer(etat.sequence, etat.tete, duree).then(() => {
        definirClipsMuets(transport.etat().ignores.map((i) => `${i.raison}`));
      });
      const suivre = (): void => {
        const position = Math.round(transport.position());
        if (position >= finLecture) {
          if (retour !== null) {
            // Fin de l'écoute : la tête revient EXACTEMENT là où elle était.
            transport.arreter();
            retourApresEcouteRef.current = null;
            actions.definirTete(retour);
            shuttle.stop();
            definirVitesse(0);
            return;
          }
          if (boucle) {
            transport.arreter();
            actions.definirTete(debutLecture);
            void transport.demarrer(etat.sequence, debutLecture, duree);
            id = requestAnimationFrame(suivre);
            return;
          }
        }
        actions.definirTete(Math.min(duree, position));
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
      // Le va-et-vient rapide reboucle aussi sur la plage marquée : sans cela,
      // activer la boucle puis accélérer la ferait silencieusement disparaître.
      if (boucle && plage !== null && vitesse > 0 && image >= finLecture) {
        brut = debutLecture;
        actions.definirTete(debutLecture);
        id = requestAnimationFrame(pas);
        return;
      }
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
        {MENUS_BARRE.map((m) => (
          <button
            type="button"
            className={`menu ${menuBarre?.nom === m.nom ? 'ouvert' : ''}`}
            key={m.nom}
            data-test={`barre-${m.nom.toLowerCase()}`}
            aria-haspopup="menu"
            aria-expanded={menuBarre?.nom === m.nom}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuBarre((c) =>
                c?.nom === m.nom ? null : { nom: m.nom, x: r.left, y: r.bottom },
              );
            }}
          >
            {m.nom}
          </button>
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
            <PanneauMedias
              etat={etat}
              actions={actions}
              timecode={timecode}
              surCommandeImport={enregistrerCommandeImport}
            />
            <div className="panneau-entete" style={{ marginTop: 8 }}>
              <span className="titre">Clips de la séquence</span>
            </div>
            <PanneauProjet
              sequence={etat.sequence}
              selection={etat.selection}
              timecode={timecode}
            />
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
            <button
              type="button"
              className={boucle ? 'actif' : ''}
              onClick={() => executerAction('playback.loop')}
              title="Lecture en boucle sur la plage marquée (Ctrl+L)"
              aria-pressed={boucle}
              data-test="boucle"
            >
              ⟳
            </button>
            <span className="espace" style={{ flex: 1 }} />
            {boucle && (
              <span className="mono" data-test="etat-boucle">
                {workAreaRange(etat.sequence) === null ? 'boucle · séquence' : 'boucle · plage'}
              </span>
            )}
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
            surDeposeMedia={surDeposeMedia}
            surMenuContextuel={setMenu}
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

      {menuBarre !== null && (
        <MenuContextuel
          position={{ x: menuBarre.x, y: menuBarre.y }}
          elements={MENUS_BARRE.find((m) => m.nom === menuBarre.nom)?.elements ?? []}
          onFermer={() => setMenuBarre(null)}
        />
      )}

      {raccourcisOuverts && (
        <DialogueRaccourcis clavier={DEFAULT_KEYMAP} onFermer={() => setRaccourcisOuverts(false)} />
      )}

      {menu !== null && (
        <MenuContextuel
          position={{ x: menu.x, y: menu.y }}
          elements={elementsMenu}
          onFermer={() => setMenu(null)}
        />
      )}

      {renommage !== null && (
        <DialogueRenommage
          initial={renommage.nom}
          titre={renommage.type === 'clip' ? 'Renommer le clip' : 'Renommer la piste'}
          onFermer={() => setRenommage(null)}
          onValider={(nom) => {
            actions.executer(
              renommage.type === 'clip'
                ? renameClipCommand(renommage.id, nom)
                : renameTrackCommand(renommage.id, nom),
            );
            setRenommage(null);
          }}
        />
      )}

      {clipSelectionneVitesse !== null && (
        <DialogueVitesse
          clip={clipSelectionneVitesse}
          contexte={etat.contexte}
          onFermer={() => setClipVitesse(null)}
          onAppliquer={(reglages: ReglagesVitesse) => {
            actions.executer(
              changeSpeedCommand(
                { clipId: clipSelectionneVitesse.id, ...reglages },
                etat.contexte,
              ),
            );
            setClipVitesse(null);
          }}
        />
      )}
    </div>
  );
}

/** Libellé lisible d'une action, pour les messages d'indisponibilité. */
function libelleAction(id: string): string {
  return ACTIONS.find((a) => a.id === id)?.label ?? id;
}
