/**
 * Liste des medias importes (§7, §8).
 *
 * Les colonnes affichees sont celles que le navigateur a REELLEMENT pu
 * determiner. Le codec, le profil, la colorimetrie et le timecode embarque
 * exigent ffprobe (§9) : ils sont marques « à analyser » plutot que devines.
 */
import { useCallback, useRef, useState } from 'react';
import type { MediaAssetDoc } from '@valideo/project-model';
import { isErr } from '@valideo/shared';
import { overwriteCommand } from '@valideo/timeline-model';
import { importerFichier } from '../media/import.js';
import { clipDepuisMedia, pisteDAccueil, typeDeMedia } from '../media/placement.js';
import { sourceOut } from '@valideo/timeline-model';
import type { ActionsEditeur, EtatEditeur } from '../store.js';

export interface ProprietesMedias {
  readonly etat: EtatEditeur;
  readonly actions: ActionsEditeur;
  readonly timecode: (image: number) => string;
}

function libelleFlux(asset: MediaAssetDoc): string {
  const v = asset.videoStreams[0];
  const a = asset.audioStreams[0];
  const morceaux: string[] = [];
  if (v !== undefined) {
    const cadence = v.frameRate.n / v.frameRate.d;
    morceaux.push(`${v.width}×${v.height}`);
    morceaux.push(`${cadence.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} i/s`);
    if (v.codec !== 'inconnu') morceaux.push(v.codec);
  }
  if (a !== undefined)
    morceaux.push(
      `${a.channels} ch · ${(a.sampleRate / 1000).toFixed(a.sampleRate % 1000 === 0 ? 0 : 1)} kHz`,
    );
  if (morceaux.length === 0) morceaux.push('—');
  return morceaux.join(' · ');
}

