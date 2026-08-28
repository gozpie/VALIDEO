package com.gozpie.pocketairplane.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.gozpie.pocketairplane.R
import com.gozpie.pocketairplane.airplane.AirplaneModeController
import com.gozpie.pocketairplane.data.AppState
import com.gozpie.pocketairplane.data.Journal
import com.gozpie.pocketairplane.data.Prefs
import com.gozpie.pocketairplane.detection.PocketSensorMonitor
import com.gozpie.pocketairplane.detection.PocketStateMachine
import com.gozpie.pocketairplane.detection.SensorSnapshot
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Service de premier plan qui surveille les capteurs et bascule le mode avion.
 *
 * Il reste au premier plan afin qu'Android ne l'arrête pas quand l'écran est éteint, ce qui est
 * précisément le moment où il doit travailler.
 */
class PocketAirplaneService : Service(), PocketSensorMonitor.Listener {

    private lateinit var prefs: Prefs
    private lateinit var controller: AirplaneModeController
    private lateinit var monitor: PocketSensorMonitor

    /** Les commandes shell peuvent bloquer plusieurs secondes : jamais sur le thread capteurs. */
    private lateinit var airplaneExecutor: ExecutorService

    private var lastNotificationText: String? = null
    private var monitoring = false

    private val airplaneObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) {
            val on = controller.isAirplaneModeOn()
            AppState.update { it.copy(airplaneModeOn = on) }
            if (!on) prefs.airplaneEnabledByApp = false
            refreshNotification()
        }
    }

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs.get(this)
        controller = AirplaneModeController(this)
        airplaneExecutor = Executors.newSingleThreadExecutor()
        monitor = PocketSensorMonitor(this, prefs.detectionConfig, this)
        monitor.updateConfig(effectiveConfig())

        contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.AIRPLANE_MODE_ON),
            false,
            airplaneObserver,
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Toujours en premier : Android exige un passage au premier plan rapide après
        // startForegroundService(), y compris lorsque l'intention reçue est un arrêt.
        startForeground(
            Notifications.NOTIFICATION_ID_STATUS,
            Notifications.buildStatusNotification(this, statusText()),
        )

        if (intent?.action == ACTION_STOP) {
            prefs.serviceEnabled = false
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == ACTION_RELOAD_CONFIG && monitoring) {
            monitor.updateConfig(effectiveConfig())
            return START_STICKY
        }

        prefs.serviceEnabled = true
        AppState.update {
            it.copy(serviceRunning = true, airplaneModeOn = controller.isAirplaneModeOn())
        }

        // Réaligne la machine à états sur la réalité : évite une coupure intempestive au démarrage.
        monitor.resetPhase(
            if (controller.isAirplaneModeOn() && prefs.airplaneEnabledByApp) {
                PocketStateMachine.Phase.IN_POCKET
            } else {
                PocketStateMachine.Phase.OUT_OF_POCKET
            },
        )
        monitor.updateConfig(effectiveConfig())
        monitor.start()
        monitoring = true

        warnIfNoStrategy()
        Journal.log(this, getString(R.string.log_service_started))
        refreshNotification()
        return START_STICKY
    }

    override fun onDestroy() {
        contentResolver.unregisterContentObserver(airplaneObserver)
        monitor.release()
        monitoring = false
        // Journalisé ici plutôt que dans ACTION_STOP : l'arrêt peut aussi venir de stopService().
        Journal.log(this, getString(R.string.log_service_stopped))
        // Ne jamais laisser l'utilisateur injoignable après l'arrêt de la surveillance.
        restoreAirplaneModeIfOwned()
        airplaneExecutor.shutdown()
        AppState.update { it.copy(serviceRunning = false) }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // --- PocketSensorMonitor.Listener -------------------------------------------------------

    override fun onAction(action: PocketStateMachine.Action) {
        airplaneExecutor.execute {
            val outcome = when (action) {
                PocketStateMachine.Action.ENABLE_AIRPLANE -> controller.enable()
                PocketStateMachine.Action.DISABLE_AIRPLANE -> controller.disable()
            }
            journalOutcome(action, outcome)
            AppState.update { it.copy(airplaneModeOn = controller.isAirplaneModeOn()) }
            refreshNotification()
        }
    }

    override fun onSnapshot(snapshot: SensorSnapshot, phase: PocketStateMachine.Phase) {
        AppState.update { it.copy(snapshot = snapshot, phase = phase) }
        refreshNotification()
    }

    // --- Interne -----------------------------------------------------------------------------

    /** Désactive les exigences liées aux capteurs absents de l'appareil. */
    private fun effectiveConfig() = prefs.detectionConfig.let { config ->
        config.copy(
            requireProximity = config.requireProximity && hasProximitySensor(),
            requireDarkness = config.requireDarkness && hasLightSensor(),
        )
    }

    private fun hasProximitySensor() = monitor.hasProximitySensor

    private fun hasLightSensor() = monitor.hasLightSensor

    private fun journalOutcome(action: PocketStateMachine.Action, outcome: AirplaneModeController.Outcome) {
        val verb = if (action == PocketStateMachine.Action.ENABLE_AIRPLANE) {
            getString(R.string.log_verb_enable)
        } else {
            getString(R.string.log_verb_disable)
        }
        val message = when (outcome) {
            is AirplaneModeController.Outcome.Applied -> getString(R.string.log_applied, verb, outcome.strategyId)
            is AirplaneModeController.Outcome.Skipped -> getString(R.string.log_skipped, verb, outcome.reason)
            is AirplaneModeController.Outcome.Failed -> getString(R.string.log_failed, verb, outcome.reason)
            AirplaneModeController.Outcome.Unsupported -> getString(R.string.log_unsupported, verb)
        }
        Journal.log(this, message)

        if (outcome is AirplaneModeController.Outcome.Unsupported ||
            outcome is AirplaneModeController.Outcome.Failed
        ) {
            Notifications.showAlert(this, getString(R.string.alert_title), message)
        }
    }

    private fun warnIfNoStrategy() {
        if (controller.resolveStrategy() == null) {
            Journal.log(this, getString(R.string.log_no_strategy))
        }
    }

    private fun restoreAirplaneModeIfOwned() {
        if (!prefs.airplaneEnabledByApp) return
        airplaneExecutor.execute {
            val outcome = controller.disable()
            journalOutcome(PocketStateMachine.Action.DISABLE_AIRPLANE, outcome)
        }
    }

    private fun statusText(): String {
        val status = AppState.status.value
        val phase = if (status.phase == PocketStateMachine.Phase.IN_POCKET) {
            getString(R.string.phase_in_pocket)
        } else {
            getString(R.string.phase_out_of_pocket)
        }
        val airplane = if (status.airplaneModeOn) {
            getString(R.string.airplane_on)
        } else {
            getString(R.string.airplane_off)
        }
        return getString(R.string.notification_status, phase, airplane)
    }

    private fun refreshNotification() {
        val text = statusText()
        if (text == lastNotificationText) return
        lastNotificationText = text
        runCatching {
            NotificationManagerCompat.from(this)
                .notify(Notifications.NOTIFICATION_ID_STATUS, Notifications.buildStatusNotification(this, text))
        }
    }

    companion object {
        const val ACTION_STOP = "com.gozpie.pocketairplane.action.STOP"
        const val ACTION_RELOAD_CONFIG = "com.gozpie.pocketairplane.action.RELOAD_CONFIG"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, PocketAirplaneService::class.java))
        }

        /** Applique à chaud les réglages modifiés depuis l'interface. */
        fun reloadConfig(context: Context) {
            val intent = Intent(context, PocketAirplaneService::class.java).setAction(ACTION_RELOAD_CONFIG)
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }

        /** Arrêt depuis l'interface : `stopService` évite les restrictions de démarrage en arrière-plan. */
        fun stop(context: Context) {
            Prefs.get(context).serviceEnabled = false
            context.stopService(Intent(context, PocketAirplaneService::class.java))
        }
    }
}
