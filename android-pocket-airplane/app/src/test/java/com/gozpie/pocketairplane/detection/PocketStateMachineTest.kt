package com.gozpie.pocketairplane.detection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PocketStateMachineTest {

    private val config = DetectionConfig(
        headDownEnterThreshold = -5f,
        headDownExitThreshold = -2f,
        requireProximity = true,
        requireDarkness = false,
        enterDelayMs = 3_000,
        exitDelayMs = 2_000,
    )

    private fun pocketed(gravityY: Float = -9f, near: Boolean = true) =
        SensorSnapshot(gravityY = gravityY, proximityNear = near)

    @Test
    fun `aucune action tant que le delai d'entree n'est pas ecoule`() {
        val machine = PocketStateMachine(config)
        assertNull(machine.update(pocketed(), nowMs = 0))
        assertNull(machine.update(pocketed(), nowMs = 2_999))
        assertEquals(PocketStateMachine.Phase.OUT_OF_POCKET, machine.phase)
    }

    @Test
    fun `active le mode avion apres le delai d'entree`() {
        val machine = PocketStateMachine(config)
        machine.update(pocketed(), nowMs = 0)
        val action = machine.update(pocketed(), nowMs = 3_000)
        assertEquals(PocketStateMachine.Action.ENABLE_AIRPLANE, action)
        assertEquals(PocketStateMachine.Phase.IN_POCKET, machine.phase)
    }

    @Test
    fun `une interruption des conditions annule le compte a rebours`() {
        val machine = PocketStateMachine(config)
        machine.update(pocketed(), nowMs = 0)
        machine.update(pocketed(near = false), nowMs = 1_000)
        assertNull(machine.update(pocketed(), nowMs = 3_500))
        assertEquals(PocketStateMachine.Phase.OUT_OF_POCKET, machine.phase)
    }

    @Test
    fun `coupe le mode avion apres le delai de sortie`() {
        val machine = PocketStateMachine(config, initialPhase = PocketStateMachine.Phase.IN_POCKET)
        machine.update(pocketed(near = false), nowMs = 0)
        val action = machine.update(pocketed(near = false), nowMs = 2_000)
        assertEquals(PocketStateMachine.Action.DISABLE_AIRPLANE, action)
        assertEquals(PocketStateMachine.Phase.OUT_OF_POCKET, machine.phase)
    }

    @Test
    fun `l'hysteresis empeche les oscillations autour du seuil`() {
        val machine = PocketStateMachine(config, initialPhase = PocketStateMachine.Phase.IN_POCKET)
        // -3 : au-dessus du seuil d'entrée (-5) mais encore sous le seuil de sortie (-2).
        assertTrue(machine.isHeadDown(-3f))
        machine.resetTo(PocketStateMachine.Phase.OUT_OF_POCKET)
        assertTrue(!machine.isHeadDown(-3f))
    }

    @Test
    fun `le mode avion n'est jamais active si l'orientation est inconnue`() {
        val machine = PocketStateMachine(config)
        val snapshot = SensorSnapshot(gravityY = null, proximityNear = true)
        machine.update(snapshot, nowMs = 0)
        assertNull(machine.update(snapshot, nowMs = 10_000))
    }

    @Test
    fun `le capteur de proximite n'est pas exige lorsque l'option est desactivee`() {
        val machine = PocketStateMachine(config.copy(requireProximity = false))
        machine.update(SensorSnapshot(gravityY = -9f), nowMs = 0)
        val action = machine.update(SensorSnapshot(gravityY = -9f), nowMs = 3_000)
        assertEquals(PocketStateMachine.Action.ENABLE_AIRPLANE, action)
    }

    @Test
    fun `l'obscurite est exigee lorsque l'option est active`() {
        val machine = PocketStateMachine(config.copy(requireDarkness = true, darknessLuxThreshold = 8f))
        val eclaire = SensorSnapshot(gravityY = -9f, proximityNear = true, lightLux = 300f)
        machine.update(eclaire, nowMs = 0)
        assertNull(machine.update(eclaire, nowMs = 5_000))

        val sombre = eclaire.copy(lightLux = 2f)
        machine.update(sombre, nowMs = 6_000)
        assertEquals(PocketStateMachine.Action.ENABLE_AIRPLANE, machine.update(sombre, nowMs = 9_000))
    }

    @Test
    fun `le temps restant reflete le delai configure`() {
        val machine = PocketStateMachine(config)
        machine.update(pocketed(), nowMs = 1_000)
        assertEquals(2_000L, machine.remainingDelayMs(nowMs = 2_000))
    }
}
