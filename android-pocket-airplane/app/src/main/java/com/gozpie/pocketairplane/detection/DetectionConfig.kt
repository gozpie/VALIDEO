package com.gozpie.pocketairplane.detection

/**
 * Paramètres de détection « téléphone tête en bas dans la poche ».
 *
 * Les seuils d'orientation sont exprimés sur l'axe Y du repère capteur Android :
 * téléphone à l'endroit → gravité Y ≈ +9,81 m/s² ; téléphone tête en bas → gravité Y ≈ -9,81 m/s².
 * Deux seuils distincts (entrée / sortie) fournissent une hystérésis qui évite les oscillations
 * lorsque le téléphone est proche de l'horizontale.
 */
data class DetectionConfig(
    /** Gravité Y sous laquelle le téléphone est considéré « tête en bas ». */
    val headDownEnterThreshold: Float = DEFAULT_HEAD_DOWN_ENTER,
    /** Gravité Y au-dessus de laquelle le téléphone n'est plus « tête en bas ». */
    val headDownExitThreshold: Float = DEFAULT_HEAD_DOWN_EXIT,
    /** Exiger que le capteur de proximité soit obstrué (téléphone contre le tissu de la poche). */
    val requireProximity: Boolean = true,
    /** Exiger que la luminosité ambiante soit faible (poche fermée). */
    val requireDarkness: Boolean = false,
    /** Seuil de luminosité, en lux, en dessous duquel on considère être dans une poche. */
    val darknessLuxThreshold: Float = DEFAULT_DARKNESS_LUX,
    /** Durée pendant laquelle les conditions doivent être réunies avant d'activer le mode avion. */
    val enterDelayMs: Long = DEFAULT_ENTER_DELAY_MS,
    /** Durée pendant laquelle les conditions doivent être rompues avant de couper le mode avion. */
    val exitDelayMs: Long = DEFAULT_EXIT_DELAY_MS,
) {
    init {
        require(headDownEnterThreshold <= headDownExitThreshold) {
            "Le seuil d'entrée doit être inférieur ou égal au seuil de sortie (hystérésis)."
        }
        require(enterDelayMs >= 0 && exitDelayMs >= 0) { "Les délais doivent être positifs." }
    }

    companion object {
        const val DEFAULT_HEAD_DOWN_ENTER = -5.0f
        const val DEFAULT_HEAD_DOWN_EXIT = -2.0f
        const val DEFAULT_DARKNESS_LUX = 8.0f
        const val DEFAULT_ENTER_DELAY_MS = 3_000L
        const val DEFAULT_EXIT_DELAY_MS = 2_000L
    }
}
