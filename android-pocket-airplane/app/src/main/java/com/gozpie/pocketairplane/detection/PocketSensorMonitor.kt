package com.gozpie.pocketairplane.detection

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import kotlin.math.min

/**
 * Écoute les capteurs et alimente la [PocketStateMachine].
 *
 * Stratégie d'économie d'énergie :
 * - le capteur de proximité (à réveil matériel) reste actif en permanence, son coût est négligeable ;
 * - l'accéléromètre/gravité n'est échantillonné que lorsque c'est utile (proximité obstruée ou
 *   transition en cours de confirmation), et un `PARTIAL_WAKE_LOCK` n'est détenu que pendant
 *   ces fenêtres d'échantillonnage, jamais en continu.
 *
 * Toutes les mutations d'état se font sur le thread interne `pocket-sensors`.
 */
class PocketSensorMonitor(
    context: Context,
    private var config: DetectionConfig,
    private val listener: Listener,
) : SensorEventListener {

    interface Listener {
        /** Un changement de phase a été confirmé. Appelé sur le thread capteurs. */
        fun onAction(action: PocketStateMachine.Action)

        /** Les mesures ont évolué. Appelé sur le thread capteurs. */
        fun onSnapshot(snapshot: SensorSnapshot, phase: PocketStateMachine.Phase)
    }

    private val appContext = context.applicationContext
    private val sensorManager = appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager

    private val gravitySensor: Sensor? = wakeUpOrDefault(Sensor.TYPE_GRAVITY)
    private val accelerometerSensor: Sensor? = wakeUpOrDefault(Sensor.TYPE_ACCELEROMETER)
    private val proximitySensor: Sensor? = selectProximitySensor()
    private val lightSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT)

    /** Capteur effectivement utilisé pour l'orientation. */
    private val motionSensor: Sensor? = gravitySensor ?: accelerometerSensor

    val hasProximitySensor: Boolean get() = proximitySensor != null
    val hasLightSensor: Boolean get() = lightSensor != null
    val hasMotionSensor: Boolean get() = motionSensor != null

    private val thread = HandlerThread("pocket-sensors").apply { start() }
    private val handler = Handler(thread.looper)

    private val wakeLock: PowerManager.WakeLock =
        powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
            setReferenceCounted(false)
        }

    val stateMachine = PocketStateMachine(config)

    @Volatile
    var snapshot: SensorSnapshot = SensorSnapshot()
        private set

    private var started = false
    private var motionSamplingActive = false
    private var motionWindowStartedAtMs: Long? = null
    private var filteredGravityY: Float? = null

    private val tickRunnable = Runnable { onTick() }

    fun start() = handler.post {
        if (started) return@post
        started = true
        proximitySensor?.let { sensorManager.registerListener(this, it, SENSOR_DELAY_PROXIMITY, handler) }
        if (config.requireDarkness) {
            lightSensor?.let { sensorManager.registerListener(this, it, SENSOR_DELAY_LIGHT, handler) }
        }
        refreshSampling(SystemClock.elapsedRealtime())
        publishSnapshot()
    }

    fun stop() = handler.post {
        if (!started) return@post
        started = false
        handler.removeCallbacks(tickRunnable)
        sensorManager.unregisterListener(this)
        motionSamplingActive = false
        motionWindowStartedAtMs = null
        releaseWakeLock()
    }

    /** Libère le thread interne. L'instance devient inutilisable. */
    fun release() {
        stop()
        handler.post { thread.quitSafely() }
    }

    fun updateConfig(newConfig: DetectionConfig) = handler.post {
        config = newConfig
        stateMachine.updateConfig(newConfig)
        if (started) {
            sensorManager.unregisterListener(this)
            motionSamplingActive = false
            motionWindowStartedAtMs = null
            proximitySensor?.let { sensorManager.registerListener(this, it, SENSOR_DELAY_PROXIMITY, handler) }
            if (config.requireDarkness) {
                lightSensor?.let { sensorManager.registerListener(this, it, SENSOR_DELAY_LIGHT, handler) }
            }
            refreshSampling(SystemClock.elapsedRealtime())
        }
    }

    /** Réaligne la machine à états sur l'état réel du mode avion. */
    fun resetPhase(phase: PocketStateMachine.Phase) = handler.post {
        stateMachine.resetTo(phase)
        refreshSampling(SystemClock.elapsedRealtime())
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onSensorChanged(event: SensorEvent) {
        val now = SystemClock.elapsedRealtime()
        when (event.sensor.type) {
            Sensor.TYPE_GRAVITY -> snapshot = snapshot.copy(gravityY = event.values[1])

            Sensor.TYPE_ACCELEROMETER -> {
                // Filtre passe-bas : isole la composante gravitaire du bruit de mouvement.
                val previous = filteredGravityY
                val filtered = if (previous == null) {
                    event.values[1]
                } else {
                    LOW_PASS_ALPHA * previous + (1f - LOW_PASS_ALPHA) * event.values[1]
                }
                filteredGravityY = filtered
                snapshot = snapshot.copy(gravityY = filtered)
            }

            Sensor.TYPE_PROXIMITY -> {
                val threshold = min(event.sensor.maximumRange, PROXIMITY_NEAR_THRESHOLD_CM)
                val near = event.values[0] < threshold
                if (snapshot.proximityNear != near) {
                    // Nouvelle fenêtre d'échantillonnage à chaque transition de proximité.
                    motionWindowStartedAtMs = null
                }
                snapshot = snapshot.copy(proximityNear = near)
            }

            Sensor.TYPE_LIGHT -> snapshot = snapshot.copy(lightLux = event.values[0])

            else -> return
        }
        evaluate(now)
    }

    private fun onTick() {
        if (!started) return
        evaluate(SystemClock.elapsedRealtime())
    }

    private fun evaluate(nowMs: Long) {
        val action = stateMachine.update(snapshot, nowMs)
        refreshSampling(nowMs)
        publishSnapshot()
        if (action != null) {
            listener.onAction(action)
        }
    }

    private fun publishSnapshot() {
        listener.onSnapshot(snapshot, stateMachine.phase)
    }

    /** Active ou désactive l'échantillonnage du capteur de mouvement selon le besoin réel. */
    private fun refreshSampling(nowMs: Long) {
        if (!started) return
        val shouldSample = shouldSampleMotion(nowMs)

        if (shouldSample && !motionSamplingActive) {
            val sensor = motionSensor
            if (sensor == null) {
                Log.w(TAG, "Aucun capteur d'orientation disponible sur cet appareil.")
            } else {
                sensorManager.registerListener(this, sensor, SENSOR_DELAY_MOTION, handler)
                motionSamplingActive = true
                motionWindowStartedAtMs = nowMs
            }
        } else if (!shouldSample && motionSamplingActive) {
            motionSensor?.let { sensorManager.unregisterListener(this, it) }
            motionSamplingActive = false
            filteredGravityY = null
        }

        handler.removeCallbacks(tickRunnable)
        if (stateMachine.hasPendingTransition) {
            handler.postDelayed(tickRunnable, TICK_INTERVAL_MS)
        }

        if (motionSamplingActive || stateMachine.hasPendingTransition) {
            acquireWakeLock()
        } else {
            releaseWakeLock()
        }
    }

    private fun shouldSampleMotion(nowMs: Long): Boolean {
        // Sans capteur de proximité exploitable, l'orientation est le seul signal : échantillonnage continu.
        if (!config.requireProximity) return true
        // Une transition doit toujours pouvoir être confirmée ou infirmée.
        if (stateMachine.hasPendingTransition) return true
        // Une fois le téléphone rangé, la sortie de poche est signalée par le capteur de proximité.
        if (stateMachine.phase == PocketStateMachine.Phase.IN_POCKET) return false
        if (snapshot.proximityNear != true) return false
        val startedAt = motionWindowStartedAtMs ?: return true
        // Garde-fou : téléphone posé face contre table, proximité obstruée mais jamais tête en bas.
        return nowMs - startedAt <= MAX_IDLE_SAMPLING_MS
    }

    private fun acquireWakeLock() {
        if (!wakeLock.isHeld) wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS)
    }

    private fun releaseWakeLock() {
        if (wakeLock.isHeld) wakeLock.release()
    }

    /** Préfère la variante « wake-up » du capteur, qui continue d'émettre écran éteint. */
    private fun wakeUpOrDefault(type: Int): Sensor? =
        sensorManager.getDefaultSensor(type, true) ?: sensorManager.getDefaultSensor(type)

    /**
     * Choisit un capteur de proximité qui mesure vraiment une distance.
     *
     * `getDefaultSensor(TYPE_PROXIMITY)` ne convient pas : certains constructeurs exposent sous ce
     * type un capteur de geste (paume, dalle tactile) qui ne signale rien dans une poche. Retenir
     * un tel capteur bloquerait la détection en silence — cf. [ProximitySensorFilter].
     */
    private fun selectProximitySensor(): Sensor? {
        val chosen = sensorManager.usableProximitySensor()
        if (chosen == null) {
            val candidates = sensorManager.getSensorList(Sensor.TYPE_PROXIMITY).orEmpty()
            if (candidates.isNotEmpty()) {
                Log.i(TAG, "Aucun capteur de proximité exploitable : ${candidates.joinToString { it.name }}")
            }
        }
        return chosen
    }

    private companion object {
        const val TAG = "PocketSensorMonitor"
        const val WAKE_LOCK_TAG = "PocheAvion:detection"
        const val WAKE_LOCK_TIMEOUT_MS = 5 * 60 * 1000L
        const val TICK_INTERVAL_MS = 500L
        const val MAX_IDLE_SAMPLING_MS = 120_000L
        const val PROXIMITY_NEAR_THRESHOLD_CM = 5.0f
        const val LOW_PASS_ALPHA = 0.85f
        const val SENSOR_DELAY_PROXIMITY = SensorManager.SENSOR_DELAY_NORMAL
        const val SENSOR_DELAY_LIGHT = SensorManager.SENSOR_DELAY_NORMAL
        const val SENSOR_DELAY_MOTION = SensorManager.SENSOR_DELAY_UI
    }
}
