package com.gozpie.pocketairplane.data

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Journal d'événements horodaté, persistant, borné à [Prefs.JOURNAL_MAX_ENTRIES] entrées. */
object Journal {

    private val formatter = SimpleDateFormat("dd/MM HH:mm:ss", Locale.getDefault())

    @Synchronized
    fun log(context: Context, message: String) {
        val prefs = Prefs.get(context)
        val entry = "${formatter.format(Date())} — $message"
        val entries = (prefs.journal + entry).takeLast(Prefs.JOURNAL_MAX_ENTRIES)
        prefs.journal = entries
        AppState.update { it.copy(lastMessage = entry, journal = entries.asReversed()) }
    }

    fun load(context: Context) {
        val entries = Prefs.get(context).journal
        AppState.update { it.copy(journal = entries.asReversed(), lastMessage = entries.lastOrNull()) }
    }

    fun clear(context: Context) {
        Prefs.get(context).journal = emptyList()
        AppState.update { it.copy(journal = emptyList(), lastMessage = null) }
    }
}
