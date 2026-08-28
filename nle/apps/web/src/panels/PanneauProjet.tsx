/**
 * Panneau Projet (§7).
 *
 * Les colonnes affichees sont celles que le modele porte reellement. Les
 * colonnes de §7 qui dependent d une analyse media -- codec, resolution,
 * espace colorimetrique -- n apparaissent pas tant qu aucun media n est
 * importe : une colonne vide est plus honnete qu une colonne inventee.
 */
import type { SequenceDoc } from '@valideo/project-model';
import { clipEnd } from '@valideo/timeline-model';

export interface ProprietesPanneauProjet {
  readonly sequence: SequenceDoc;
  readonly timecode: (image: number) => string;
}

const NOMS_TYPE: Readonly<Record<string, string>> = {
  colorMatte: 'Cache couleur',
  title: 'Titre',
  adjustmentLayer: 'Calque d’effet',
  audio: 'Audio',
  video: 'Vidéo',
  image: 'Image',
  nestedSequence: 'Séquence imbriquée',
};

export function PanneauProjet({ sequence, timecode }: ProprietesPanneauProjet): React.JSX.Element {
  const elements = sequence.tracks.flatMap((piste) => piste.clips.map((clip) => ({ clip, piste })));
  elements.sort((a, b) => a.clip.start - b.clip.start || a.piste.name.localeCompare(b.piste.name));

  return (
    <table className="table-projet">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Type</th>
          <th>Piste</th>
          <th>Début</th>
          <th>Fin</th>
          <th>Durée</th>
        </tr>
      </thead>
      <tbody>
        {elements.map(({ clip, piste }) => (
          <tr key={clip.id}>
            <td>
              {clip.label !== null && (
                <span className="pastille" style={{ background: clip.label }} />
              )}
              {clip.name || '(sans nom)'}
            </td>
            <td style={{ color: 'var(--texte-doux)' }}>{NOMS_TYPE[clip.kind] ?? clip.kind}</td>
            <td style={{ color: 'var(--texte-doux)' }}>{piste.name}</td>
            <td className="mono">{timecode(clip.start)}</td>
            <td className="mono">{timecode(clipEnd(clip))}</td>
            <td className="mono">{clip.duration}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
