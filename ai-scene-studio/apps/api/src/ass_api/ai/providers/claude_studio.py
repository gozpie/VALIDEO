"""Tâches du studio de production confiées à Claude : découpage, bible, prompts de plan.

Chaque tâche endosse la méthode réalisateur / chef opérateur de VALIDEO (`ai/method.py`). Les
documents (script, bible, contexte du plan) sont écrits dans le dossier de travail et lus par
Claude avec l'outil Read ; la réponse suit un schéma JSON imposé. Pour le découpage, les 6 étapes
de la méthode sont des champs du JSON placés AVANT les séquences : Claude les rédige réellement
avant de produire la version optimisée, seule retenue.
"""

from typing import Any, Final

from ass_api.ai.method import (
    DIRECTOR_METHOD,
    LAYERED_IMAGE_FORMAT,
    MULTISHOT_VIDEO_FORMAT,
    SCRIPT_GROUNDING,
    SHOT_TEXT_SPEC,
    chef_op_persona,
)

STUDIO_MODES: Final = frozenset({"script_breakdown", "bible_from_script", "shot_prompts"})
APPROACHES: Final = ["image_to_video", "multishot", "text_to_video", "still", "scene_3d"]

_TEXT: Final = {"type": "string"}
_NAMES: Final = {"type": "array", "items": {"type": "string"}, "maxItems": 20}

BREAKDOWN_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "method": {
            "type": "object",
            "description": "Brouillon de travail du réalisateur, rédigé AVANT le découpage final",
            "properties": {
                "intention": {**_TEXT, "description": "L'intention du film en une phrase"},
                "dramaturgy": {**_TEXT, "description": "1. Analyse dramaturgique"},
                "beats": {**_TEXT, "description": "2. Battements (sans plans)"},
                "staging": {**_TEXT, "description": "3. Stratégie de mise en scène"},
                "cinematography": {**_TEXT, "description": "4. Chef-op"},
                "draft": {**_TEXT, "description": "5. Découpage brouillon, une ligne par plan"},
                "qualityControl": {
                    **_TEXT,
                    "description": "6. Contrôle qualité : défauts trouvés et corrections",
                },
            },
            "required": [
                "intention",
                "dramaturgy",
                "beats",
                "staging",
                "cinematography",
                "draft",
                "qualityControl",
            ],
        },
        "sequences": {
            "type": "array",
            "description": "VERSION OPTIMISÉE du découpage (après contrôle qualité)",
            "maxItems": 40,
            "items": {
                "type": "object",
                "properties": {
                    "name": _TEXT,
                    "intention": _TEXT,
                    "shots": {
                        "type": "array",
                        "maxItems": 60,
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {**_TEXT, "description": "Titre court du plan"},
                                "shotSize": {
                                    **_TEXT,
                                    "description": "Valeur de plan (gros plan, plan large…)",
                                },
                                "camera": {
                                    **_TEXT,
                                    "description": "Angle, hauteur, mouvement, focale",
                                },
                                "durationSeconds": {
                                    "type": "number",
                                    "minimum": 0.5,
                                    "maximum": 60,
                                },
                                "description": {
                                    **_TEXT,
                                    "description": "Description professionnelle (Markdown)",
                                },
                                "intention": _TEXT,
                                "dialogue": {**_TEXT, "description": "Répliques ou voix off"},
                                "approach": {"type": "string", "enum": APPROACHES},
                                "characters": _NAMES,
                                "sets": _NAMES,
                                "props": _NAMES,
                            },
                            "required": [
                                "name",
                                "shotSize",
                                "camera",
                                "durationSeconds",
                                "description",
                                "intention",
                                "dialogue",
                                "approach",
                                "characters",
                                "sets",
                                "props",
                            ],
                        },
                    },
                },
                "required": ["name", "intention", "shots"],
            },
        },
    },
    "required": ["method", "sequences"],
}

