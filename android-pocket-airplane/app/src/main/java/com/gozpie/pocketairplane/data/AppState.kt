package com.gozpie.pocketairplane.data

import com.gozpie.pocketairplane.detection.PocketStateMachine
import com.gozpie.pocketairplane.detection.SensorSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** État observable partagé entre le service de détection et l'interface. */
object AppState {

    data class Status(
        val serviceRunning: Boolean = false,
        val snapshot: SensorSnapshot = SensorSnapshot(),
        val phase: PocketStateMachine.Phase = PocketStateMachine.Phase.OUT_OF_POCKET,
        val airplaneModeOn: Boolean = false,
        val lastMessage: String? = null,
        val journal: List<String> = emptyList(),
    )

    private val _status = MutableStateFlow(Status())
    val status: StateFlow<Status> = _status.asStateFlow()

    fun update(transform: (Status) -> Status) = _status.update(transform)
}
