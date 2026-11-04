/**
 * Menu contextuel (§5, §6).
 *
 * Ce qu'un menu contextuel doit faire pour être utilisable, et que beaucoup
 * d'implémentations web omettent :
 *
 *  - se REPLIER quand il déborde de la fenêtre, au lieu d'être coupé ;
 *  - se piloter entièrement au clavier — flèches, Entrée, Échap, Origine/Fin ;
 *  - montrer les raccourcis, parce que c'est là qu'on les apprend ;
 *  - GRISER ce qui n'est pas applicable au lieu de le masquer, pour que la
 *    place des entrées ne bouge pas d'un clic à l'autre ;
 *  - se fermer au premier clic ailleurs, y compris dans un autre panneau.
 *
 * Les entrées désactivées portent une explication : « Aucun clip sélectionné »
 * en dit plus qu'une ligne grise muette.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface EntreeMenu {
  /**
   * Discriminant explicite. Sans lui, `ElementMenu` n'est pas une union
   * discriminee et le predicat de type ne suffit pas a ecarter le separateur.
   */
  readonly separateur?: false;
  readonly id: string;
  readonly libelle: string;
  /** Raccourci affiché à droite. Purement indicatif. */
  readonly raccourci?: string;
  readonly desactivee?: boolean;
  /** Raison du grisage, affichée en infobulle. */
  readonly raison?: string;
  /** Coche à gauche, pour les entrées à bascule. */
  readonly cochee?: boolean;
  readonly onChoisir?: () => void;
  /** Sous-menu. Exclusif avec `onChoisir`. */
  readonly sousMenu?: readonly ElementMenu[];
}

export type ElementMenu = EntreeMenu | SeparateurMenu;

type SeparateurMenu = { readonly separateur: true; readonly id: string };

function estSeparateur(e: ElementMenu): e is SeparateurMenu {
  return e.separateur === true;
}

export interface PositionMenu {
  readonly x: number;
  readonly y: number;
}

export function MenuContextuel({
  position,
  elements,
  onFermer,
}: {
  position: PositionMenu;
  elements: readonly ElementMenu[];
  onFermer: () => void;
}): React.JSX.Element {
  const boiteRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<PositionMenu>(position);
  const [survol, setSurvol] = useState<number>(-1);
  const [sousMenuOuvert, setSousMenuOuvert] = useState<string | null>(null);

  // Repli : mesuré APRÈS le premier rendu, parce que la taille du menu dépend
  // de son contenu et qu'on ne peut pas la deviner avant de l'avoir posé.
  useLayoutEffect(() => {
    const boite = boiteRef.current;
    if (boite === null) return;
    const r = boite.getBoundingClientRect();
    const x = position.x + r.width > window.innerWidth ? position.x - r.width : position.x;
    const y = position.y + r.height > window.innerHeight ? position.y - r.height : position.y;
    setPlace({ x: Math.max(2, x), y: Math.max(2, y) });
  }, [position]);

  useEffect(() => {
    boiteRef.current?.focus();
    const fermerAilleurs = (e: PointerEvent): void => {
      if (boiteRef.current?.contains(e.target as Node) !== true) onFermer();
    };
    // `capture` : le menu doit se fermer AVANT que le clic n'atteigne la
    // timeline, sinon un clic pour fermer déplacerait la tête de lecture.
    window.addEventListener('pointerdown', fermerAilleurs, true);
    window.addEventListener('resize', onFermer);
    return () => {
      window.removeEventListener('pointerdown', fermerAilleurs, true);
      window.removeEventListener('resize', onFermer);
    };
  }, [onFermer]);

  const activables = elements
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !estSeparateur(e) && e.desactivee !== true);

  const deplacer = useCallback(
    (sens: 1 | -1) => {
      if (activables.length === 0) return;
      const courant = activables.findIndex(({ i }) => i === survol);
      const suivant =
        courant === -1
          ? sens === 1
            ? 0
            : activables.length - 1
          : (courant + sens + activables.length) % activables.length;
      setSurvol(activables[suivant]?.i ?? -1);
    },
    [activables, survol],
  );

  const choisir = useCallback(
    (entree: EntreeMenu): void => {
      if (entree.desactivee === true) return;
      if (entree.sousMenu !== undefined) {
        setSousMenuOuvert((c) => (c === entree.id ? null : entree.id));
        return;
      }
      entree.onChoisir?.();
      onFermer();
    },
    [onFermer],
  );

  return (
    <div
      className="menu-contextuel"
      role="menu"
      tabIndex={-1}
      ref={boiteRef}
      style={{ left: place.x, top: place.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onFermer();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          deplacer(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          deplacer(-1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const cible = elements[survol];
          if (cible !== undefined && !estSeparateur(cible)) choisir(cible);
        }
      }}
    >
      {elements.map((element, i) =>
        estSeparateur(element) ? (
          <div key={element.id} className="separateur-menu" role="separator" />
        ) : (
          <div key={element.id} className="enveloppe-entree">
            <button
              type="button"
              role="menuitem"
              data-test={`menu-${element.id}`}
              className={`entree-menu ${i === survol ? 'survolee' : ''}`}
              disabled={element.desactivee === true}
              title={element.desactivee === true ? (element.raison ?? '') : ''}
              aria-haspopup={element.sousMenu !== undefined}
              aria-expanded={
                element.sousMenu === undefined ? undefined : sousMenuOuvert === element.id
              }
              onPointerEnter={() => setSurvol(i)}
              onClick={() => choisir(element)}
            >
              <span className="coche">{element.cochee === true ? '✓' : ''}</span>
              <span className="libelle">{element.libelle}</span>
              <span className="raccourci">
                {element.sousMenu !== undefined ? '▸' : (element.raccourci ?? '')}
              </span>
            </button>
            {element.sousMenu !== undefined && sousMenuOuvert === element.id && (
              <div className="sous-menu" role="menu">
                {element.sousMenu.map((sous: ElementMenu) =>
                  estSeparateur(sous) ? (
                    <div key={sous.id} className="separateur-menu" role="separator" />
                  ) : (
                    <button
                      key={sous.id}
                      type="button"
                      role="menuitem"
                      data-test={`menu-${sous.id}`}
                      className="entree-menu"
                      disabled={sous.desactivee === true}
                      onClick={() => choisir(sous)}
                    >
                      <span className="coche">{sous.cochee === true ? '✓' : ''}</span>
                      <span className="libelle">{sous.libelle}</span>
                      <span className="raccourci">{sous.raccourci ?? ''}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
