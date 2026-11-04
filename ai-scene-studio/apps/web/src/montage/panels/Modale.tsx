/**
 * Boite de dialogue modale (§5).
 *
 * Trois exigences, et aucune n est cosmetique : Echap referme, le focus reste
 * PIEGE dans la boite tant qu elle est ouverte, et il revient a l element qui l
 * a ouverte a la fermeture. Sans le piege, la tabulation emmene l utilisateur
 * derriere la boite, sur des commandes qu il croit inertes ; sans le retour de
 * focus, un utilisateur au clavier se retrouve en haut de la page apres chaque
 * validation.
 */
import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLES =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modale({
  titre,
  onFermer,
  onValider,
  children,
  libelleValider = 'Appliquer',
}: {
  titre: string;
  onFermer: () => void;
  onValider?: () => void;
  children: React.ReactNode;
  libelleValider?: string;
}): React.JSX.Element {
  const boiteRef = useRef<HTMLDivElement | null>(null);
  const precedentRef = useRef<Element | null>(null);

  useEffect(() => {
    precedentRef.current = document.activeElement;
    const premier = boiteRef.current?.querySelector<HTMLElement>(FOCUSABLES);
    premier?.focus();
    const rendre = precedentRef.current;
    return () => {
      if (rendre instanceof HTMLElement) rendre.focus();
    };
  }, []);

  const surTouche = useCallback(
    (e: React.KeyboardEvent): void => {
      // Les raccourcis de montage ne doivent PAS s'appliquer pendant qu'une
      // boite est ouverte : taper « c » dans un champ ne peut pas armer la lame.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onFermer();
        return;
      }
      if (e.key === 'Enter' && onValider !== undefined) {
        const cible = e.target;
        if (!(cible instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          onValider();
        }
        return;
      }
      if (e.key !== 'Tab') return;

      const boite = boiteRef.current;
      if (boite === null) return;
      const elements = [...boite.querySelectorAll<HTMLElement>(FOCUSABLES)];
      if (elements.length === 0) return;
      const premier = elements[0];
      const dernier = elements[elements.length - 1];
      if (premier === undefined || dernier === undefined) return;
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    },
    [onFermer, onValider],
  );

  return (
    <div className="voile-modale" onPointerDown={onFermer}>
      <div
        className="modale"
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        ref={boiteRef}
        onKeyDown={surTouche}
        // Le voile ferme au clic, mais un clic DANS la boite ne doit pas
        // remonter jusqu'a lui : sinon regler un champ refermerait la boite.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="titre-modale">{titre}</h2>
        <div className="corps-modale">{children}</div>
        <div className="pied-modale">
          <button type="button" onClick={onFermer}>
            Annuler
          </button>
          {onValider !== undefined && (
            <button type="button" className="principal" onClick={onValider}>
              {libelleValider}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
