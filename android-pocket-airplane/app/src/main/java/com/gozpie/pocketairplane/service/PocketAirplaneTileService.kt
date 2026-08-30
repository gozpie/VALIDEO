package com.gozpie.pocketairplane.service

import android.graphics.drawable.Icon
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.gozpie.pocketairplane.R
import com.gozpie.pocketairplane.data.Prefs

/** Tuile des réglages rapides pour activer/désactiver la surveillance d'un geste. */
class PocketAirplaneTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        refreshTile()
    }

    override fun onClick() {
        super.onClick()
        val prefs = Prefs.get(this)
        if (prefs.serviceEnabled) {
            PocketAirplaneService.stop(this)
        } else {
            PocketAirplaneService.start(this)
        }
        refreshTile()
    }

    private fun refreshTile() {
        val tile = qsTile ?: return
        val enabled = Prefs.get(this).serviceEnabled
        tile.state = if (enabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(R.string.app_name)
        tile.icon = Icon.createWithResource(this, R.drawable.ic_airplane)
        tile.updateTile()
    }
}
