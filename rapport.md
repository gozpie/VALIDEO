# Rapport de modifications

## 2026-08-30 — Correction de la compilation Android (étape 1, suite)

### Objectif
Exécuter la compilation Android complète, restée invérifiable lors de l'étape précédente, et
corriger ce qu'elle révèle.

### Modifications
- `app/src/main/res/drawable/ic_airplane.xml` : la balise ouvrante `<vector>` n'était jamais
  fermée. Faute du `>` final, `aapt2` lisait l'élément `<path>` suivant comme un attribut de
  `vector` et refusait le fichier. Ajout du chevron manquant.

### Validation
Compilation et tests exécutés sur un poste disposant du SDK Android (JDK 21, SDK 35, AGP 8.7.3,
Gradle 8.14.3) :

    ./gradlew assembleDebug testDebugUnitTest

`BUILD SUCCESSFUL`. L'APK de débogage est produit (`app-debug.apk`, 6,0 Mo) et les 9 tests
unitaires de `PocketStateMachineTest` passent. Le reste du code Kotlin compile sans erreur.

Ce défaut ne pouvait pas être détecté à l'étape précédente : `dl.google.com` y était bloqué, donc
aucune compilation des ressources n'avait jamais été lancée. C'était le seul défaut du projet.

### Reste à faire pour clore l'étape 1
Installation sur l'appareil et essai en conditions réelles, qui demandent un téléphone branché :

    adb install -r app/build/outputs/apk/debug/app-debug.apk
    adb shell pm grant com.gozpie.pocketairplane.debug android.permission.WRITE_SECURE_SETTINGS

Puis vérifier dans le journal de l'application que la mise en poche et la sortie sont bien
détectées, et ajuster les seuils à chaud si la détection se révèle trop ou pas assez sensible.

## 2026-08-28 — Application Android « Poche Avion » (étape 1)

### Objectif
Répondre à la demande : une application Android qui bascule le téléphone en mode avion lorsqu'il
est rangé tête en bas dans une poche, et qui le rend de nouveau joignable dès qu'on le ressort.

### Modifications
Ajout d'un projet Android autonome dans `android-pocket-airplane/`, isolé du site PHP VALIDEO qui
occupe la racine du dépôt.

- **Détection** (`detection/`) : machine à états sans dépendance Android (`PocketStateMachine`)
  alimentée par un moniteur de capteurs (`PocketSensorMonitor`). Le geste est reconnu par la
  conjonction de l'orientation (gravité Y sous un seuil négatif) et du capteur de proximité
  obstrué, maintenue pendant un délai configurable. Une hystérésis évite les basculements en
  rafale près de l'horizontale.
- **Bascule du mode avion** (`airplane/`) : deux stratégies interchangeables, root (`su`) et
  permission système `WRITE_SECURE_SETTINGS` octroyée par ADB, derrière un contrôleur qui porte
  les garde-fous métier (ne jamais couper un mode avion activé manuellement, rétablir la
  connectivité à l'arrêt du service).
- **Service** (`service/`) : service de premier plan qui survit à l'extinction de l'écran, relance
  après redémarrage, tuile de réglages rapides et notifications.
- **Interface** (`ui/`) : écran unique affichant la méthode de bascule disponible, les mesures des
  capteurs en direct, les réglages appliqués à chaud et un journal des 50 derniers événements.
- **Tests** : 9 tests unitaires JVM couvrant la logique de décision (délais, hystérésis, options,
  données manquantes).
- Documentation dans `android-pocket-airplane/README.md`.

### Point d'attention
Android interdit aux applications tierces de basculer le mode avion depuis l'API 17. L'application
ne peut donc fonctionner que sur un appareil rooté, ou après l'octroi unique par ADB de la
permission `WRITE_SECURE_SETTINGS`. À défaut, la détection fonctionne et est journalisée, mais la
bascule est signalée comme impossible plutôt qu'échouer silencieusement.

### Validation
La logique de détection a été compilée et ses tests exécutés (9/9 au vert). La compilation Android
complète n'a pas pu être vérifiée dans l'environnement d'exécution : l'accès à `dl.google.com`
(plugin Android Gradle et SDK) y est bloqué par la politique réseau.

### Étapes suivantes proposées
1. Prise en charge de Shizuku, pour éviter le rebranchement à un PC après chaque réinstallation.
2. Repli « Ne pas déranger » sur les appareils sans root ni permission ADB, pour rendre le
   téléphone silencieux à défaut de le déconnecter.
3. Réglages avancés : plages horaires, exclusion de certaines applications, historique exportable.

---

## Antérieur

- Mise à jour du `README.md` avec une description détaillée du projet, des fonctionnalités
  principales, des endpoints et du flux d'utilisation.
