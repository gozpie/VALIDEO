package com.gozpie.pocketairplane.detection

/**
 * Machine à états sans dépendance Android : elle transforme un flux de mesures capteurs
 * en décisions « activer / couper le mode avion ».
 *
 * Elle est volontairement isolée du reste de l'application pour être testable unitairement
 * (voir `PocketStateMachineTest`).
 */
class PocketStateMachine(
    private var config: DetectionConfig = DetectionConfig(),
    initialPhase: Phase = Phase.OUT_OF_POCKET,
) {

    /** État stable courant. */
    enum class Phase {
        /** Le téléphone n'est pas (ou plus) rangé tête en bas. */
        OUT_OF_POCKET,

        /** Le téléphone est rangé tête en bas : le mode avion doit être actif. */
        IN_POCKET,
    }

    /** Décision émise lors d'un changement de phase confirmé. */
    enum class Action { ENABLE_AIRPLANE, DISABLE_AIRPLANE }

    var phase: Phase = initialPhase
        private set

    /** Instant (ms) auquel les conditions de la phase opposée ont commencé à être réunies. */
    private var pendingSince: Long? = null

    /** `true` tant qu'un changement de phase est en cours de confirmation. */
    val hasPendingTransition: Boolean get() = pendingSince != null

    /** Temps restant, en ms, avant confirmation du changement de phase (`null` si aucun en cours). */
    fun remainingDelayMs(nowMs: Long): Long? {
        val since = pendingSince ?: return null
        val delay = if (phase == Phase.OUT_OF_POCKET) config.enterDelayMs else config.exitDelayMs
        return (since + delay - nowMs).coerceAtLeast(0L)
    }

    fun updateConfig(newConfig: DetectionConfig) {
        config = newConfig
        pendingSince = null
    }

    /** Force la phase courante, par exemple après un changement d'état du mode avion hors de l'app. */
    fun resetTo(newPhase: Phase) {
        phase = newPhase
        pendingSince = null
    }

    /**
     * Intègre une nouvelle mesure et renvoie l'action à exécuter, ou `null` si rien ne change.
     *
     * @param nowMs horloge monotone (`SystemClock.elapsedRealtime()` en production).
     */
    fun update(snapshot: SensorSnapshot, nowMs: Long): Action? {
        val target = if (matchesPocketConditions(snapshot)) Phase.IN_POCKET else Phase.OUT_OF_POCKET

        if (target == phase) {
            pendingSince = null
            return null
        }

        val since = pendingSince ?: nowMs.also { pendingSince = it }
        val delay = if (target == Phase.IN_POCKET) config.enterDelayMs else config.exitDelayMs
        if (nowMs - since < delay) return null

        phase = target
        pendingSince = null
        return if (target == Phase.IN_POCKET) Action.ENABLE_AIRPLANE else Action.DISABLE_AIRPLANE
    }

    /**
     * Les conditions « rangé tête en bas » sont-elles réunies ?
     *
     * Toute donnée requise mais inconnue fait échouer la condition : on préfère ne pas activer
     * le mode avion plutôt que de l'activer à tort.
     */
    fun matchesPocketConditions(snapshot: SensorSnapshot): Boolean {
        if (!isHeadDown(snapshot.gravityY)) return false
        if (config.requireProximity && snapshot.proximityNear != true) return false
        if (config.requireDarkness) {
            val lux = snapshot.lightLux ?: return false
            if (lux > config.darknessLuxThreshold) return false
        }
        return true
    }

    /** Applique l'hystérésis : le seuil dépend de la phase courante. */
    fun isHeadDown(gravityY: Float?): Boolean {
        val y = gravityY ?: return false
        return if (phase == Phase.IN_POCKET) {
            y <= config.headDownExitThreshold
        } else {
            y <= config.headDownEnterThreshold
        }
    }
}
