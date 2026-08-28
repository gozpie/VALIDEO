package com.gozpie.pocketairplane.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.gozpie.pocketairplane.detection.DetectionConfig

/** Accès typé aux préférences de l'application. */
class Prefs private constructor(private val prefs: SharedPreferences) {

    /** L'utilisateur a-t-il activé l'automatisation ? */
    var serviceEnabled: Boolean
        get() = prefs.getBoolean(KEY_SERVICE_ENABLED, false)
        set(value) = prefs.edit { putBoolean(KEY_SERVICE_ENABLED, value) }

    /**
     * Le mode avion actuellement actif a-t-il été enclenché par l'application ?
     * Garde-fou : on ne coupe jamais un mode avion activé manuellement par l'utilisateur.
     */
    var airplaneEnabledByApp: Boolean
        get() = prefs.getBoolean(KEY_ENABLED_BY_APP, false)
        set(value) = prefs.edit { putBoolean(KEY_ENABLED_BY_APP, value) }

    var detectionConfig: DetectionConfig
        get() = DetectionConfig(
            headDownEnterThreshold = prefs.getFloat(KEY_HEAD_DOWN_ENTER, DetectionConfig.DEFAULT_HEAD_DOWN_ENTER),
            headDownExitThreshold = prefs.getFloat(KEY_HEAD_DOWN_EXIT, DetectionConfig.DEFAULT_HEAD_DOWN_EXIT),
            requireProximity = prefs.getBoolean(KEY_REQUIRE_PROXIMITY, true),
            requireDarkness = prefs.getBoolean(KEY_REQUIRE_DARKNESS, false),
            darknessLuxThreshold = prefs.getFloat(KEY_DARKNESS_LUX, DetectionConfig.DEFAULT_DARKNESS_LUX),
            enterDelayMs = prefs.getLong(KEY_ENTER_DELAY, DetectionConfig.DEFAULT_ENTER_DELAY_MS),
            exitDelayMs = prefs.getLong(KEY_EXIT_DELAY, DetectionConfig.DEFAULT_EXIT_DELAY_MS),
        )
        set(value) = prefs.edit {
            putFloat(KEY_HEAD_DOWN_ENTER, value.headDownEnterThreshold)
            putFloat(KEY_HEAD_DOWN_EXIT, value.headDownExitThreshold)
            putBoolean(KEY_REQUIRE_PROXIMITY, value.requireProximity)
            putBoolean(KEY_REQUIRE_DARKNESS, value.requireDarkness)
            putFloat(KEY_DARKNESS_LUX, value.darknessLuxThreshold)
            putLong(KEY_ENTER_DELAY, value.enterDelayMs)
            putLong(KEY_EXIT_DELAY, value.exitDelayMs)
        }

    var journal: List<String>
        get() = prefs.getString(KEY_JOURNAL, null)
            ?.split(JOURNAL_SEPARATOR)
            ?.filter { it.isNotBlank() }
            ?: emptyList()
        set(value) = prefs.edit {
            putString(KEY_JOURNAL, value.takeLast(JOURNAL_MAX_ENTRIES).joinToString(JOURNAL_SEPARATOR))
        }

    companion object {
        private const val FILE_NAME = "poche_avion"
        private const val KEY_SERVICE_ENABLED = "service_enabled"
        private const val KEY_ENABLED_BY_APP = "airplane_enabled_by_app"
        private const val KEY_HEAD_DOWN_ENTER = "head_down_enter"
        private const val KEY_HEAD_DOWN_EXIT = "head_down_exit"
        private const val KEY_REQUIRE_PROXIMITY = "require_proximity"
        private const val KEY_REQUIRE_DARKNESS = "require_darkness"
        private const val KEY_DARKNESS_LUX = "darkness_lux"
        private const val KEY_ENTER_DELAY = "enter_delay_ms"
        private const val KEY_EXIT_DELAY = "exit_delay_ms"
        private const val KEY_JOURNAL = "journal"

        private const val JOURNAL_SEPARATOR = "\n"
        const val JOURNAL_MAX_ENTRIES = 50

        @Volatile
        private var instance: Prefs? = null

        fun get(context: Context): Prefs = instance ?: synchronized(this) {
            instance ?: Prefs(
                context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE),
            ).also { instance = it }
        }
    }
}
