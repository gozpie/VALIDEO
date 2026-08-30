package com.gozpie.pocketairplane.detection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Les noms utilisés ici sont ceux relevés sur un Galaxy S23 (SM-S911N) via
 * `adb shell dumpsys sensorservice`.
 */
class ProximitySensorFilterTest {

    @Test
    fun `un capteur de distance classique est retenu`() {
        assertTrue(ProximitySensorFilter.isPhysicalProximity("STK33911 Proximity"))
        assertTrue(ProximitySensorFilter.isPhysicalProximity("Proximity Sensor"))
    }

    @Test
    fun `le capteur de paume du Galaxy est ecarte`() {
        assertFalse(ProximitySensorFilter.isPhysicalProximity("Palm Proximity Sensor version 2"))
    }

    @Test
    fun `les autres capteurs de geste sont ecartes`() {
        assertFalse(ProximitySensorFilter.isPhysicalProximity("Touch Proximity Sensor"))
        assertFalse(ProximitySensorFilter.isPhysicalProximity("STK33911 Proximity Iris"))
        assertFalse(ProximitySensorFilter.isPhysicalProximity("Grip Sensor"))
    }

    @Test
    fun `un nom absent ou vide est ecarte`() {
        assertFalse(ProximitySensorFilter.isPhysicalProximity(null))
        assertFalse(ProximitySensorFilter.isPhysicalProximity("   "))
    }

    @Test
    fun `la casse n'a pas d'importance`() {
        assertFalse(ProximitySensorFilter.isPhysicalProximity("PALM PROXIMITY"))
    }

    @Test
    fun `la variante a reveil materiel est preferee`() {
        val candidates = listOf(
            "STK33911 Proximity Strm" to false,
            "STK33911 Proximity" to true,
        )
        assertEquals(1, ProximitySensorFilter.selectIndex(candidates))
    }

    @Test
    fun `un capteur sans reveil est accepte a defaut`() {
        val candidates = listOf("STK33911 Proximity Strm" to false)
        assertEquals(0, ProximitySensorFilter.selectIndex(candidates))
    }

    @Test
    fun `le capteur de paume n'est jamais choisi meme en reveil materiel`() {
        // Cas réel du S23 : seul le capteur de paume est exposé sous TYPE_PROXIMITY.
        val candidates = listOf("Palm Proximity Sensor version 2" to true)
        assertNull(ProximitySensorFilter.selectIndex(candidates))
    }

    @Test
    fun `sans aucun capteur le resultat est nul`() {
        assertNull(ProximitySensorFilter.selectIndex(emptyList()))
    }
}
