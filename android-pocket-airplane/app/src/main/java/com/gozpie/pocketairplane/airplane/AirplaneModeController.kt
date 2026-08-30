package com.gozpie.pocketairplane.airplane

import android.content.Context
import android.provider.Settings
import android.util.Log
import com.gozpie.pocketairplane.data.Prefs

/**
 * Point d'entrée unique pour lire et modifier l'état du mode avion.
 *
 * Les stratégies sont essayées dans l'ordre de fiabilité décroissante. Aucune n'étant disponible
 * sur un appareil standard non rooté, l'application le signale explicitement plutôt que d'échouer
 * silencieusement.
 */
class AirplaneModeController(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = Prefs.get(appContext)

    private val strategies = listOf(RootStrategy, SecureSettingsStrategy)

    /** Première stratégie utilisable, ou `null` si l'appareil ne permet aucune bascule automatique. */
    fun resolveStrategy(): AirplaneModeStrategy? = strategies.firstOrNull { it.isAvailable(appContext) }

    /** Lecture de l'état réel du mode avion (accessible à toute application). */
    fun isAirplaneModeOn(): Boolean =
        Settings.Global.getInt(appContext.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1

    /**
     * Active le mode avion.
     *
     * Si le mode avion est déjà actif, on ne s'en attribue pas la responsabilité : il ne sera donc
     * pas coupé à la sortie de poche.
     */
    fun enable(): Outcome {
        if (isAirplaneModeOn()) {
            prefs.airplaneEnabledByApp = false
            return Outcome.Skipped("mode avion déjà actif")
        }
        return apply(enabled = true).also { outcome ->
            if (outcome is Outcome.Applied) prefs.airplaneEnabledByApp = true
        }
    }

    /** Coupe le mode avion, uniquement s'il a été activé par l'application. */
    fun disable(): Outcome {
        if (!isAirplaneModeOn()) {
            prefs.airplaneEnabledByApp = false
            return Outcome.Skipped("mode avion déjà inactif")
        }
        if (!prefs.airplaneEnabledByApp) {
            return Outcome.Skipped("mode avion activé manuellement : non modifié")
        }
        return apply(enabled = false).also { outcome ->
            if (outcome is Outcome.Applied) prefs.airplaneEnabledByApp = false
        }
    }

    /** Bascule manuelle depuis l'interface, sans garde-fou de propriété. */
    fun forceSet(enabled: Boolean): Outcome = apply(enabled).also { outcome ->
        if (outcome is Outcome.Applied) prefs.airplaneEnabledByApp = enabled
    }

    private fun apply(enabled: Boolean): Outcome {
        val strategy = resolveStrategy() ?: return Outcome.Unsupported
        return when (val result = strategy.setAirplaneMode(appContext, enabled)) {
            is AirplaneResult.Success -> Outcome.Applied(result.strategyId, enabled)
            is AirplaneResult.Failure -> {
                Log.w(TAG, "Bascule du mode avion impossible : ${result.reason}")
                Outcome.Failed(result.reason)
            }
        }
    }

    /** Issue d'une demande de bascule, du point de vue métier. */
    sealed class Outcome {
        data class Applied(val strategyId: String, val enabled: Boolean) : Outcome()
        data class Skipped(val reason: String) : Outcome()
        data class Failed(val reason: String) : Outcome()
        object Unsupported : Outcome()
    }

    private companion object {
        const val TAG = "AirplaneModeController"
    }
}
