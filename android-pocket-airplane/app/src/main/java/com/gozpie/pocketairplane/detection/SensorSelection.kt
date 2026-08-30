package com.gozpie.pocketairplane.detection

import android.hardware.Sensor
import android.hardware.SensorManager

/**
 * Capteur de proximité réellement exploitable, ou `null` si l'appareil n'en expose aucun.
 *
 * Point d'entrée unique : le moniteur comme l'interface doivent s'accorder sur la disponibilité,
 * sinon l'écran annonce un capteur « présent » que la détection n'utilise pas. Voir
 * [ProximitySensorFilter] pour la règle de tri.
 */
fun SensorManager.usableProximitySensor(): Sensor? {
    val candidates = getSensorList(Sensor.TYPE_PROXIMITY).orEmpty()
    val index = ProximitySensorFilter.selectIndex(candidates.map { it.name to it.isWakeUpSensor })
    return index?.let(candidates::get)
}
