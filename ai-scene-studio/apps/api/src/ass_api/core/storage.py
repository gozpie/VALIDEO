"""Stockage objet compatible S3 (API S3 standard uniquement : SeaweedFS, MinIO, AWS…).

Les clés sont toujours construites par le serveur (jamais à partir d'un nom de fichier client) et
préfixées par le workspace propriétaire.
"""

from typing import IO, Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import Request

from ass_api.core.config import Settings


class ObjectStorage:
    def __init__(self, client: Any, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    @classmethod
    def from_settings(cls, settings: Settings) -> "ObjectStorage":
        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id.get_secret_value(),
            aws_secret_access_key=settings.s3_secret_access_key.get_secret_value(),
            config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 3}),
        )
        return cls(client, settings.s3_bucket)

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def put_if_absent(self, key: str, data: bytes, content_type: str) -> None:
        """Écriture idempotente pour les clés adressées par contenu (même clé = mêmes octets)."""
        if not self.exists(key):
            self.put_bytes(key, data, content_type)

    def upload_file(self, key: str, fileobj: IO[bytes], content_type: str) -> None:
        self._client.upload_fileobj(
            fileobj, self._bucket, key, ExtraArgs={"ContentType": content_type}
        )

    def get_bytes(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        data: bytes = response["Body"].read()
        return data

    def open_stream(self, key: str) -> Any:
        """Corps de l'objet en flux (``iter_chunks``), sans chargement complet en mémoire."""
        return self._client.get_object(Bucket=self._bucket, Key=key)["Body"]

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


def get_storage(request: Request) -> ObjectStorage:
    storage: ObjectStorage = request.app.state.storage
    return storage
