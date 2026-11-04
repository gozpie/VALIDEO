/**
 * Transitions et titres. On les glisse sur la timeline ; un clic les applique à la tête de lecture
 * (raccord le plus proche sur les pistes ciblées, ou titre à cet endroit).
 */
import { ArrowRight, Blend, Columns2, Moon, Sun, Type } from 'lucide-react';
import { TRANSITIONS_IMAGE } from '@valideo/timeline-model';
import type { TitleDoc } from '@valideo/project-model';
import { createTitle } from '@valideo/project-model';

export const TYPE_GLISSE_TRANSITION = 'application/x-chagomi-transition';
export const TYPE_GLISSE_TITRE = 'application/x-chagomi-titre';

export const PRESETS_TITRE: readonly {
  readonly id: string;
  readonly nom: string;
  readonly titre: TitleDoc;
}[] = [
  { id: 'centre', nom: 'Titre centré', titre: createTitle({ text: 'Titre', size: 10 }) },
  {
    id: 'bandeau',
    nom: 'Bandeau en bas',
    titre: createTitle({
      text: 'Nom, fonction',
      size: 4.5,
      y: 0.84,
      background: '#000000b3',
      shadow: false,
    }),
  },
  {
    id: 'generique',
    nom: 'Générique',
    titre: createTitle({ text: 'Un film de', font: 'serif', bold: false, size: 6 }),
  },
  {
    id: 'carton',
    nom: 'Carton d’affiche',
    titre: createTitle({ text: 'TITRE', font: 'display', bold: false, size: 18 }),
  },
];

const ICONES: Readonly<Record<string, React.ReactNode>> = {
  dissolve: <Blend size={15} />,
  dipBlack: <Moon size={15} />,
  dipWhite: <Sun size={15} />,
  wipe: <Columns2 size={15} />,
  push: <ArrowRight size={15} />,
};

export function PanneauEffets({
  canEdit,
  surTransition,
  surTitre,
}: {
  canEdit: boolean;
  surTransition: (type: string) => void;
  surTitre: (presetId: string) => void;
}): React.JSX.Element {
  return (
    <section className="panneau">
      <div className="panneau-corps effets" data-test="panneau-effets">
        <h4>Transitions</h4>
        <ul>
          {TRANSITIONS_IMAGE.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={!canEdit}
                draggable={canEdit}
                data-test={`transition-${t.id}`}
                title="Glisser sur un raccord, ou cliquer pour le raccord le plus proche de la tête"
                onDragStart={(e) => {
                  e.dataTransfer.setData(TYPE_GLISSE_TRANSITION, t.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => surTransition(t.id)}
              >
                {ICONES[t.id]}
                {t.nom}
              </button>
            </li>
          ))}
        </ul>
        <h4>Titres</h4>
        <ul>
          {PRESETS_TITRE.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={!canEdit}
                draggable={canEdit}
                data-test={`titre-${p.id}`}
                title="Glisser sur une piste vidéo, ou cliquer pour le poser à la tête de lecture"
                onDragStart={(e) => {
                  e.dataTransfer.setData(TYPE_GLISSE_TITRE, p.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => surTitre(p.id)}
              >
                <Type size={15} />
                {p.nom}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
