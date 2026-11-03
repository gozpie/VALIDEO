# Limites connues

## Fonctionnelles (phase 1)

- Interface volontairement sobre : connexion, workspaces, membres et invitations, projets, séquences et plans
  (création, renommage des séquences, ordre par boutons ↑/↓, suppression). Non exposés à l'écran bien que
  disponibles dans l'API : modification de la cadence et de la résolution d'un projet, de la durée et de la
  cadence propre d'un plan, insertion à une position donnée. Pas de glisser-déposer.
- Pas encore de règles ESLint spécifiques à Next.js et React (`@next/eslint-plugin-next`, `react-hooks`).
- Pas d'inscription publique ni de réinitialisation de mot de passe : premier compte en ligne de commande,
  les suivants par invitation. **Aucun e-mail n'est envoyé** : l'admin reçoit le lien et le transmet lui-même ;
  il pourrait donc l'utiliser à la place de l'invité pour une adresse sans compte (le lien ne donne jamais accès
  à un compte existant).
- Un plan ne peut pas encore être déplacé d'une séquence à une autre ; la propriété d'un workspace ne peut pas
  être transférée.
- Les sessions expirées sont supprimées quand elles sont présentées ; une purge périodique viendra avec les
  workers (phase 4). La limite d'échecs par e-mail permet à un tiers de bloquer temporairement un compte
  (compromis classique, fenêtre de 15 minutes).
- Pas d'éditeur, d'animation, de rendu ni de génération IA. L'interface web se limite à l'état des services.
- `packages/scene-engine`, `animation-engine`, `editor-ui` et `workers/*` ne contiennent qu'une description de leur rôle.
- Les types de `shared-types` décrivent la forme cible des entités ; ils seront générés depuis l'OpenAPI en phase 1.

## Techniques

- **MinIO remplacé par SeaweedFS** en local : les images MinIO ne sont plus distribuées publiquement. Seule l'API S3
  standard est utilisée ; un autre stockage compatible S3 peut être branché par configuration.
- **Intégrité de scène côté Python** : le backend ne valide pour l'instant que la structure (JSON Schema). Les règles
  d'intégrité (références, cycles, pistes) seront portées en phase 1, avant tout enregistrement de scène.
- **Blender absent** de l'environnement de développement actuel ; la version cible sera arrêtée en phase 4.
- **Conversions Blender** documentées (SCENE_SCHEMA.md) mais pas encore vérifiées par des tests de rendu (phase 4).
- **Identité pixel** : aucune identité n'est garantie entre la preview Three.js et le rendu Blender ; seuls les
  transformations, le cadrage, les focales et le timing seront testés.
- **Génération IA** : un générateur probabiliste ne garantit pas la fidélité géométrique ; un seed identique ne
  garantit pas la reproductibilité chez un fournisseur distant.
