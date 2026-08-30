package com.gozpie.pocketairplane.airplane

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log

/** Issue d'une tentative de bascule du mode avion. */
sealed class AirplaneResult {
    data class Success(val strategyId: String) : AirplaneResult()
    data class Failure(val reason: String) : AirplaneResult()
}

/**
 * Moyen concret de basculer le mode avion.
 *
 * Android interdit aux applications tierces d'écrire `Settings.Global.AIRPLANE_MODE_ON` depuis
 * l'API 17 : il faut soit le root, soit la permission système `WRITE_SECURE_SETTINGS` octroyée
 * une fois par ADB. D'où ces deux implémentations.
 */
interface AirplaneModeStrategy {
    /** Identifiant technique, journalisé et affiché dans l'interface. */
    val id: String

    /** Libellé lisible par l'utilisateur. */
    val labelResId: Int

    /** La stratégie est-elle utilisable sur cet appareil, en l'état ? */
    fun isAvailable(context: Context): Boolean

    fun setAirplaneMode(context: Context, enabled: Boolean): AirplaneResult
}

/** Bascule via `su`. Solution la plus fiable, réservée aux appareils rootés. */
object RootStrategy : AirplaneModeStrategy {

    private const val TAG = "RootStrategy"

    override val id = "root"
    override val labelResId = com.gozpie.pocketairplane.R.string.strategy_root

    override fun isAvailable(context: Context): Boolean = ShellRunner.isSuBinaryPresent()

    override fun setAirplaneMode(context: Context, enabled: Boolean): AirplaneResult {
        // Android 11+ : commande dédiée, qui applique aussi l'effet radio.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val verb = if (enabled) "enable" else "disable"
            val result = ShellRunner.runAsRoot("cmd connectivity airplane-mode $verb")
            if (result.isSuccess) return AirplaneResult.Success(id)
            Log.w(TAG, "cmd connectivity indisponible (${result.output}), repli sur settings put")
        }

        // Repli historique : écriture du réglage puis diffusion de l'intent système.
        val value = if (enabled) 1 else 0
        val state = if (enabled) "true" else "false"
        val result = ShellRunner.runAsRoot(
            "settings put global airplane_mode_on $value; " +
                "am broadcast -a android.intent.action.AIRPLANE_MODE --ez state $state",
        )
        return if (result.isSuccess) {
            AirplaneResult.Success(id)
        } else {
            AirplaneResult.Failure("su a échoué : ${result.output.ifBlank { "code ${result.exitCode}" }}")
        }
    }
}

/**
 * Bascule via la permission système [Manifest.permission.WRITE_SECURE_SETTINGS], octroyée
 * une seule fois depuis un PC :
 * `adb shell pm grant com.gozpie.pocketairplane android.permission.WRITE_SECURE_SETTINGS`
 */
object SecureSettingsStrategy : AirplaneModeStrategy {

    private const val TAG = "SecureSettingsStrategy"

    override val id = "write_secure_settings"
    override val labelResId = com.gozpie.pocketairplane.R.string.strategy_secure_settings

    override fun isAvailable(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) ==
            PackageManager.PERMISSION_GRANTED

    override fun setAirplaneMode(context: Context, enabled: Boolean): AirplaneResult {
        return try {
            Settings.Global.putInt(
                context.contentResolver,
                Settings.Global.AIRPLANE_MODE_ON,
                if (enabled) 1 else 0,
            )
            // La diffusion de l'intent est réservée au système : on tente, sans en dépendre.
            // Sur Android 8+, les couches radio observent directement le réglage.
            runCatching {
                context.sendBroadcast(
                    Intent(Intent.ACTION_AIRPLANE_MODE_CHANGED).putExtra("state", enabled),
                )
            }.onFailure { Log.d(TAG, "Diffusion de l'intent refusée (comportement attendu).", it) }
            AirplaneResult.Success(id)
        } catch (e: SecurityException) {
            AirplaneResult.Failure("permission WRITE_SECURE_SETTINGS refusée : ${e.message}")
        } catch (e: Exception) {
            AirplaneResult.Failure("écriture du réglage impossible : ${e.message}")
        }
    }
}