export function PanneauMedias({ etat, actions, timecode }: ProprietesMedias): React.JSX.Element {
  const entreeRef = useRef<HTMLInputElement | null>(null);
  const [enCours, definirEnCours] = useState(false);
  const [avertissements, definirAvertissements] = useState<readonly string[]>([]);

  const importer = useCallback(
    async (fichiers: FileList | null) => {
      if (fichiers === null || fichiers.length === 0) return;
      definirEnCours(true);
      const messages: string[] = [];
      for (const fichier of Array.from(fichiers)) {
        const resultat = await importerFichier(fichier, {
          cadenceParDefaut: etat.sequence.timebase.rate,
        });
        actions.ajouterMedia(resultat.asset, resultat.pics, resultat.tampon, resultat.video);
        messages.push(...resultat.avertissements);
      }
      definirAvertissements(messages);
      definirEnCours(false);
    },
    [actions, etat.sequence.timebase.rate],
  );

  /** Overwrite du média sur la première piste ciblée du bon type, à la tête. */
  const poser = useCallback(
    (asset: MediaAssetDoc) => {
      const accueil = pisteDAccueil(etat.sequence, typeDeMedia(asset));
      if (isErr(accueil)) {
        actions.signalerErreur(accueil.error);
        return;
      }
      const piste = accueil.value;

      const clip = clipDepuisMedia(asset, etat.sequence, piste.id, etat.tete);
      actions.executer(overwriteCommand({ clip, trackId: piste.id, at: etat.tete }, etat.contexte));
    },
    [actions, etat.contexte, etat.sequence, etat.tete],
  );

  /**
   * Met un média hors ligne. Les clips qui s'en servent RESTENT en place : un
   * fichier absent ne doit pas effacer un montage, c'est même tout l'intérêt
   * de la notion. Ils s'affichent hachurés jusqu'à la reliaison.
   */
  const mettreHorsLigne = useCallback(
    (asset: MediaAssetDoc) => {
      actions.modifierMedia(asset.id, { status: 'offline' });
    },
    [actions],
  );

  /**
   * Relie un média à un nouveau fichier.
   *
   * La vérification n'est pas facultative : relier un rush de trois secondes à
   * la place d'un plan de trente laisserait vingt-sept secondes de noir que
   * rien ne signalerait. On compare donc la durée du remplaçant à ce que les
   * clips consomment RÉELLEMENT, et on refuse s'il est trop court.
   */
  /** Média en attente de reliaison, le temps du dialogue de fichier. */
  const aRelierRef = useRef<string | null>(null);
  const entreeRelierRef = useRef<HTMLInputElement | null>(null);
  const definirAReleier = useCallback((id: string) => {
    aRelierRef.current = id;
    entreeRelierRef.current?.click();
  }, []);

  const relier = useCallback(
    async (asset: MediaAssetDoc, fichier: File) => {
      const resultat = await importerFichier(fichier, {
        cadenceParDefaut: etat.sequence.timebase.rate,
      });
      const remplacant = resultat.asset;
      if (remplacant.status !== 'online') {
        actions.signalerErreur({
          code: 'MEDIA_UNREADABLE',
          message: `« ${fichier.name} » n’a pas pu être lu.`,
          action: 'Vérifiez le fichier, ou choisissez-en un autre',
          ...(resultat.avertissements[0] === undefined
            ? {}
            : { detail: resultat.avertissements.join('\n') }),
        });
        return;
      }

      const typeAttendu = typeDeMedia(asset);
      if (typeDeMedia(remplacant) !== typeAttendu) {
        actions.signalerErreur({
          code: 'MEDIA_UNREADABLE',
          message: `« ${fichier.name} » n’est pas un média ${typeAttendu === 'video' ? 'vidéo' : 'audio'}.`,
          action: 'Choisissez un fichier du même type',
        });
        return;
      }

      // Image la plus tardive consommée par un clip de ce média, dans la
      // cadence du média lui-même.
      let requises = 0;
      for (const piste of etat.sequence.tracks) {
        for (const clip of piste.clips) {
          if (clip.mediaId !== asset.id) continue;
          const fin = sourceOut(clip, etat.contexte);
          requises = Math.max(requises, clip.reverse ? clip.sourceIn : fin);
        }
      }
      if (remplacant.duration.frames < requises) {
        actions.signalerErreur({
          code: 'MEDIA_UNREADABLE',
          message: `« ${fichier.name} » est trop court pour ce que le montage en utilise.`,
          action: 'Choisissez le bon fichier, ou raccourcissez les clips',
          detail: `${String(requises)} images nécessaires, ${String(remplacant.duration.frames)} disponibles.`,
        });
        return;
      }

      // L'identifiant du média NE CHANGE PAS : c'est lui que les clips
      // référencent. Relier remplace le fichier, pas l'entrée du projet.
      actions.modifierMedia(asset.id, {
        uri: remplacant.uri,
        container: remplacant.container,
        duration: remplacant.duration,
        videoStreams: remplacant.videoStreams,
        audioStreams: remplacant.audioStreams,
        fileSize: remplacant.fileSize,
        modifiedAt: remplacant.modifiedAt,
        status: 'online',
      });
      actions.definirDonneesMedia(asset.id, resultat.pics, resultat.tampon, resultat.video);
    },
    [actions, etat.contexte, etat.sequence],
  );

  return (
    <div>
      <div className="panneau-entete">
        <span className="titre">Médias</span>
        <span className="espace" />
        <button
          type="button"
          onClick={() => entreeRef.current?.click()}
          disabled={enCours}
          title="Importer des fichiers"
        >
          {enCours ? 'Import…' : 'Importer…'}
        </button>
        <input
          ref={entreeRef}
          type="file"
          multiple
          hidden
          data-test="import-medias"
          onChange={(e) => void importer(e.target.files)}
        />
        {/* Entrée séparée pour la reliaison : un seul fichier, et le média
            visé est mémorisé le temps que l'utilisateur le choisisse. */}
        <input
          ref={entreeRelierRef}
          type="file"
          hidden
          data-test="fichier-reliaison"
          onChange={(e) => {
            const fichier = e.target.files?.[0];
            const cible = etat.document.media.find((m) => m.id === aRelierRef.current);
            e.target.value = '';
            if (fichier === undefined || cible === undefined) return;
            void relier(cible, fichier);
          }}
        />
      </div>

      {etat.document.media.length === 0 ? (
        <div className="message">
          Aucun média importé. Les fichiers <strong>audio</strong> sont décodés par le navigateur :
          leur forme d’onde est réelle. Les fichiers <strong>vidéo</strong> sont importés avec leur
          durée et leur définition, mais leur lecture demandera le moteur de décodage, qui n’existe
          pas encore.
        </div>
      ) : (
        <table className="table-projet">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Flux</th>
              <th>Durée</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {etat.document.media.map((asset) => (
              <tr
                key={asset.id}
                data-test="ligne-media"
                className={etat.mediaSelectionne === asset.id ? 'selectionnee' : ''}
                onClick={() => actions.definirMediaSelectionne(asset.id)}
                draggable
                onDragStart={(e) => {
                  // Le média voyage par son identifiant : le document reste la
                  // seule source de vérité, la timeline le relira à la dépose.
                  actions.definirMediaSelectionne(asset.id);
                  e.dataTransfer.setData('application/x-valideo-media', asset.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <td>{asset.name}</td>
                <td style={{ color: 'var(--texte-doux)' }}>{libelleFlux(asset)}</td>
                <td className="mono">{timecode(asset.duration.frames)}</td>
                <td
                  style={{
                    color: asset.status === 'online' ? 'var(--texte-doux)' : 'var(--avert)',
                  }}
                  data-test="etat-media"
                >
                  {asset.status === 'offline'
                    ? 'hors ligne'
                    : asset.status === 'missing'
                      ? 'introuvable'
                      : asset.status === 'unreadable'
                        ? 'illisible'
                        : etat.tampons.has(asset.id)
                          ? 'décodé · lisible'
                          : etat.sourcesVideo.has(asset.id)
                            ? etat.sourcesVideo.get(asset.id)?.infos.decodable === true
                              ? 'démuxé · décodable'
                              : 'démuxé · proxy requis'
                            : etat.pics.has(asset.id)
                              ? 'décodé'
                              : 'à analyser'}
                </td>
                <td className="actions-media">
                  <button
                    type="button"
                    onClick={() => poser(asset)}
                    disabled={asset.status !== 'online'}
                    title="Poser à la tête de lecture (overwrite)"
                  >
                    Poser
                  </button>
                  {asset.status === 'online' ? (
                    <button
                      type="button"
                      data-test="hors-ligne"
                      onClick={() => mettreHorsLigne(asset)}
                      title="Mettre hors ligne : les clips restent, leur média disparaît"
                    >
                      Hors ligne
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-test="relier"
                      className="principal"
                      onClick={() => definirAReleier(asset.id)}
                      title="Relier à un fichier"
                    >
                      Relier…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {avertissements.length > 0 && (
        <div className="message avert">
          {avertissements.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}
