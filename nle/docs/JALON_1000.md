# Jalon 1000 — état point par point

Le cahier des charges définit un premier vrai produit par 30 capacités
concrètes. Ce document les reprend une à une, sans arrondi favorable.

Légende : **OUI** = fonctionne et est testé · **PARTIEL** = le moteur existe,
l'accès par l'interface manque · **NON** = pas construit.

| # | Capacité | État | Précision |
|---|---|---|---|
| 1 | Créer un projet | **PARTIEL** | Fabriques, schéma versionné et 8 presets de séquence existent et sont testés. Il manque l'écran d'accueil et le dialogue « Nouveau projet » (§67). |
| 2 | Importer et analyser un média | **OUI** | Import navigateur (audio décodé, vidéo démultiplexée), plus un service ffprobe complet testé sur de vrais fichiers. Le branchement du service sur l'import de l'interface reste à faire. |
| 3 | Gérer les proxies | **NON** | La *décision* proxy/direct/transcode est implémentée et testée (§60) ; la génération ne l'est pas. |
| 4 | Organiser des bins | **PARTIEL** | Le schéma porte bins et sous-bins ; l'interface ne les expose pas. |
| 5 | Utiliser le Source Monitor | **NON** | Annoncé comme non implémenté dans l'interface. |
| 6 | Poser des points d'entrée et de sortie | **PARTIEL** | Les actions existent dans le moteur de raccourcis ; elles ne sont pas branchées faute de Source Monitor. |
| 7 | Créer une séquence | **PARTIEL** | Fabriques et presets testés ; pas de dialogue. |
| 8 | Insert / Overwrite | **PARTIEL** | Les deux opérations sont implémentées et testées à fond. L'interface expose l'Overwrite (bouton « Poser ») ; l'Insert attend le montage à trois points. |
| 9 | Déplacer des clips | **OUI** | À la souris, avec accrochage magnétique et changement de piste. |
| 10 | Couper | **OUI** | Outil Lame et Ajouter un point de montage. |
| 11 | Trim, ripple, roll | **OUI** | Plus slip, slide et étirement temporel. |
| 12 | Link / Unlink | **PARTIEL** | Le modèle gère les groupes liés et la sélection les respecte ; pas de commande d'interface. |
| 13 | Zoomer et naviguer | **OUI** | Zoom ancré sur la tête ou le pointeur, ajustement, navigation par points de montage sur les pistes ciblées. |
| 14 | Lire avec synchronisation audio/vidéo | **OUI** | L'horloge audio est maître, l'image suit. Mesuré à ~24,7 i/s sur une séquence à 25. |
| 15 | Afficher les formes d'onde | **OUI** | Depuis les vrais échantillons décodés. |
| 16 | Afficher les vignettes | **OUI** | Tête et queue, décodées à la demande. |
| 17 | Ajouter des transitions | **NON** | Le schéma les porte ; ni rendu ni interface. |
| 18 | Motion / Transform | **NON** | Le schéma porte position, échelle, rotation et point d'ancrage ; pas de rendu. |
| 19 | Keyframes | **NON** | Le schéma porte les keyframes et leurs interpolations ; l'évaluation n'est pas écrite. |
| 20 | Texte | **NON** | Le type de clip existe ; pas de moteur graphique. |
| 21 | Mixer audio | **NON** | Mute, solo et gain de clip sont respectés à la lecture ; pas de panneau de mixage. |
| 22 | Autosave | **OUI** | Temporisée, avec verrou d'écriture et instantanés en rotation. |
| 23 | Fermer et rouvrir sans perte | **OUI** | Vérifié par un test qui recharge réellement la page. |
| 24 | Exporter en H.264 | **NON** | Demande le graphe de rendu et un encodeur. |
| 25 | Offline / Relink | **PARTIEL** | Les statuts sont dans le schéma et la stratégie de lecture les respecte ; pas de flux de reliaison. |
| 26 | Undo / Redo | **OUI** | Illimité, avec retour à n'importe quelle étape et fusion des gestes continus. |
| 27 | Raccourcis | **OUI** | Trois presets, résolution contextuelle, détection de conflits, JKL. |
| 28 | Rester fluide | **OUI** | Mesuré : modèle de rendu d'une vue de 10 000 clips en 0,11–0,28 ms, pour un budget de 16,6 ms par image. |
| 29 | Aucune fonctionnalité factice | **OUI** | C'est la contrainte la plus suivie de ce travail. Voir ci-dessous. |
| 30 | Architecture extensible | **OUI** | 12 paquets aux frontières nettes, 41 décisions d'architecture consignées. |

**Compte : 13 OUI, 8 PARTIEL, 9 NON.**

## Sur le point 29

C'est la contrainte qui a le plus façonné ce travail, et elle a un coût visible :
le Moniteur Source est **vide** avec un texte qui dit pourquoi, plutôt que
d'afficher une mire ; un clip audio sans média décodé n'a **aucune** forme
d'onde, plutôt qu'une courbe décorative ; un clip en lecture inversée n'est
**pas** joué à l'endroit ; la sonie LUFS est marquée partielle dans le code
plutôt que présentée comme conforme ; les fichiers MP4 fragmentés sont **refusés
explicitement** plutôt qu'indexés à moitié.

Une interface qui se donne l'air fini est plus flatteuse. Elle est aussi
impossible à reprendre, parce qu'on ne sait plus ce qui marche.

## Ce qui reste, par ordre de dépendance

Le **graphe de rendu** (§23) est le verrou : il conditionne la composition
multicouche, les transitions, Motion, les keyframes, les effets, l'étalonnage et
l'export. C'est la prochaine grande pièce.

Viennent ensuite le **Moniteur Source** et le montage à trois points (§20, §91),
puis les **proxies** (§11) et l'**export** (§48).
