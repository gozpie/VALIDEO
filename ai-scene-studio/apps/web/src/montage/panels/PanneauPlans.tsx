/**
 * Plans du film : la galerie des plans du studio, dans l'ordre du découpage. Cliquer un plan amène la
 * tête de lecture dessus ; on le glisse sur la timeline pour le poser une fois de plus.
 */
import { CircleDashed, CornerDownLeft, Star } from 'lucide-react';
import { assetUrl } from '@/studio/data';
import { clipsImageDuPlan, type LiensFilm, type PlanDuFilm } from '../film';
import { clipEnd } from '@valideo/timeline-model';
import type { SequenceDoc } from '@valideo/project-model';

function secondes(valeur: number): string {
  return `${valeur.toFixed(valeur % 1 === 0 ? 0 : 1).replace('.', ',')} s`;
}

export function PanneauPlans({
  plans,
  liens,
  sequence,
  tete,
  canEdit,
  allerA,
  remettre,
}: {
  plans: readonly PlanDuFilm[];
  liens: LiensFilm;
  sequence: SequenceDoc;
  tete: number;
  canEdit: boolean;
  allerA: (image: number) => void;
  remettre: (shotId: string) => void;
}): React.JSX.Element {
  if (plans.length === 0) return <div className="plans-vide">Les plans arrivent…</div>;
  const parPlan = (shotId: string) => clipsImageDuPlan(sequence, shotId, liens);
  const mediaDe = (plan: PlanDuFilm): string | null => {
    if (plan.media === null) return null;
    const media = plan.media;
    for (const [id, lien] of Object.entries(liens.media)) {
      if (lien.shotId === plan.shotId && lien.assetId === media.assetId) return id;
    }
    return null;
  };
  return (
    <ul className="plans-grille" data-test="plans-du-film">
      {plans.map((plan) => {
        const clips = parPlan(plan.shotId);
        const premier = clips[0];
        const courant = clips.some((c) => tete >= c.start && tete < clipEnd(c));
        const mediaId = mediaDe(plan);
        const absent = clips.length === 0 && liens.shots[plan.shotId] !== undefined;
        return (
          <li key={plan.shotId} className={courant ? 'plan courant' : 'plan'}>
            <button
              type="button"
              className="plan-carte"
              draggable={mediaId !== null}
              onDragStart={(e) => {
                if (mediaId === null) return;
                e.dataTransfer.setData('application/x-valideo-media', mediaId);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                if (premier !== undefined) allerA(premier.start);
              }}
              title={plan.name || plan.label}
              data-test={`plan-${plan.label}`}
            >
              <span className="plan-image">
                {plan.media === null ? (
                  <span className="plan-attente">
                    <CircleDashed size={18} />À générer
                  </span>
                ) : plan.media.kind === 'video' ? (
                  <video
                    src={assetUrl(plan.media.assetId)}
                    preload="metadata"
                    muted
                    playsInline
                    draggable={false}
                  />
                ) : (
                  <img src={assetUrl(plan.media.assetId)} alt="" draggable={false} />
                )}
                <span className="plan-numero">{plan.label}</span>
                {plan.media?.retained && (
                  <span className="plan-retenu" title="Version retenue">
                    <Star size={11} fill="currentColor" />
                  </span>
                )}
              </span>
              <span className="plan-legende">
                <span className="plan-nom">{plan.name || plan.sequence}</span>
                <span className="plan-duree mono">{secondes(plan.seconds)}</span>
              </span>
            </button>
            {absent && (
              <button
                type="button"
                className="plan-remettre"
                disabled={!canEdit}
                onClick={() => remettre(plan.shotId)}
                title="Ce plan a été retiré du film : le remettre à sa place"
              >
                <CornerDownLeft size={12} /> Remettre dans le film
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
