package com.gozpie.pocketairplane.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.gozpie.pocketairplane.data.Prefs

/** Relance la surveillance après un redémarrage ou une mise à jour de l'application. */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!Prefs.get(context).serviceEnabled) return
        PocketAirplaneService.start(context)
    }
}
