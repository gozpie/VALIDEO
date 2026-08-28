package com.gozpie.pocketairplane.airplane

import android.os.Build
import android.util.Log
import java.io.File
import java.util.concurrent.TimeUnit

/** Résultat d'exécution d'une commande shell. */
data class ShellResult(val exitCode: Int, val output: String) {
    val isSuccess: Boolean get() = exitCode == 0
}

/** Exécution de commandes shell, avec ou sans élévation root. */
object ShellRunner {

    private const val TAG = "ShellRunner"
    private const val DEFAULT_TIMEOUT_SECONDS = 10L

    private val SU_PATHS = listOf(
        "/system/bin/su",
        "/system/xbin/su",
        "/sbin/su",
        "/su/bin/su",
        "/system/sbin/su",
        "/vendor/bin/su",
        "/debug_ramdisk/su",
    )

    /** Le binaire `su` est-il présent ? N'ouvre aucune boîte de dialogue d'autorisation. */
    fun isSuBinaryPresent(): Boolean = SU_PATHS.any { runCatching { File(it).exists() }.getOrDefault(false) }

    /** Exécute une commande via `su -c`. Peut déclencher la demande d'autorisation root. */
    fun runAsRoot(command: String): ShellResult = exec(listOf("su", "-c", command))

    private fun exec(command: List<String>): ShellResult {
        return try {
            val process = ProcessBuilder(command).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            val exitCode = waitFor(process)
            ShellResult(exitCode, output.trim())
        } catch (e: Exception) {
            Log.w(TAG, "Échec d'exécution de $command", e)
            ShellResult(exitCode = -1, output = e.message.orEmpty())
        }
    }

    private fun waitFor(process: Process): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (process.waitFor(DEFAULT_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.exitValue()
            } else {
                process.destroy()
                -1
            }
        } else {
            process.waitFor()
        }
}
