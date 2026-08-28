/**
 * Moniteur Source et Moniteur Programme.
 *
 * Volontairement VIDES (section 1003). Le moteur de lecture n existe pas encore :
 * afficher une mire, une image fixe ou des boutons de transport qui ne
 * transportent rien serait exactement le « faire semblant » que le cahier des
 * charges interdit. Le panneau dit ce qui manque et pourquoi.
 */

export interface ProprietesMoniteur {
  readonly titre: string;
  readonly tete?: string;
  readonly duree?: string;
}

export function Moniteur({ titre, tete, duree }: ProprietesMoniteur): React.JSX.Element {
  return (
    <section className="panneau">
      <div className="panneau-entete">
        <span className="titre">{titre}</span>
        <span className="espace" />
        <span className="etiquette-etat indisponible">Lecture indisponible</span>
      </div>
      <div className="panneau-corps">
        <div className="moniteur">
          <div className="moniteur-image">
            <div className="moniteur-vide">
              <h3>Aucune image à afficher</h3>
              <p>
                Le moteur de lecture n’est pas encore construit : ni décodage WebCodecs, ni horloge
                audio, ni composition GPU. Ce panneau restera vide plutôt que d’afficher une image
                simulée.
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
