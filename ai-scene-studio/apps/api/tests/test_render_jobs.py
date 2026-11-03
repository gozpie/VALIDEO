"""Machine à états des jobs : identique au contrat TypeScript, transitions refusées."""

import re
from pathlib import Path

import pytest

from ass_api.db.models import JOB_STATUSES, RenderJob
from ass_api.render.jobs import TRANSITIONS, InvalidTransitionError, transition

JOBS_TS = Path(__file__).resolve().parents[3] / "packages/shared-types/src/jobs.ts"


def test_transitions_match_typescript_contract() -> None:
    source = JOBS_TS.read_text(encoding="utf-8")
    block = source[source.index("JOB_TRANSITIONS") :]
    expected = {
        status: frozenset(re.findall(r"'([a-z]+)'", targets))
        for status, targets in re.findall(r"(\w+): \[([^\]]*)\]", block[: block.index("};")])
    }
    assert expected == TRANSITIONS
    assert set(TRANSITIONS) == set(JOB_STATUSES)


def test_transition_sets_timestamps_and_refuses_going_back() -> None:
    job = RenderJob(status="queued", message="")
    transition(job, "preparing")
    assert job.started_at is not None
    transition(job, "running")
    transition(job, "processing")
    transition(job, "completed", "Terminé")
    assert job.completed_at is not None
    assert job.message == "Terminé"
    with pytest.raises(InvalidTransitionError):
        transition(job, "queued")
