"""Authenticated short requests around a queued GPU call; no public call IDs."""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from engine import MAX_BYTES, validate_manifest


def create_app(spawn, lookup, token=None, clock=time.time, *, path="/segment",
               content_type="video/mp4", decode_payload=None, max_bytes=MAX_BYTES):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    expected = token if token is not None else os.environ.get("SAM3_SERVICE_TOKEN", "")
    if len(expected) < 32:
        raise ValueError("SAM3_SERVICE_TOKEN must contain at least 32 characters")
    headers = {"Cache-Control": "no-store", "Retry-After": "2"}

    def response(value, status=200):
        return JSONResponse(value, status_code=status, headers=headers)

    def authenticated(request):
        return hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {expected}".encode())

    def sign(value):
        payload = base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()
        signature = hmac.new(expected.encode(), payload.encode(), "sha256").hexdigest()
        return payload + "." + signature

    def receipt(request):
        raw = request.headers.get("x-sam3-job", "")
        if len(raw) > 2048:
            raise ValueError("Invalid receipt")
        payload, signature = raw.split(".")
        wanted = hmac.new(expected.encode(), payload.encode(), "sha256").hexdigest()
        if not hmac.compare_digest(signature, wanted):
            raise ValueError("Invalid receipt")
        value = json.loads(base64.urlsafe_b64decode(payload))
        if value["request"] != request.headers.get("x-sam3-request"):
            raise ValueError("Wrong request")
        if value.get("path", "/segment") != path:
            raise ValueError("Wrong service")
        return value

    @app.post(path)
    async def submit(request: Request):
        if not authenticated(request):
            return response({"error": "Unauthorized"}, 401)
        if request.headers.get("content-type") != content_type:
            return response({"error": "Unsupported content type"}, 415)
        try:
            request_id = request.headers.get("x-sam3-request", "")
            if not re.fullmatch(r"[a-f0-9-]{36}", request_id):
                raise ValueError("Invalid request ID")
            lifetime = int(request.headers.get("x-sam3-budget-ms", "0")) / 1000
            if not 1 <= lifetime <= 900:
                raise ValueError("Invalid budget")
            raw = request.headers.get("x-sam3-manifest", "")
            if len(raw) > 20000:
                raise ValueError("Oversize manifest")
            manifest = None if decode_payload else validate_manifest(json.loads(raw))
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > max_bytes:
                    return response({"error": "Video too large"}, 413)
                data.extend(chunk)
            if decode_payload:
                data, manifest = decode_payload(bytes(data))
            if not data or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
                raise ValueError("Invalid media")
        except (ValueError, TypeError, KeyError):
            return response({"error": "Invalid request"}, 400)
        try:
            expires = clock() + lifetime
            call = await spawn(bytes(data), manifest, expires)
            job = sign({"id": call.object_id, "sha256": manifest["sha256"],
                        "request": request_id, "expires": expires, "path": path})
            return response({"job": job, "sourceSha256": manifest["sha256"]}, 202)
        except Exception:
            return response({"error": "Segmentation unavailable"}, 503)

    @app.api_route(path, methods=["GET", "DELETE"])
    async def poll(request: Request):
        if not authenticated(request):
            return response({"error": "Unauthorized"}, 401)
        try:
            job = receipt(request)
        except (ValueError, TypeError, KeyError):
            return response({"error": "Invalid job"}, 400)
        try:
            call = lookup(job["id"])
            if request.method == "DELETE" or clock() >= job["expires"]:
                # Cancel this input, never terminate another user's shared container.
                await call.cancel.aio()
                return response({"status": "cancelled"}, 200 if request.method == "DELETE" else 410)
            try:
                result = await call.get.aio(timeout=0)
            except TimeoutError:
                return response({"status": "pending"}, 202)
            return response(result)
        except Exception:
            # Never expose model exceptions, media, tokens or call IDs in logs.
            return response({"error": "Segmentation unavailable"}, 503)
    return app
