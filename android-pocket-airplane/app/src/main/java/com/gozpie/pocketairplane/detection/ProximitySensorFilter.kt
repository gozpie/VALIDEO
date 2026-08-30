package com.gozpie.pocketairplane.detection

/**
 * Écarte les capteurs qui se déclarent `TYPE_PROXIMITY` sans mesurer la proximité d'un obstacle.
 *
 * Plusieurs constructeurs — Samsung en tête — exposent sous le type standard un capteur dédié à
 * un geste (paume au-dessus de l'écran, doigt sur la dalle) et réservent le vrai capteur physique
 * à un type propriétaire protégé par permission. Sur un Galaxy S23, `getDefaultSensor(TYPE_PROXIMITY)`
 * retourne ainsi « Palm Proximity Sensor version 2 », qui ne réagit qu'à un geste de paume écran
 * allumé : dans une poche il ne signale jamais rien, et la détection reste bloquée sans que rien
 * ne l'indique.
 *
 * Mieux vaut donc considérer qu'il n'y a pas de capteur de proximité — le service repasse alors en
 * orientation seule — que d'attendre indéfiniment un signal qui ne viendra pas.
 */
object ProximitySensorFilter {

    /**
     * Marqueurs d'un capteur de geste plutôt que d'un capteur de distance. Comparés en minuscules
     * sur le nom rapporté par le pilote.
     */
    private val GESTURE_MARKERS = listOf("palm", "touch", "grip", "iris", "gesture")

    /** Le capteur nommé [name] mesure-t-il la proximité d'un obstacle physique ? */
    fun isPhysicalProximity(name: String?): Boolean {
        val normalized = name?.lowercase()?.trim().orEmpty()
        if (normalized.isEmpty()) return false
        return GESTURE_MARKERS.none { normalized.contains(it) }
    }

    /**
     * Choisit le capteur à utiliser parmi [candidates], du plus au moins souhaitable.
     *
     * @param candidates couples (nom, réveil matériel) dans l'ordre rendu par le système.
     * @return l'index du capteur retenu, ou `null` si aucun n'est exploitable.
     */
    fun selectIndex(candidates: List<Pair<String?, Boolean>>): Int? {
        val usable = candidates.withIndex().filter { isPhysicalProximity(it.value.first) }
        if (usable.isEmpty()) return null
        // La variante « wake-up » continue d'émettre écran éteint : c'est tout l'intérêt en poche.
        return (usable.firstOrNull { it.value.second } ?: usable.first()).index
    }
}
