"""Authenticated loopback Studio requests using an existing private session."""

import json
import urllib.error
import urllib.request
import uuid
from pathlib import Path


class Studio:
    def __init__(self, session_file=Path("/tmp/unsloth-a2ui-session.json")):
        self.session_file = Path(session_file)
        if self.session_file.stat().st_mode & 0o077:
            raise ValueError("Studio session file must be private")

    def _send(self, path, body=None, token=None, timeout=60):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(
            "http://127.0.0.1:8898" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def request(self, path, body=None, timeout=60):
        session = json.loads(self.session_file.read_text())
        try:
            return self._send(path, body, session["access_token"], timeout)
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
            session = self._send(
                "/api/auth/refresh", {"refresh_token": session["refresh_token"]}
            )
            self.session_file.write_text(json.dumps(session))
            self.session_file.chmod(0o600)
            return self._send(path, body, session["access_token"], timeout)

    def upload_dataset(self, path):
        path = Path(path)
        self.request("/api/train/status")
        session = json.loads(self.session_file.read_text())
        boundary = "a2ui-" + uuid.uuid4().hex
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
                "Content-Type: application/x-ndjson\r\n\r\n"
            ).encode()
            + path.read_bytes()
            + f"\r\n--{boundary}--\r\n".encode()
        )
        req = urllib.request.Request(
            "http://127.0.0.1:8898/api/datasets/upload",
            data=body,
            headers={
                "Authorization": "Bearer " + session["access_token"],
                "Content-Type": "multipart/form-data; boundary=" + boundary,
            },
        )
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
