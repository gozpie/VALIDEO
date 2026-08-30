package com.gozpie.pocketairplane

import android.app.Application
import com.gozpie.pocketairplane.data.Journal
import com.gozpie.pocketairplane.service.Notifications

class PocketAirplaneApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        Journal.load(this)
    }
}
