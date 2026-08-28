/**
 * Liste des medias importes (§7, §8).
 *
 * Les colonnes affichees sont celles que le navigateur a REELLEMENT pu
 * determiner. Le codec, le profil, la colorimetrie et le timecode embarque
 * exigent ffprobe (§9) : ils sont marques « à analyser » plutot que devines.
 */
import { useCallback, useRef, useState } from 'react';
import type { MediaAssetDoc } from '@valideo/project-model';
import { createClip } from '@valideo/project-model';
import { overwriteCommand } from '@valideo/timeline-model';
import { div, mul, rational, round } from '@valideo/time-core';
import { importerFichier } from '../media/import.js';
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
  if (v !== undefined) morceaux.push(`${v.width}×${v.height}`);
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
        actions.ajouterMedia(resultat.asset, resultat.pics);
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
      const type = asset.videoStreams.length > 0 ? 'video' : 'audio';
      const piste =
        etat.sequence.tracks.find((t) => t.kind === type && t.targeted && !t.locked) ??
        etat.sequence.tracks.find((t) => t.kind === type && !t.locked);
      if (piste === undefined) {
        actions.signalerErreur({
          code: 'EDIT_REJECTED',
          message: `Aucune piste ${type === 'video' ? 'vidéo' : 'audio'} disponible.`,
          action: 'Déverrouiller ou cibler une piste',
        });
        return;
      }

      // Conversion exacte de la durée du média vers la cadence de la séquence.
      const cadenceSource = rational(asset.duration.base.rate.n, asset.duration.base.rate.d);
      const cadenceSequence = rational(
        etat.sequence.timebase.rate.n,
        etat.sequence.timebase.rate.d,
      );
      const duree = Math.max(
        1,
        round(mul(rational(asset.duration.frames), div(cadenceSequence, cadenceSource))),
      );

      const clip = createClip(type, piste.id, etat.tete, duree, {
        mediaId: asset.id,
        name: asset.name,
      });
      actions.executer(overwriteCommand({ clip, trackId: piste.id, at: etat.tete }, etat.contexte));
    },
    [actions, etat.contexte, etat.sequence.timebase.rate, etat.sequence.tracks, etat.tete],
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
              <tr key={asset.id} data-test="ligne-media">
                <td>{asset.name}</td>
                <td style={{ color: 'var(--texte-doux)' }}>{libelleFlux(asset)}</td>
                <td className="mono">{timecode(asset.duration.frames)}</td>
                <td style={{ color: 'var(--texte-doux)' }}>
                  {asset.status !== 'online'
                    ? 'illisible'
                    : etat.pics.has(asset.id)
                      ? 'décodé'
                      : 'à analyser'}
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => poser(asset)}
                    disabled={asset.status !== 'online'}
                    title="Poser à la tête de lecture (overwrite)"
                  >
                    Poser
                  </button>
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
