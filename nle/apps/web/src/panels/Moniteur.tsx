/**
 * Moniteur Source et Moniteur Programme.
 *
 * L IMAGE reste volontairement absente (section 1003) : il n y a ni
 * demultiplexeur ni decodeur video, et afficher une mire ou une image fixe
 * serait exactement le « faire semblant » qu interdit le cahier des charges.
 *
 * Le SON, lui, est reellement decode et joue, et c est l horloge audio qui
 * commande la tete de lecture (section 22). Le panneau distingue donc
 * clairement les deux plutot que de tout declarer indisponible.
 */

export interface ProprietesMoniteur {
  readonly titre: string;
  readonly tete?: string | undefined;
  readonly duree?: string | undefined;
  readonly enLecture?: boolean | undefined;
}

export function Moniteur({
  titre,
  tete,
  duree,
  enLecture = false,
}: ProprietesMoniteur): React.JSX.Element {
  return (
    <section className="panneau">
      <div className="panneau-entete">
        <span className="titre">{titre}</span>
        <span className="espace" />
        <span className="etiquette-etat partiel">Son lu · image non décodée</span>
      </div>
      <div className="panneau-corps">
        <div className="moniteur">
          <div className="moniteur-image">
            <div className="moniteur-vide">
              <h3>{enLecture ? 'Lecture du son en cours' : 'Aucune image à afficher'}</h3>
              <p>
                Le <strong>son</strong> est réellement décodé et joué, et c’est l’horloge audio qui
                commande la tête de lecture. L’<strong>image</strong>, elle, demande un
                démultiplexeur et un décodeur qui n’existent pas encore : ce panneau reste vide
                plutôt que d’afficher une image simulée.
              </p>
            </div>
          </div>
          {tete !== undefined && (
            <div className="moniteur-barre">
              <span className="tc mono">{tete}</span>
              <span className="espace" style={{ flex: 1 }} />
              <span className="mono" style={{ color: 'var(--texte-doux)' }}>
                {duree}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
