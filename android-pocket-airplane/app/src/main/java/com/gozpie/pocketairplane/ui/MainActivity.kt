package com.gozpie.pocketairplane.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.annotation.SuppressLint
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.color.MaterialColors
import com.gozpie.pocketairplane.R
import com.gozpie.pocketairplane.airplane.AirplaneModeController
import com.gozpie.pocketairplane.data.AppState
import com.gozpie.pocketairplane.data.Journal
import com.gozpie.pocketairplane.data.Prefs
import com.gozpie.pocketairplane.databinding.ActivityMainBinding
import com.gozpie.pocketairplane.databinding.PageControlBinding
import com.gozpie.pocketairplane.databinding.PageJournalBinding
import com.gozpie.pocketairplane.databinding.PageSettingsBinding
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
    private lateinit var control: PageControlBinding
    private lateinit var settings: PageSettingsBinding
    private lateinit var journal: PageJournalBinding
    private lateinit var prefs: Prefs
    private lateinit var controller: AirplaneModeController

    /** Empêche les écouteurs de réagir aux valeurs posées par le code. */
    private var bindingValues = false

    /** Dernière phase connue, pour redessiner le bouton sans attendre un événement capteur. */
    private var lastPhase = PocketStateMachine.Phase.OUT_OF_POCKET

    /** Un capteur de proximité utilisable existe-t-il ? Détermine si le réglage a un sens. */
    private var hasUsableProximity = true

    /** Sans root ni permission ADB, l'application ne peut rien basculer : il faut le dire. */
    private var hasToggleMethod = true

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* rien à faire */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // L'application est sombre même si le système est en thème clair : les barres doivent
        // suivre, sinon la barre de navigation reste blanche sous un écran noir.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        val inflater = LayoutInflater.from(this)
        control = PageControlBinding.inflate(inflater)
        settings = PageSettingsBinding.inflate(inflater)
        journal = PageJournalBinding.inflate(inflater)

        prefs = Prefs.get(this)
        controller = AirplaneModeController(this)

        setUpPager()
        Journal.load(this)
        setUpPowerButton()
        setUpDetectionSettings()
        setUpActions()
        observeState()
    }

    override fun onResume() {
        super.onResume()
        AppState.update { it.copy(airplaneModeOn = controller.isAirplaneModeOn()) }
        renderMethod()
        renderPowerButton()
    }

    private fun setUpPager() {
        val pages = listOf(control.root, settings.root, journal.root)
        binding.pager.adapter = PagesAdapter(pages)
        // Trois pages seulement : les garder vivantes évite de reconstruire les liaisons au balayage.
        binding.pager.offscreenPageLimit = pages.size - 1
        binding.pager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) = renderDots(position)
        })
        renderDots(0)
    }

    private fun renderDots(selected: Int) {
        listOf(binding.dot0, binding.dot1, binding.dot2).forEachIndexed { index, dot ->
            dot.setBackgroundResource(if (index == selected) R.drawable.dot_active else R.drawable.dot)
        }
    }

    private fun setUpPowerButton() {
        control.buttonPower.setOnClickListener {
            if (prefs.serviceEnabled) {
                PocketAirplaneService.stop(this)
            } else {
                requestNotificationPermissionIfNeeded()
                PocketAirplaneService.start(this)
            }
            // L'état réel remonte via AppState ; on redessine tout de suite pour que le bouton
            // réponde au doigt sans attendre le démarrage du service.
            control.buttonPower.postDelayed(::renderPowerButton, 150)
        }
    }

    /** Le bouton porte à lui seul l'état : arrêté, en veille active, ou téléphone rangé. */
    private fun renderPowerButton() {
        val running = prefs.serviceEnabled
        val inPocket = running && lastPhase == PocketStateMachine.Phase.IN_POCKET

        control.buttonPower.text = getString(
            when {
                !running -> R.string.power_off
                inPocket -> R.string.power_in_pocket
                else -> R.string.power_on
            },
        )

        val backgroundAttr = when {
            !running -> com.google.android.material.R.attr.colorSurfaceVariant
            inPocket -> com.google.android.material.R.attr.colorTertiaryContainer
            else -> com.google.android.material.R.attr.colorPrimaryContainer
        }
        val foregroundAttr = when {
            !running -> com.google.android.material.R.attr.colorOnSurfaceVariant
            inPocket -> com.google.android.material.R.attr.colorOnTertiaryContainer
            else -> com.google.android.material.R.attr.colorOnPrimaryContainer
        }

        control.textPhase.setText(
            when {
                !hasToggleMethod -> R.string.state_no_method
                !running -> R.string.state_idle
                inPocket -> R.string.state_in_pocket
                else -> R.string.state_watching
            },
        )

        val background = MaterialColors.getColor(control.buttonPower, backgroundAttr)
        val foreground = MaterialColors.getColor(control.buttonPower, foregroundAttr)
        control.buttonPower.backgroundTintList = android.content.res.ColorStateList.valueOf(background)
        control.buttonPower.setTextColor(foreground)
        control.buttonPower.iconTint = android.content.res.ColorStateList.valueOf(foreground)
    }

    @SuppressLint("ClickableViewAccessibility") // on ne consomme pas l'événement, le curseur reste accessible
    private fun setUpDetectionSettings() {
        val sensorManager = getSystemService(SENSOR_SERVICE) as android.hardware.SensorManager
        hasUsableProximity = sensorManager.usableProximitySensor() != null
        // Laisser cocher une exigence que le service ignorera ferait croire à une panne : le
        // réglage est neutralisé et la raison affichée.
        settings.switchProximity.isEnabled = hasUsableProximity

        val config = prefs.detectionConfig
        bindingValues = true
        settings.switchProximity.isChecked = config.requireProximity
        settings.switchDarkness.isChecked = config.requireDarkness
        settings.sliderEnterDelay.value = (config.enterDelayMs / 1000f).coerceIn(0.5f, 15f)
        settings.sliderExitDelay.value = (config.exitDelayMs / 1000f).coerceIn(0.5f, 15f)
        settings.sliderThreshold.value = config.headDownEnterThreshold.coerceIn(-9.5f, -1f)
        bindingValues = false
        renderDetectionLabels(config)

        settings.switchProximity.setOnCheckedChangeListener { _, _ -> saveDetectionConfig() }
        settings.switchDarkness.setOnCheckedChangeListener { _, _ -> saveDetectionConfig() }
        listOf(settings.sliderEnterDelay, settings.sliderExitDelay, settings.sliderThreshold)
            .forEach { slider ->
                slider.addOnChangeListener { _, _, fromUser -> if (fromUser) saveDetectionConfig() }
                // Curseurs et pager glissent tous deux à l'horizontale : sans ça, le balayage vole
                // le geste et les réglages deviennent impossibles à ajuster au doigt.
                //
                // On demande au parent de ne pas intercepter, plutôt que de couper l'entrée du
                // pager : ce drapeau est remis à zéro par le framework à la fin du geste, y compris
                // sur une annulation. Couper `isUserInputEnabled` laissait la navigation bloquée
                // pour de bon dès qu'un geste sur un curseur était annulé au lieu d'être relâché.
                slider.setOnTouchListener { view, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE ->
                            view.parent?.requestDisallowInterceptTouchEvent(true)
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                            view.parent?.requestDisallowInterceptTouchEvent(false)
                    }
                    // Ne consomme rien : le curseur traite l'événement comme d'habitude.
                    false
                }
            }
    }

    private fun saveDetectionConfig() {
        if (bindingValues) return
        val enterThreshold = settings.sliderThreshold.value
        val config = DetectionConfig(
            headDownEnterThreshold = enterThreshold,
            // Hystérésis fixe de 3 m/s² : évite les oscillations autour de l'horizontale.
            headDownExitThreshold = min(enterThreshold + HYSTERESIS_MARGIN, MAX_EXIT_THRESHOLD),
            requireProximity = settings.switchProximity.isChecked,
            requireDarkness = settings.switchDarkness.isChecked,
            enterDelayMs = (settings.sliderEnterDelay.value * 1000).toLong(),
            exitDelayMs = (settings.sliderExitDelay.value * 1000).toLong(),
        )
        prefs.detectionConfig = config
        renderDetectionLabels(config)
        if (prefs.serviceEnabled) PocketAirplaneService.reloadConfig(this)
    }

    private fun renderDetectionLabels(config: DetectionConfig) {
        settings.labelEnterDelay.text = getString(R.string.label_enter_delay, config.enterDelayMs / 1000f)
        settings.labelExitDelay.text = getString(R.string.label_exit_delay, config.exitDelayMs / 1000f)
        settings.labelThreshold.text = getString(
            R.string.label_head_down_threshold,
            getString(
                // Le seuil est une accélération ; l'utilisateur, lui, raisonne en « penché comment ».
                when {
                    config.headDownEnterThreshold >= -3.5f -> R.string.tilt_slight
                    config.headDownEnterThreshold >= -7.0f -> R.string.tilt_medium
                    else -> R.string.tilt_strong
                },
            ),
        )
        settings.textProximityWarning.setText(
            if (hasUsableProximity) R.string.warning_no_proximity
            else R.string.warning_proximity_unavailable,
        )
        settings.textProximityWarning.visibility =
            if (hasUsableProximity && config.requireProximity) View.GONE else View.VISIBLE
    }

    private fun setUpActions() {
        settings.buttonAirplaneSettings.setOnClickListener {
            runCatching { startActivity(Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)) }
        }
        journal.buttonTestEnable.setOnClickListener { forceAirplaneMode(true) }
        journal.buttonTestDisable.setOnClickListener { forceAirplaneMode(false) }
        journal.buttonClearJournal.setOnClickListener { Journal.clear(this) }
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
                lastPhase = status.phase
                renderPowerButton()

                val unknown = getString(R.string.value_unknown)
                journal.textLive.text = getString(
                    R.string.status_live,
                    status.snapshot.gravityY?.let { String.format("%.1f", it) } ?: unknown,
                    status.snapshot.proximityNear?.let {
                        getString(if (it) R.string.value_near else R.string.value_far)
                    } ?: unknown,
                    status.snapshot.lightLux?.let { String.format("%.0f lx", it) } ?: unknown,
                )

                journal.textJournal.text = status.journal.joinToString("\n")
                    .ifBlank { getString(R.string.journal_empty) }
            }
        }
    }

    private fun renderMethod() {
        val strategy = controller.resolveStrategy()
        hasToggleMethod = strategy != null
        settings.textMethod.text = if (strategy != null) {
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
        settings.textSensors.text = getString(
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

    /**
     * Pages fixes et peu nombreuses : chacune a son propre type de vue, ce qui interdit au
     * `RecyclerView` sous-jacent de les recycler l'une pour l'autre et laisse les liaisons valides.
     */
    private class PagesAdapter(private val pages: List<View>) :
        RecyclerView.Adapter<PagesAdapter.PageHolder>() {

        class PageHolder(container: FrameLayout) : RecyclerView.ViewHolder(container)

        override fun getItemCount() = pages.size

        override fun getItemViewType(position: Int) = position

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageHolder {
            val container = FrameLayout(parent.context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }
            val page = pages[viewType]
            (page.parent as? ViewGroup)?.removeView(page)
            container.addView(page)
            return PageHolder(container)
        }

        override fun onBindViewHolder(holder: PageHolder, position: Int) = Unit
    }

    private companion object {
        const val HYSTERESIS_MARGIN = 3.0f
        const val MAX_EXIT_THRESHOLD = -0.5f
    }
}
