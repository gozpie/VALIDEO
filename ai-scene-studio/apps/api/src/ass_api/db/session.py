"""Moteur et sessions SQLAlchemy, créés une fois par application (connexion à la demande)."""

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from ass_api.core.config import Settings


def create_session_factory(settings: Settings) -> tuple[Engine, sessionmaker[Session]]:
    engine = create_engine(settings.database_url.get_secret_value(), pool_pre_ping=True)
    return engine, sessionmaker(engine, expire_on_commit=False)


def get_db(request: Request) -> Iterator[Session]:
    """Une session par requête. Les routes valident explicitement (``commit``) avant de répondre :
    la sortie d'une dépendance ``yield`` peut s'exécuter après l'envoi de la réponse."""
    factory: sessionmaker[Session] = request.app.state.session_factory
    with factory() as session:
        yield session
