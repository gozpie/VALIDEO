package com.gozpie.pocketairplane.detection

/**
 * Photographie des dernières valeurs connues des capteurs.
 *
 * Une valeur `null` signifie « inconnue » : capteur absent de l'appareil, non encore enregistré,
 * ou n'ayant pas encore émis d'événement.
 */
data class SensorSnapshot(
    /** Composante Y du vecteur gravité, en m/s². */
    val gravityY: Float? = null,
    /** `true` si le capteur de proximité est obstrué. */
    val proximityNear: Boolean? = null,
    /** Luminosité ambiante en lux. */
    val lightLux: Float? = null,
)
