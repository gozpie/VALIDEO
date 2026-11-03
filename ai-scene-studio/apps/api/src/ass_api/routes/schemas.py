"""Champs communs des schémas d'entrée."""

from typing import Annotated

from pydantic import Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, Field(max_length=10_000)]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
