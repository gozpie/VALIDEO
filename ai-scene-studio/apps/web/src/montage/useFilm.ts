/**
 * Le film côté navigateur : ouverture du montage enregistré, récupération des médias, mise à jour
 * depuis les plans du studio, enregistrement automatique sur le serveur.
 */
import { CSRF_HEADER, type UploadedAsset } from '@ass/api-client';
import { command } from '@valideo/command-system';
import { deserializeProject } from '@valideo/project-model';
import type { MediaAssetDoc, ProjectDoc, SequenceDoc } from '@valideo/project-model';
import { appError, ok } from '@valideo/shared';
import type { AppError } from '@valideo/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, call, errorMessage } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { toast } from '@/lib/toast';
import {
  LIENS_VIDES,
  lireLiens,
  mediasManquants,
  oublierPlan,
  synchroniserFilm,
  type LiensFilm,
  type MediaRecu,
  type PlanDuFilm,
} from './film';
import { extensionDe, importerFichier } from './media/import';
import type { MediaImporte } from './media/import';
import type { ActionsEditeur, EtatEditeur } from './store';

export type EtatFilm = 'propre' | 'modifie' | 'enregistrement' | 'erreur' | 'conflit';

export interface Film {
  readonly pret: boolean;
  readonly etat: EtatFilm;
  readonly erreur: AppError | null;
  readonly plans: readonly PlanDuFilm[];
  readonly liens: LiensFilm;
  /** Fichiers en cours de récupération. `null` quand plus rien n'est attendu. */
  readonly progression: { readonly fait: number; readonly total: number } | null;
  enregistrer(): void;
  /** Remet dans le film, à sa place, un plan que le monteur en avait retiré. */
  remettrePlan(shotId: string): void;
  /** Conserve sur le serveur un média importé à la main : il suivra le projet. */
  conserverMedia(asset: MediaAssetDoc, fichier: File): void;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Types qu'un navigateur laisse parfois vides : on les déduit de l'extension à l'envoi. */
const TYPES_PAR_EXTENSION: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Les fichiers ne changent jamais (adressés par empreinte) : une seule récupération par session. */
const fichiers = new Map<string, Promise<Blob>>();

function telecharger(assetId: string): Promise<Blob> {
  const connu = fichiers.get(assetId);
  if (connu !== undefined) return connu;
  const requete = fetch(`${API_URL}/assets/${assetId}/content`, { credentials: 'include' }).then(
    (reponse) => {
      if (!reponse.ok) throw new Error(`Fichier indisponible (${reponse.status})`);
      return reponse.blob();
    },
  );
  fichiers.set(assetId, requete);
  requete.catch(() => fichiers.delete(assetId));
  return requete;
}

async function ouvrirMedia(
  assetId: string,
  mimeType: string,
  nom: string,
  cadence: { n: number; d: number },
): Promise<MediaImporte> {
  const contenu = await telecharger(assetId);
  const extension = EXTENSIONS[mimeType];
  const fichier = new File([contenu], extension ? `${nom}.${extension}` : nom, { type: mimeType });
  return importerFichier(fichier, { cadenceParDefaut: cadence });
}

/** Exécute `travail` sur chaque élément, jamais plus de `largeur` à la fois. */
async function enParallele<T>(
  elements: readonly T[],
  largeur: number,
  travail: (element: T) => Promise<void>,
): Promise<void> {
  const file = [...elements];
  await Promise.all(
    Array.from({ length: Math.min(largeur, file.length) }, async () => {
      for (let suivant = file.shift(); suivant !== undefined; suivant = file.shift()) {
        await travail(suivant);
      }
    }),
  );
}

export function useFilm(options: {
  readonly projectId: string;
  readonly etat: EtatEditeur;
  readonly actions: ActionsEditeur;
  readonly canEdit: boolean;
  /** Le monteur regarde l'écran Montage : c'est le moment de le mettre à jour. */
  readonly actif: boolean;
  /** Change quand les plans du studio changent. */
  readonly versionPlans: unknown;
}): Film {
  const { projectId, etat, actions, canEdit, actif, versionPlans } = options;
  const [pret, definirPret] = useState(false);
  const [etatFilm, definirEtatFilm] = useState<EtatFilm>('propre');
  const [erreur, definirErreur] = useState<AppError | null>(null);
  const [plans, definirPlans] = useState<readonly PlanDuFilm[]>([]);
  const [liens, definirLiens] = useState<LiensFilm>(LIENS_VIDES);
  const [progression, definirProgression] = useState<Film['progression']>(null);

  const liensRef = useRef<LiensFilm>(LIENS_VIDES);
  const revisionRef = useRef(0);
  const conflitRef = useRef(false);
  const documentRef = useRef<ProjectDoc>(etat.document);
  documentRef.current = etat.document;
  const mediasRef = useRef<readonly MediaAssetDoc[]>(etat.document.media);
  mediasRef.current = etat.document.media;
  const cadence = etat.sequence.timebase.rate;
  const cadenceRef = useRef(cadence);
  cadenceRef.current = cadence;

  const changerLiens = useCallback((suivants: LiensFilm) => {
    liensRef.current = suivants;
    definirLiens(suivants);
  }, []);

  // --- Enregistrement ----------------------------------------------------------------------------

  const enCoursRef = useRef(false);
  const aRefaireRef = useRef(false);
  const dernierEnvoiRef = useRef<{ document: ProjectDoc; liens: LiensFilm } | null>(null);

  const sauver = useCallback(async (): Promise<void> => {
    if (!canEdit || conflitRef.current) return;
    if (enCoursRef.current) {
      aRefaireRef.current = true;
      return;
    }
    const document = documentRef.current;
    const liensEnvoyes = liensRef.current;
    enCoursRef.current = true;
    definirEtatFilm('enregistrement');
    const { response, error, data } = await api
      .PUT('/projects/{project_id}/edit', {
        params: { path: { project_id: projectId } },
        body: {
          document: { ...document, modifiedAt: new Date().toISOString() } as never,
          links: liensEnvoyes as never,
          expectedRevision: revisionRef.current,
        },
      })
      .catch((cause: unknown) => ({
        response: null,
        error: cause,
        data: undefined,
      }));
    enCoursRef.current = false;
    if (response?.status === 409) {
      conflitRef.current = true;
      definirEtatFilm('conflit');
      definirErreur(
        appError('STORAGE_UNAVAILABLE', 'Ce montage a été modifié dans un autre onglet.', {
          action: 'Rechargez la page pour reprendre la dernière version',
        }),
      );
      return;
    }
    if (error !== undefined || data === undefined) {
      definirEtatFilm('erreur');
      definirErreur(
        appError('STORAGE_UNAVAILABLE', 'Le montage n’a pas pu être enregistré.', {
          action:
            'Vérifiez la connexion ; l’enregistrement sera retenté à la prochaine modification',
          detail: errorMessage(error),
        }),
      );
      return;
    }
    revisionRef.current = data.revision;
    dernierEnvoiRef.current = { document, liens: liensEnvoyes };
    definirErreur(null);
    if (aRefaireRef.current) {
      aRefaireRef.current = false;
      void sauver();
      return;
    }
    if (documentRef.current === document && liensRef.current === liensEnvoyes) {
      actions.enregistrer();
      definirEtatFilm('propre');
    }
  }, [actions, canEdit, projectId]);

  const sauverRef = useRef(sauver);
  sauverRef.current = sauver;

  // Enregistrement automatique : chaque modification replanifie une écriture.
  useEffect(() => {
    if (!pret || !canEdit || conflitRef.current) return undefined;
    const envoi = dernierEnvoiRef.current;
    if (envoi?.document === etat.document && envoi.liens === liens) return undefined;
    definirEtatFilm('modifie');
    const minuteur = setTimeout(() => void sauverRef.current(), 1200);
    return () => clearTimeout(minuteur);
  }, [canEdit, etat.document, liens, pret]);

  // Dernière chance à la fermeture de l'onglet, pour le travail des dernières secondes.
  useEffect(() => {
    if (!canEdit) return undefined;
    const surFermeture = (): void => {
      const envoi = dernierEnvoiRef.current;
      if (conflitRef.current) return;
      if (envoi?.document === documentRef.current && envoi.liens === liensRef.current) return;
      void fetch(`${API_URL}/projects/${projectId}/edit`, {
        method: 'PUT',
        keepalive: true,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(api.csrfToken ? { [CSRF_HEADER]: api.csrfToken } : {}),
        },
        body: JSON.stringify({
          document: documentRef.current,
          links: liensRef.current,
          expectedRevision: revisionRef.current,
        }),
      });
    };
    window.addEventListener('pagehide', surFermeture);
    return () => window.removeEventListener('pagehide', surFermeture);
  }, [canEdit, projectId]);

