/**
 * Jeu d icones maison (section 1, interdiction de reprendre des assets tiers).
 *
 * Des SVG en trait, dessines a la grille de 16 px, monochromes et pilotes par
 * `currentColor` : ils suivent donc l etat du bouton sans variante a maintenir.
 */

export interface ProprietesIcone {
  /** `| undefined` explicite : le projet active `exactOptionalPropertyTypes`,
      qui distingue « absent » de « présent et undefined ». */
  readonly taille?: number | undefined;
}

function Svg({
  taille = 13,
  children,
}: {
  taille?: number | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Ciblage de piste : une cible. */
export function IconeCible({ taille }: ProprietesIcone): React.JSX.Element {
  return (
    <Svg taille={taille}>
      <circle cx="8" cy="8" r="5.2" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Verrou. */
export function IconeVerrou({ taille }: ProprietesIcone): React.JSX.Element {
  return (
    <Svg taille={taille}>
      <rect x="3.2" y="7.2" width="9.6" height="6.2" rx="1.2" />
      <path d="M5.6 7.2V5.4a2.4 2.4 0 0 1 4.8 0v1.8" />
    </Svg>
  );
}

/** Visibilite de piste video : un œil. */
export function IconeOeil({ taille }: ProprietesIcone): React.JSX.Element {
  return (
    <Svg taille={taille}>
      <path d="M1.6 8s2.6-4 6.4-4 6.4 4 6.4 4-2.6 4-6.4 4S1.6 8 1.6 8z" />
      <circle cx="8" cy="8" r="1.7" />
    </Svg>
  );
}

/** Coupure du son : un haut-parleur barre. */
export function IconeMuet({ taille }: ProprietesIcone): React.JSX.Element {
  return (
    <Svg taille={taille}>
      <path d="M3 6.2h2.2L8 3.6v8.8L5.2 9.8H3z" />
      <path d="M10.6 6.4l3 3.2M13.6 6.4l-3 3.2" />
    </Svg>
  );
}

/** Solo : un casque. */
export function IconeSolo({ taille }: ProprietesIcone): React.JSX.Element {
  return (
    <Svg taille={taille}>
      <path d="M3 10V8a5 5 0 0 1 10 0v2" />
      <rect x="2" y="9.6" width="2.8" height="3.6" rx="1.1" />
      <rect x="11.2" y="9.6" width="2.8" height="3.6" rx="1.1" />
    </Svg>
  );
}

/** Verrouillage de synchronisation : deux maillons. */
export function IconeSync({ taille }: ProprietesIcone): React.JSX.Element {
  return (
    <Svg taille={taille}>
      <path d="M6.6 9.4a2.6 2.6 0 0 1 0-3.7l1.5-1.5a2.6 2.6 0 0 1 3.7 3.7l-.7.7" />
      <path d="M9.4 6.6a2.6 2.6 0 0 1 0 3.7l-1.5 1.5a2.6 2.6 0 0 1-3.7-3.7l.7-.7" />
    </Svg>
  );
}
