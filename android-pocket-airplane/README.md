# Poche Avion

Application Android qui **active le mode avion quand le téléphone est rangé tête en bas dans une
poche**, et le **désactive dès qu'on le ressort**.

---

## ⚠️ À lire avant tout : la contrainte Android

Depuis Android 4.2 (API 17), **une application tierce ne peut pas basculer le mode avion**. Le
réglage `Settings.Global.AIRPLANE_MODE_ON` est protégé par une permission système qu'aucune boîte
de dialogue ne permet d'accorder. Ce n'est pas un choix de conception de cette application, c'est
une restriction de la plateforme.

Deux moyens existent pour lever ce verrou, et l'application les prend tous les deux en charge :

| Méthode | Prérequis | Mise en place |
| --- | --- | --- |
| **Root (`su`)** | Téléphone rooté | Aucune : l'application détecte `su` et l'utilise. Accorder l'accès root à l'application à la première demande. |
| **Permission ADB** | Un PC, une seule fois | `adb shell pm grant com.gozpie.pocketairplane android.permission.WRITE_SECURE_SETTINGS` |

La permission ADB survit aux redémarrages, mais **pas à une désinstallation** de l'application.

Sans l'un de ces deux moyens, l'application se lance, détecte correctement le geste et le
journalise, mais ne peut pas basculer le mode avion : elle le signale explicitement dans
l'écran principal et par une notification, plutôt que d'échouer en silence.

---

## Principe de détection

Le geste « rangé dans la poche, tête en bas » est reconnu par la conjonction de deux signaux :

1. **Orientation** — la composante Y du vecteur gravité passe sous un seuil négatif (par défaut
   `-5 m/s²`), c'est-à-dire que le haut du téléphone pointe vers le sol.
2. **Proximité** — le capteur de proximité est obstrué (le téléphone est contre le tissu).

Les deux conditions doivent être réunies **sans interruption** pendant un délai configurable
(3 s par défaut) avant que le mode avion ne s'active. À la sortie de poche, la rupture d'une des
conditions pendant 2 s (par défaut) coupe le mode avion.

Une **hystérésis** de 3 m/s² sur le seuil d'orientation évite les basculements en rafale quand le
téléphone est proche de l'horizontale.

Un capteur de luminosité peut être exigé en plus (option désactivée par défaut, car tous les
appareils n'en disposent pas et sa valeur dépend beaucoup du tissu).

### Garde-fous

- L'application **ne coupe jamais un mode avion que l'utilisateur a activé lui-même** : elle ne
  désactive que ce qu'elle a activé.
- À l'arrêt de la surveillance, le mode avion qu'elle avait activé est rétabli — on ne laisse
  jamais l'utilisateur injoignable.
- Une modification du mode avion faite hors de l'application est détectée (observateur sur le
  réglage système) et l'état interne se réaligne.

### Consommation de batterie

L'accéléromètre n'est pas échantillonné en continu :

- le **capteur de proximité**, à réveil matériel, reste actif en permanence (coût négligeable) ;
- l'**orientation** n'est mesurée que lorsque la proximité est obstruée ou qu'une transition doit
  être confirmée, et un `PARTIAL_WAKE_LOCK` n'est détenu que pendant ces fenêtres ;
- une fois le téléphone détecté rangé, l'échantillonnage s'arrête : la sortie de poche est
  signalée par le capteur de proximité ;
- un garde-fou de 2 min arrête l'échantillonnage si la proximité reste obstruée sans que
  l'orientation ne corresponde (téléphone posé face contre une table, par exemple).

Si l'option « exiger le capteur de proximité » est désactivée, l'orientation devient le seul
signal disponible et l'échantillonnage redevient continu : la consommation augmente sensiblement.
L'interface le signale.

---

## Compilation

```bash
cd android-pocket-airplane
./gradlew assembleDebug          # APK : app/build/outputs/apk/debug/
./gradlew test                   # tests unitaires de la machine à états
```

Prérequis : JDK 17 et le SDK Android (API 35). Sous Android Studio, ouvrir directement le dossier
`android-pocket-airplane`. En ligne de commande, indiquer le SDK via `local.properties` :

```properties
sdk.dir=/chemin/vers/Android/Sdk
```

Installation puis, si l'appareil n'est pas rooté, octroi de la permission :

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant com.gozpie.pocketairplane.debug android.permission.WRITE_SECURE_SETTINGS
```

> Le variant `debug` porte le suffixe `.debug` dans son identifiant d'application ; en `release`,
> utiliser `com.gozpie.pocketairplane`.

---

## Utilisation

1. Ouvrir l'application, vérifier la ligne **« Méthode de bascule »** en haut de l'écran.
2. Activer **« Activer la surveillance »** et accepter la notification permanente.
3. Ajuster si besoin les seuils et délais ; ils sont appliqués à chaud.
4. Les boutons **Tester : activer / désactiver** vérifient la bascule sans passer par les capteurs.
5. Le **journal** conserve les 50 derniers événements — utile pour régler les seuils, puisqu'on ne
   peut pas regarder l'écran pendant que le téléphone est dans la poche.

Une tuile est disponible dans les réglages rapides pour activer/désactiver la surveillance.

---

## Architecture

```
app/src/main/java/com/gozpie/pocketairplane/
├── airplane/
│   ├── AirplaneModeController.kt   Politique métier (qui a activé quoi, garde-fous)
│   ├── AirplaneModeStrategy.kt     Stratégies root / WRITE_SECURE_SETTINGS
│   └── ShellRunner.kt              Exécution de commandes shell
├── data/
│   ├── AppState.kt                 État observable partagé (StateFlow)
│   ├── Journal.kt                  Journal d'événements horodaté
│   └── Prefs.kt                    Préférences typées
├── detection/
│   ├── DetectionConfig.kt          Seuils et délais
│   ├── PocketSensorMonitor.kt      Capteurs, wake locks, fenêtres d'échantillonnage
│   ├── PocketStateMachine.kt       Logique pure, testable unitairement
│   └── SensorSnapshot.kt           Dernières mesures connues
├── service/
│   ├── BootReceiver.kt             Relance après redémarrage
│   ├── Notifications.kt            Canaux et notifications
│   ├── PocketAirplaneService.kt    Service de premier plan
│   └── PocketAirplaneTileService.kt Tuile des réglages rapides
└── ui/MainActivity.kt              Écran unique : état, réglages, journal
```

La logique de décision (`PocketStateMachine`) ne dépend d'aucune API Android : elle est couverte
par des tests unitaires JVM dans `app/src/test/`.

---

## Limites connues

- Sans root ni permission ADB, la bascule automatique est impossible (contrainte plateforme).
- Avec la permission ADB seule, l'écriture du réglage est acceptée mais la diffusion de l'intent
  système `ACTION_AIRPLANE_MODE_CHANGED` reste réservée au système. Sur les versions récentes
  d'Android les couches radio suivent le réglage ; sur des ROM plus anciennes ou modifiées, le
  root reste la méthode la plus fiable.
- Une fois le mode avion activé, l'orientation n'est plus échantillonnée : remettre le téléphone
  à l'endroit sans le sortir de la poche ne coupe pas le mode avion. C'est la sortie de poche
  (capteur de proximité dégagé) qui fait foi.
- À l'inverse, si le téléphone est rangé à l'endroit puis retourné plus de 2 min après, la
  bascule n'est pas détectée : le garde-fou d'échantillonnage a coupé la mesure d'orientation.