  // --- Synchronisation avec le studio ------------------------------------------------------------

  const synchroEnCoursRef = useRef(false);
  const synchroARefaireRef = useRef(false);

  const synchroniser = useCallback(async (): Promise<void> => {
    if (synchroEnCoursRef.current) {
      synchroARefaireRef.current = true;
      return;
    }
    synchroEnCoursRef.current = true;
    try {
      const liste = await call(
        api.GET('/projects/{project_id}/edit-list', {
          params: { path: { project_id: projectId } },
        }),
      );
      const items = liste.items as readonly PlanDuFilm[];
      definirPlans(items);
      const premiereFois = Object.keys(liensRef.current.shots).length === 0;
      const besoins = mediasManquants(items, liensRef.current);
      const recus: (MediaRecu & { readonly importe: MediaImporte })[] = [];
      if (besoins.length > 0) {
        let fait = 0;
        definirProgression({ fait, total: besoins.length });
        await enParallele(besoins, 3, async (besoin) => {
          try {
            const importe = await ouvrirMedia(
              besoin.assetId,
              besoin.mimeType,
              besoin.nom,
              cadenceRef.current,
            );
            if (importe.asset.status === 'online') {
              recus.push({
                ...besoin,
                asset: {
                  ...importe.asset,
                  name: besoin.nom,
                  uri: `chagomi-asset:${besoin.assetId}`,
                  originalUri: `chagomi-asset:${besoin.assetId}`,
                },
                importe,
              });
            }
          } catch {
            // Plan laissé en attente : la prochaine synchronisation réessaiera.
          }
          fait += 1;
          definirProgression({ fait, total: besoins.length });
        });
        definirProgression(null);
      }

      const sequence: SequenceDoc = actions.sequenceCourante();
      const resultat = synchroniserFilm(
        sequence,
        items,
        liensRef.current,
        [...mediasRef.current, ...recus.map((r) => r.asset)],
        recus,
      );
      for (const recu of recus) {
        actions.ajouterMedia(
          recu.asset,
          recu.importe.pics,
          recu.importe.tampon,
          recu.importe.video,
        );
      }
      changerLiens(resultat.liens);
      const { ajoutes, remplaces, horsFilm } = resultat.bilan;
      if (ajoutes + remplaces > 0) {
        if (premiereFois) {
          actions.reinitialiserSequence(resultat.sequence);
          toast(`Film assemblé : ${ajoutes} plan${ajoutes > 1 ? 's' : ''}`, { kind: 'success' });
        } else {
          actions.executer(
            command<SequenceDoc>({
              label: 'Mise à jour depuis les plans',
              apply: () => ok(resultat.sequence),
            }),
          );
          const morceaux = [
            ajoutes > 0
              ? `${ajoutes} plan${ajoutes > 1 ? 's' : ''} ajouté${ajoutes > 1 ? 's' : ''}`
              : '',
            remplaces > 0 ? `${remplaces} plan${remplaces > 1 ? 's' : ''} mis à jour` : '',
          ].filter(Boolean);
          toast(`Film : ${morceaux.join(', ')}`, {
            kind: 'success',
            action: { label: 'Annuler', run: actions.annuler },
          });
        }
      } else if (horsFilm > 0) {
        toast(
          `${horsFilm} plan${horsFilm > 1 ? 's' : ''} retiré${horsFilm > 1 ? 's' : ''} du film a une nouvelle version`,
        );
      }
      const echecs = besoins.length - recus.length;
      if (echecs > 0) {
        toast(`${echecs} média${echecs > 1 ? 's' : ''} n’a pas pu être récupéré`, {
          kind: 'error',
        });
      }
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Plans indisponibles', { kind: 'error' });
    } finally {
      synchroEnCoursRef.current = false;
      if (synchroARefaireRef.current) {
        synchroARefaireRef.current = false;
        void synchroniserRef.current();
      }
    }
  }, [actions, changerLiens, projectId]);

