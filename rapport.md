# Rapport de modifications

## 2026-08-30 — Refonte de l'interface : bouton central, pages balayables, thème sombre (étape 3)

### Objectif
Une interface grand public : un geste évident à l'ouverture, aucun jargon en façade, et un fond
sombre pour une application qu'on consulte souvent dans la pénombre, juste avant de ranger le
téléphone.

### Modifications
- `activity_main.xml` : trois pages dans un `ViewPager2` — contrôle, réglages, journal — avec trois
  points indicateurs. On glisse pour aller aux réglages ; l'accueil ne sert qu'à démarrer.
- `page_control.xml` (nouveau) : un bouton circulaire de 240 dp cerclé d'un anneau, et **une seule
  phrase** sous lui. Le bouton porte l'état par sa couleur et son libellé : « Activer » (gris),
  « Activé » (violet), « Dans la poche » (tertiaire). Rien d'autre à lire.
- `page_settings.xml` (nouveau) : les deux vérifications et les trois curseurs, puis le détail
  technique — méthode de bascule, capteurs, raccourci vers les réglages système — relégué en bas
  sous « Détails techniques ».
- `page_journal.xml` (nouveau) : les mesures brutes rejoignent le journal et les boutons d'essai,
  là où elles servent vraiment.
- `themes.xml` : `Theme.Material3.Dark` en toutes circonstances, barres système forcées en sombre
  via `WindowInsetsController` — sans quoi la barre de navigation restait blanche sous un écran
  noir quand le système est en thème clair.
- `AndroidManifest.xml` : portrait verrouillé. En paysage, le bouton mangeait l'écran et la phrase
  d'état passait sous les dialogues système ; l'application n'a rien à y gagner.
- Vocabulaire revu pour un public non technique : « Inclinaison nécessaire : moyenne » au lieu d'un
  seuil en m/s², « Couper après 3 s dans la poche », « Vérifier qu'il fait sombre ». Les axes
  d'accéléromètre et le nom de la permission ne paraissent plus sur l'écran d'accueil.
- Le réglage de proximité est grisé, avec sa raison, quand l'appareil n'a pas de capteur utilisable
  (cas du Galaxy S23) : un interrupteur que le service ignore ferait croire à une panne.

### Deux pièges traités
Curseurs et pager glissent tous deux à l'horizontale. Première tentative : couper
`ViewPager2.isUserInputEnabled` pendant le glissement d'un curseur. **Mauvaise idée** — vérifiée sur
l'appareil : si le geste est annulé au lieu d'être relâché, `onStopTrackingTouch` n'est jamais
appelé et la navigation reste bloquée définitivement. Remplacé par
`requestDisallowInterceptTouchEvent`, que le framework remet à zéro en fin de geste, annulation
comprise.

L'affichage bord à bord imposé par `targetSdk 35` faisait passer les points indicateurs sous la
barre de navigation : `fitsSystemWindows` posé sur la racine.

### Validation
`BUILD SUCCESSFUL`, 18 tests au vert. Interface vérifiée sur le Galaxy S23 par captures : page de
contrôle, page de réglages avec le curseur de proximité grisé, navigation entre les pages,
thème sombre et barres système sombres.

### Reste à faire
- Le seuil d'obscurité reste figé à 8 lx, sans réglage.
- Étape suivante à arbitrer : Shizuku, repli « Ne pas déranger », ou réglages avancés.

## 2026-08-30 — Le capteur de proximité du Galaxy bloquait la détection (étape 1, suite)

### Objectif
Essai sur un Galaxy S23 : la détection ne se déclenchait jamais, sans message d'erreur. Trouver la
cause et faire en sorte qu'aucun utilisateur n'ait à la deviner.

### Diagnostic
`getDefaultSensor(TYPE_PROXIMITY)` retournait « Palm Proximity Sensor version 2 », un capteur
Samsung de détection de paume. Samsung l'expose sous le type standard `android.sensor.proximity(8)`
et réserve le capteur physique (`STK33911 Proximity`) à un type propriétaire protégé par la
permission `com.samsung.permission.SSENSOR`, inaccessible aux applications tierces.

Le capteur de paume ne réagit pas au tissu d'une poche. L'application attendait donc un signal qui
n'arrivait jamais : la fenêtre d'échantillonnage de l'orientation ne s'ouvrait pas, et rien
n'indiquait pourquoi. Contourner demandait de décocher « Exiger le capteur de proximité » — encore
fallait-il savoir que le capteur annoncé « présent » ne servait à rien.

### Modifications
- `detection/ProximitySensorFilter.kt` (nouveau) : écarte les capteurs dont le nom porte un marqueur
  de geste (`palm`, `touch`, `grip`, `iris`, `gesture`) et préfère, parmi ceux qui restent, la
  variante à réveil matériel. Logique pure, sans dépendance Android, donc testable sur la JVM.
- `detection/SensorSelection.kt` (nouveau) : `SensorManager.usableProximitySensor()`, point d'entrée
  unique partagé par la détection et l'interface.
- `detection/PocketSensorMonitor.kt` : utilise cette sélection au lieu de `getDefaultSensor`, et
  journalise les capteurs rejetés pour rendre diagnosticable un appareil inconnu.
- `ui/MainActivity.kt` : l'état des capteurs passait par son propre `getDefaultSensor` et annonçait
  « proximité : présent » pour un capteur que la détection écartait. Deux sources de vérité qui se
  contredisaient ; l'écran suit désormais la même règle.

Aucun garde-fou nouveau n'était nécessaire : `PocketAirplaneService` calculait déjà
`requireProximity = config.requireProximity && hasProximitySensor()`. Il suffisait que la
disponibilité dise la vérité pour que le repli en orientation seule se fasse de lui-même.

### Validation
Compilation et tests : `BUILD SUCCESSFUL`, 18 tests au vert (9 sur la machine à états, 9 nouveaux
sur le filtre, écrits à partir des noms relevés par `adb shell dumpsys sensorservice` sur le S23).

Sur l'appareil, données remises à zéro pour repartir des préférences par défaut
(`requireProximity = true`), puis surveillance activée :

    I/PocketSensorMonitor: Aucun capteur de proximité exploitable : Palm Proximity Sensor version 2
    11:36:59 + 0x0000005b ... (gravity, PocketSensorMonitor)

L'application s'abonne à la seule gravité, l'écran annonce « proximité : absent », et le repli en
orientation seule est automatique malgré la préférence restée active.

Le cycle complet avait été validé auparavant sur le même appareil, proximité désactivée à la main :
mise en poche à 11:10:21 (mode avion activé), sortie à 11:11:20 (désactivé), via
`write_secure_settings`.

### Reste à faire
- Le seuil d'obscurité est figé à 8 lx, sans réglage, contrairement aux trois autres paramètres.
- Sans capteur de proximité, l'orientation est échantillonnée en continu sous wake lock : la
  consommation augmente. C'est le compromis assumé, mais il pèse sur le choix de l'étape 2.
- Étape 2 à arbitrer : Shizuku, repli « Ne pas déranger », ou réglages avancés.

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
