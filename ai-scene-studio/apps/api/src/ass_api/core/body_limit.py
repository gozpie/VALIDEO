"""Limite de taille des corps de requête, appliquée avant toute lecture par l'application.

Le contrôle porte sur l'en-tête ``Content-Length`` et sur les octets réellement reçus (corps
« chunked » compris) : un envoi trop gros est interrompu sans être écrit en entier sur le disque.
"""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class _TooLarge(Exception):  # noqa: N818 (signal interne)
    pass


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _reject(self, send: Send) -> None:
        body = json.dumps(
            {
                "type": "about:blank",
                "title": "Requête trop volumineuse",
                "status": 413,
                "detail": f"Corps limité à {self.max_bytes // (1024 * 1024)} Mo",
                "requestId": "",
            }
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/problem+json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(send)
            return

        received = 0
        exceeded = False
        started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise _TooLarge
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            # L'application a pu transformer l'interruption en erreur : la réponse devient 413.
            if exceeded:
                return
            started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _TooLarge:
            pass
        except Exception:
            if not exceeded:
                raise
        if exceeded and not started:
            await self._reject(send)
