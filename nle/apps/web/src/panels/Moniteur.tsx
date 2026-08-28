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
}

export function Moniteur({ titre, tete, duree }: ProprietesMoniteur): React.JSX.Element {
  return (
    <section className="panneau">
      <div className="panneau-entete">
        <span className="titre">{titre}</span>
        <span className="espace" />
        <span className="etiquette-etat indisponible">Moniteur source non implémenté</span>
      </div>
      <div className="panneau-corps">
        <div className="moniteur">
          <div className="moniteur-image">
            <div className="moniteur-vide">
              <h3>Moniteur source non implémenté</h3>
              <p>
                Le moniteur source affichera le média sélectionné dans le panneau Projet, avec ses
                propres points d’entrée et de sortie. Il n’est pas encore construit : ce panneau
                reste vide plutôt que d’afficher un contenu simulé. Le Moniteur Programme, lui,
                affiche l’image réelle du montage.
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
