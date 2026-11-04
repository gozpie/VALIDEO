/**
 * Command pattern (sections 43 et 70).
 *
 * Toute modification du projet passe par une commande. Une commande est une
 * fonction PURE de l etat vers un nouvel etat : elle ne mute rien, elle produit
 * une nouvelle valeur par partage de structure.
 *
 * Consequence directe : l annulation n a pas besoin d une logique inverse
 * ecrite a la main pour chaque operation. Il suffit de reprendre l etat
 * precedent. C est ce qui rend l undo fiable sur des operations composees
 * comme le ripple delete, ou une inverse manuelle serait quasi impossible a
 * garder juste (section 70).
 */
import type { AppError, CommandId, Result } from '@valideo/shared';
import { newCommandId, ok } from '@valideo/shared';

export interface Command<S> {
  readonly id: CommandId;
  /** Libelle affiche dans le panneau Historique. */
  readonly label: string;
  /**
   * Cle de fusion. Deux commandes consecutives partageant la meme cle non nulle
   * fusionnent en une seule entree d historique. Indispensable pour qu un
   * glisser-deposer de 200 images ne produise pas 200 entrees d annulation.
   */
  readonly mergeKey: string | null;
  /** Transformation pure. Retourne un `Err` si la contrainte metier interdit l operation. */
  apply(state: S): Result<S, AppError>;
}

export interface CommandInit<S> {
  readonly label: string;
  readonly mergeKey?: string | null;
  apply(state: S): Result<S, AppError>;
}

export function command<S>(init: CommandInit<S>): Command<S> {
  return {
    id: newCommandId(),
    label: init.label,
    mergeKey: init.mergeKey ?? null,
    apply: init.apply,
  };
}

/**
 * Compose plusieurs commandes en une seule, ATOMIQUE.
 *
 * Si une etape echoue, l ensemble echoue et l etat d origine est retourne
 * intact : aucune modification partielle n atteint le projet. C est exactement
 * la sequence exigee par la section 70 (determiner, calculer, valider,
 * produire, appliquer atomiquement, historiser).
 */
export function transaction<S>(
  label: string,
  steps: readonly Command<S>[],
  mergeKey: string | null = null,
): Command<S> {
  return {
    id: newCommandId(),
    label,
    mergeKey,
    apply(state: S): Result<S, AppError> {
      let current = state;
      for (const step of steps) {
        const result = step.apply(current);
        if (!result.ok) return result;
        current = result.value;
      }
      return ok(current);
    },
  };
}

/** Commande neutre. Utile comme element d identite dans une composition. */
export function noop<S>(label = 'Aucune modification'): Command<S> {
  return command<S>({ label, apply: (state) => ok(state) });
}