  const synchroniserRef = useRef(synchroniser);
  synchroniserRef.current = synchroniser;

  // --- Ouverture ---------------------------------------------------------------------------------

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const montage = await call(
          api.GET('/projects/{project_id}/edit', { params: { path: { project_id: projectId } } }),
        );
        if (annule) return;
        revisionRef.current = montage.revision;
        const liensLus = lireLiens(montage.links);
        changerLiens(liensLus);
        if (montage.document !== null) {
          const lu = deserializeProject(JSON.stringify(montage.document));
          if (!lu.ok) {
            // Un montage illisible doit se voir, et surtout ne pas être écrasé par un montage vide.
            conflitRef.current = true;
            definirErreur(lu.error);
            definirEtatFilm('erreur');
            definirPret(true);
            return;
          }
          actions.chargerDocument(lu.value.document);
          documentRef.current = lu.value.document;
          mediasRef.current = lu.value.document.media;
          dernierEnvoiRef.current = { document: lu.value.document, liens: liensLus };
          const medias = lu.value.document.media;
          definirPret(true);

          // Les décodeurs ne s'enregistrent pas : on les rouvre à partir des fichiers du serveur.
          const aOuvrir = medias.filter((m) => liensLus.media[m.id] !== undefined);
          for (const media of medias) {
            if (liensLus.media[media.id] === undefined && media.status === 'online') {
              actions.modifierMedia(media.id, { status: 'offline' });
            }
          }
          let fait = 0;
          if (aOuvrir.length > 0) definirProgression({ fait, total: aOuvrir.length });
          await enParallele(aOuvrir, 3, async (media) => {
            const lien = liensLus.media[media.id];
            if (lien === undefined || annule) return;
            try {
              const importe = await ouvrirMedia(
                lien.assetId,
                lien.mimeType,
                media.name,
                media.duration.base.rate,
              );
              actions.definirDonneesMedia(media.id, importe.pics, importe.tampon, importe.video);
            } catch {
              actions.modifierMedia(media.id, { status: 'offline' });
            }
            fait += 1;
            definirProgression({ fait, total: aOuvrir.length });
          });
          definirProgression(null);
        } else {
          definirPret(true);
        }
        if (!annule) await synchroniserRef.current();
      } catch (cause) {
        if (annule) return;
        definirErreur(
          appError('STORAGE_UNAVAILABLE', 'Le montage n’a pas pu être ouvert.', {
            detail: errorMessage(cause),
          }),
        );
        conflitRef.current = true;
        definirEtatFilm('erreur');
        definirPret(true);
      }
    })();
    return () => {
      annule = true;
    };
    // Une seule ouverture par montage de l'écran.
  }, [actions, changerLiens, projectId]);

  // Retour sur l'écran, plans modifiés, retour dans l'onglet : le film rattrape le studio.
  const ouvertRef = useRef(false);
  useEffect(() => {
    if (!pret) return undefined;
    if (!ouvertRef.current) {
      ouvertRef.current = true;
      return undefined;
    }
    if (actif) void synchroniserRef.current();
    return undefined;
  }, [actif, pret, versionPlans]);
  useEffect(() => {
    if (!actif) return undefined;
    const surRetour = (): void => void synchroniserRef.current();
    window.addEventListener('focus', surRetour);
    return () => window.removeEventListener('focus', surRetour);
  }, [actif]);

  // --- Médias importés à la main -----------------------------------------------------------------

  const conserverMedia = useCallback(
    (asset: MediaAssetDoc, fichier: File) => {
      if (!canEdit) return;
      const extension = extensionDe(fichier.name);
      const type = fichier.type || (TYPES_PAR_EXTENSION[extension] ?? '');
      const formulaire = new FormData();
      formulaire.append('file', new File([fichier], fichier.name, { type }));
      void fetch(`${API_URL}/projects/${projectId}/edit/media`, {
        method: 'POST',
        body: formulaire,
        credentials: 'include',
        headers: api.csrfToken ? { [CSRF_HEADER]: api.csrfToken } : {},
      })
        .then(async (reponse) => {
          const corps: unknown = await reponse.json().catch(() => null);
          if (!reponse.ok) throw new Error(errorMessage(corps, 'Envoi impossible'));
          const envoye = corps as UploadedAsset;
          changerLiens({
            ...liensRef.current,
            media: {
              ...liensRef.current.media,
              [asset.id]: { assetId: envoye.asset.id, shotId: null, mimeType: type },
            },
          });
        })
        .catch((cause: unknown) => {
          toast(
            `« ${fichier.name} » reste sur cet ordinateur : ${cause instanceof Error ? cause.message : 'envoi impossible'}`,
            { kind: 'error' },
          );
        });
    },
    [canEdit, changerLiens, projectId],
  );

  const enregistrer = useCallback(() => void sauverRef.current(), []);
  const remettrePlan = useCallback(
    (shotId: string) => {
      changerLiens(oublierPlan(liensRef.current, shotId));
      void synchroniserRef.current();
    },
    [changerLiens],
  );

  return {
    pret,
    etat: etatFilm,
    erreur,
    plans,
    liens,
    progression,
    enregistrer,
    remettrePlan,
    conserverMedia,
  };
}
