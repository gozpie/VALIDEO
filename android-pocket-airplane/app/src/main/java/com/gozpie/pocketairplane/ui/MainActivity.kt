package com.gozpie.pocketairplane.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.gozpie.pocketairplane.R
import com.gozpie.pocketairplane.airplane.AirplaneModeController
import com.gozpie.pocketairplane.data.AppState
import com.gozpie.pocketairplane.data.Journal
import com.gozpie.pocketairplane.data.Prefs
import com.gozpie.pocketairplane.databinding.ActivityMainBinding
import com.gozpie.pocketairplane.detection.DetectionConfig
import com.gozpie.pocketairplane.detection.PocketStateMachine
import com.gozpie.pocketairplane.detection.usableProximitySensor
import com.gozpie.pocketairplane.service.PocketAirplaneService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs
    private lateinit var controller: AirplaneModeController

    /** Empêche les écouteurs de réagir aux valeurs posées par le code. */
    private var bindingValues = false

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* rien à faire */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs.get(this)
        controller = AirplaneModeController(this)

        Journal.load(this)
        setUpServiceSwitch()
        setUpDetectionSettings()
        setUpActions()
        observeState()
    }

    override fun onResume() {
        super.onResume()
        AppState.update { it.copy(airplaneModeOn = controller.isAirplaneModeOn()) }
        renderMethod()
    }

    private fun setUpServiceSwitch() {
        binding.switchService.isChecked = prefs.serviceEnabled
        binding.switchService.setOnCheckedChangeListener { _, checked ->
            if (bindingValues) return@setOnCheckedChangeListener
            if (checked) {
                requestNotificationPermissionIfNeeded()
                PocketAirplaneService.start(this)
            } else {
                PocketAirplaneService.stop(this)
            }
        }
    }

    private fun setUpDetectionSettings() {
        val config = prefs.detectionConfig
        bindingValues = true
        binding.switchProximity.isChecked = config.requireProximity
        binding.switchDarkness.isChecked = config.requireDarkness
        binding.sliderEnterDelay.value = (config.enterDelayMs / 1000f).coerceIn(0.5f, 15f)
        binding.sliderExitDelay.value = (config.exitDelayMs / 1000f).coerceIn(0.5f, 15f)
        binding.sliderThreshold.value = config.headDownEnterThreshold.coerceIn(-9.5f, -1f)
        bindingValues = false
        renderDetectionLabels(config)

        binding.switchProximity.setOnCheckedChangeListener { _, _ -> saveDetectionConfig() }
        binding.switchDarkness.setOnCheckedChangeListener { _, _ -> saveDetectionConfig() }
        binding.sliderEnterDelay.addOnChangeListener { _, _, fromUser -> if (fromUser) saveDetectionConfig() }
        binding.sliderExitDelay.addOnChangeListener { _, _, fromUser -> if (fromUser) saveDetectionConfig() }
        binding.sliderThreshold.addOnChangeListener { _, _, fromUser -> if (fromUser) saveDetectionConfig() }
    }

    private fun saveDetectionConfig() {
        if (bindingValues) return
        val enterThreshold = binding.sliderThreshold.value
        val config = DetectionConfig(
            headDownEnterThreshold = enterThreshold,
            // Hystérésis fixe de 3 m/s² : évite les oscillations autour de l'horizontale.
            headDownExitThreshold = min(enterThreshold + HYSTERESIS_MARGIN, MAX_EXIT_THRESHOLD),
            requireProximity = binding.switchProximity.isChecked,
            requireDarkness = binding.switchDarkness.isChecked,
            enterDelayMs = (binding.sliderEnterDelay.value * 1000).toLong(),
            exitDelayMs = (binding.sliderExitDelay.value * 1000).toLong(),
        )
        prefs.detectionConfig = config
        renderDetectionLabels(config)
        if (prefs.serviceEnabled) PocketAirplaneService.reloadConfig(this)
    }

    private fun renderDetectionLabels(config: DetectionConfig) {
        binding.labelEnterDelay.text = getString(R.string.label_enter_delay, config.enterDelayMs / 1000f)
        binding.labelExitDelay.text = getString(R.string.label_exit_delay, config.exitDelayMs / 1000f)
        binding.labelThreshold.text =
            getString(R.string.label_head_down_threshold, config.headDownEnterThreshold)
        binding.textProximityWarning.visibility =
            if (config.requireProximity) android.view.View.GONE else android.view.View.VISIBLE
    }

    private fun setUpActions() {
        binding.buttonAirplaneSettings.setOnClickListener {
            runCatching { startActivity(Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)) }
        }
        binding.buttonTestEnable.setOnClickListener { forceAirplaneMode(true) }
        binding.buttonTestDisable.setOnClickListener { forceAirplaneMode(false) }
        binding.buttonClearJournal.setOnClickListener { Journal.clear(this) }
    }

    private fun forceAirplaneMode(enabled: Boolean) = lifecycleScope.launch {
        val outcome = withContext(Dispatchers.IO) { controller.forceSet(enabled) }
        val verb = getString(
            if (enabled) R.string.log_verb_enable else R.string.log_verb_disable,
        )
        val message = when (outcome) {
            is AirplaneModeController.Outcome.Applied ->
                getString(R.string.log_applied, verb, outcome.strategyId)
            is AirplaneModeController.Outcome.Skipped ->
                getString(R.string.log_skipped, verb, outcome.reason)
            is AirplaneModeController.Outcome.Failed ->
                getString(R.string.log_failed, verb, outcome.reason)
            AirplaneModeController.Outcome.Unsupported ->
                getString(R.string.log_unsupported, verb)
        }
        Journal.log(this@MainActivity, message)
        AppState.update { it.copy(airplaneModeOn = controller.isAirplaneModeOn()) }
    }

    private fun observeState() = lifecycleScope.launch {
        repeatOnLifecycle(Lifecycle.State.STARTED) {
            AppState.status.collect { status ->
                bindingValues = true
                binding.switchService.isChecked = prefs.serviceEnabled
                bindingValues = false

                val phase = getString(
                    if (status.phase == PocketStateMachine.Phase.IN_POCKET) {
                        R.string.phase_in_pocket
                    } else {
                        R.string.phase_out_of_pocket
                    },
                )
                val airplane = getString(
                    if (status.airplaneModeOn) R.string.airplane_on else R.string.airplane_off,
                )
                binding.textPhase.text = getString(R.string.status_phase, phase, airplane)

                val unknown = getString(R.string.value_unknown)
                binding.textLive.text = getString(
                    R.string.status_live,
                    status.snapshot.gravityY?.let { String.format("%.1f", it) } ?: unknown,
                    status.snapshot.proximityNear?.let {
                        getString(if (it) R.string.value_near else R.string.value_far)
                    } ?: unknown,
                    status.snapshot.lightLux?.let { String.format("%.0f lx", it) } ?: unknown,
                )

                binding.textJournal.text = status.journal.joinToString("\n")
                    .ifBlank { getString(R.string.journal_empty) }
            }
        }
    }

    private fun renderMethod() {
        val strategy = controller.resolveStrategy()
        binding.textMethod.text = if (strategy != null) {
            getString(R.string.status_method_ok, getString(strategy.labelResId))
        } else {
            getString(R.string.status_method_missing)
        }

        val sensorManager = getSystemService(SENSOR_SERVICE) as android.hardware.SensorManager
        fun label(present: Boolean) =
            getString(if (present) R.string.value_present else R.string.value_absent)
        // La proximité passe par le même tri que la détection : annoncer « présent » un capteur
        // que le moniteur écarte (capteur de geste déguisé) laisserait croire à une panne.
        fun label(type: Int) = label(sensorManager.getDefaultSensor(type) != null)
        binding.textSensors.text = getString(
            R.string.status_sensors,
            label(android.hardware.Sensor.TYPE_ACCELEROMETER),
            label(sensorManager.usableProximitySensor() != null),
            label(android.hardware.Sensor.TYPE_LIGHT),
        )
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private companion object {
        const val HYSTERESIS_MARGIN = 3.0f
        const val MAX_EXIT_THRESHOLD = -0.5f
    }
}