_ENTRY: Final = {
    "type": "object",
    "properties": {
        "name": {**_TEXT, "description": "Nom exact, tel qu'il apparaît dans le script"},
        "description": {**_TEXT, "description": "Fiche en français (rôle, traits, époque)"},
        "prompt": {
            **_TEXT,
            "description": "Description visuelle en anglais, réutilisable dans les prompts",
        },
    },
    "required": ["name", "description", "prompt"],
}
BIBLE_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "look": {
            **_ENTRY,
            "description": "LOOK du film : prompt = bloc LOOK anglais commun à toutes les images",
        },
        "characters": {"type": "array", "items": _ENTRY, "maxItems": 40},
        "sets": {"type": "array", "items": _ENTRY, "maxItems": 40},
        "props": {"type": "array", "items": _ENTRY, "maxItems": 40},
    },
    "required": ["look", "characters", "sets", "props"],
}
SHOT_PROMPTS_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "imagePrompt": {**_TEXT, "description": "Prompt image par couches, en anglais"},
        "videoPrompt": {**_TEXT, "description": "Prompt vidéo (Seedance), en anglais"},
        "negativePrompt": _TEXT,
        "notes": {**_TEXT, "description": "Conseils de fabrication en français"},
    },
    "required": ["imagePrompt", "videoPrompt", "negativePrompt", "notes"],
}

_BREAKDOWN_TASK: Final = """\
{persona}

{director}

{grounding}

TÂCHE : découper le film en séquences et en plans.
Documents dans le dossier courant : {files}.
{brief}
Rédige d'abord les 6 étapes de la méthode dans les champs « method » (prose concise, notes de
travail), PUIS la version optimisée dans « sequences ». Pour chaque plan :
{spec}
- approach : image_to_video (image clé puis animation, défaut), multishot (vidéo multiplan minutée
  pour une rafale d'action), text_to_video, still (image fixe), scene_3d (plan qui exige une
  géographie ou un mouvement de caméra précis : scène 3D).
- characters / sets / props : noms exacts des personnages, décors et accessoires visibles, tels
  qu'écrits dans la bible si elle est fournie (sinon dans le script).
- durationSeconds réaliste pour le montage.
Consigne de l'utilisateur : {intent}"""

_BIBLE_TASK: Final = """\
{persona}

{grounding}

TÂCHE : établir la bible de production du film à partir du script.
Documents dans le dossier courant : {files}.
{brief}
- look : le LOOK du film (pellicule, optiques, grain, palette, contraste) ; « prompt » = bloc LOOK
  en anglais recopié tel quel en tête de chaque prompt d'image. Pas de HDR, « dramatic »,
  « rich colours », teal-orange.
- NOMS : le nom d'un personnage s'écrit en casse normale (« Marc », jamais « MARC ») ; un décor
  porte le nom court du lieu (« Salle de la lanterne »), jamais l'intitulé de scène (« INT. … —
  NUIT ») ; si decoupage.md est fourni, reprends EXACTEMENT les noms qu'il utilise.
- characters : chaque personnage qui apparaît à l'image. « prompt » décrit une vraie photo de
  casting non retouchée (âge, origine, faciès, carnation, peau texturée, cheveux, costume
  d'époque usé), en anglais.
- sets : chaque décor (lieu, époque, matières, échelle, lumière naturelle dominante).
- props : uniquement les accessoires qui portent l'histoire (forme décrite, pas un nom ambigu).
N'invente aucun élément absent du script. Consigne de l'utilisateur : {intent}"""

_SHOT_TASK: Final = """\
{persona}

TÂCHE : écrire les prompts de génération du plan décrit dans plan.md (contexte de la séquence,
plans voisins, éléments de bible et LOOK inclus). Documents : {files}.
{brief}
{image_format}

{video_format}

Garde-fous : 1 plan = 1 image fixe (pas de rafale déguisée) ; placements et sens de regard décrits
concrètement (jamais « 180° » ni « contrechamp ») ; personnage de dos ou en amorce écrit
explicitement ; les images de référence des éléments de bible sont @image1, @image2… dans l'ordre
indiqué dans plan.md. negativePrompt : rendu CGI, 3D, jeu vidéo, peau plastique, pose raide, bras
ballants, texte, logo. Consigne de l'utilisateur : {intent}"""


def studio_task(mode: str, files: list[str], brief: str, intent: str) -> tuple[str, dict[str, Any]]:
    values = {
        "persona": chef_op_persona(),
        "director": DIRECTOR_METHOD,
        "grounding": SCRIPT_GROUNDING,
        "spec": SHOT_TEXT_SPEC,
        "image_format": LAYERED_IMAGE_FORMAT,
        "video_format": MULTISHOT_VIDEO_FORMAT,
        "files": ", ".join(files) or "aucun",
        "brief": brief,
        "intent": intent or "(aucune précision)",
    }
    if mode == "script_breakdown":
        return _BREAKDOWN_TASK.format(**values), BREAKDOWN_SCHEMA
    if mode == "bible_from_script":
        return _BIBLE_TASK.format(**values), BIBLE_SCHEMA
    return _SHOT_TASK.format(**values), SHOT_PROMPTS_SCHEMA
