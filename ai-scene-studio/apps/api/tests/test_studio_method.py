"""Consignes du studio confiées à Claude : méthode réalisateur / chef-op et schémas de réponse."""

from ass_api.ai.providers.claude import ClaudeProvider
from ass_api.ai.providers.claude_studio import (
    BIBLE_SCHEMA,
    BREAKDOWN_SCHEMA,
    SHOT_PROMPTS_SCHEMA,
    studio_task,
)


def test_breakdown_follows_the_six_written_steps_before_the_shots() -> None:
    prompt, schema = studio_task("script_breakdown", ["script.md"], "Projet « Le phare »", "")
    assert schema is BREAKDOWN_SCHEMA
    # Persona chef-op, méthode réalisateur et description professionnelle de chaque plan.
    assert "CHEF OPÉRATEUR IMAGE" in prompt
    assert "6. CONTRÔLE QUALITÉ + VERSION OPTIMISÉE" in prompt
    assert "UN PLAN = UNE SEULE IMAGE FIXE" in prompt
    assert "**Mise en place (blocking)**" in prompt
    assert "script.md" in prompt and "Projet « Le phare »" in prompt
    # Le brouillon (6 étapes) précède la version optimisée dans le JSON imposé.
    assert list(schema["properties"]) == ["method", "sequences"]
    steps = schema["properties"]["method"]["required"]
    assert steps == [
        "intention",
        "dramaturgy",
        "beats",
        "staging",
        "cinematography",
        "draft",
        "qualityControl",
    ]


def test_bible_and_shot_prompts_tasks() -> None:
    prompt, schema = studio_task("bible_from_script", ["script.md"], "", "garde 3 personnages")
    assert schema is BIBLE_SCHEMA and "casting non retouchée" in prompt
    assert "garde 3 personnages" in prompt
    prompt, schema = studio_task("shot_prompts", ["plan.md", "bible.md"], "", "")
    assert schema is SHOT_PROMPTS_SCHEMA
    assert "LOOK (fixed for the whole film)" in prompt
    assert "HARD CUT" in prompt
    assert "« 18 modules »" not in prompt


def test_claude_declares_studio_modes() -> None:
    modes = ClaudeProvider("claude", "jeton").get_capabilities()[0].modes
    assert {"script_breakdown", "bible_from_script", "shot_prompts"} <= set(modes)


def test_bible_names_match_tolerantly() -> None:
    import uuid

    from ass_api.db.models import BibleEntry
    from ass_api.routes.studio import match_entry, normalize_name

    assert normalize_name("INT. SALLE DE LA LANTERNE — NUIT") == "salle de la lanterne"
    assert normalize_name("MARC") == "marc"
    entries = [
        BibleEntry(id=uuid.uuid4(), kind="set", name=name)
        for name in ("Salle de la lanterne", "Mer en tempête", "Escalier du phare")
    ]
    salle, mer, escalier = (e.id for e in entries)
    assert match_entry(entries, "INT. SALLE DE LA LANTERNE — NUIT") == salle
    assert match_entry(entries, "mer en tempete") == mer
    assert match_entry(entries, "Mer") == mer  # contenu dans un seul nom
    assert match_entry(entries, "phare") == escalier
    assert match_entry(entries, "Cuisine") is None
    entries.append(BibleEntry(id=uuid.uuid4(), kind="set", name="Phare de Ker-an"))
    assert match_entry(entries, "phare") is None  # ambigu : aucun lien plutôt qu'un faux
