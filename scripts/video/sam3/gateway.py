"""Small authenticated gateway, independently testable without CUDA or Modal."""
import hashlib
import hmac
import json
import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from engine import MAX_BYTES, validate_manifest


def create_app(segment, token=None):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    expected = token if token is not None else os.environ.get("SAM3_SERVICE_TOKEN", "")
    if len(expected) < 32:
        raise ValueError("SAM3_SERVICE_TOKEN must contain at least 32 characters")

    @app.post("/segment")
    async def endpoint(request: Request):
        headers = {"Cache-Control": "no-store"}
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {expected}".encode()):
            return JSONResponse({"error": "Unauthorized"}, status_code=401, headers=headers)
        if request.headers.get("content-type") != "video/mp4":
            return JSONResponse({"error": "Expected MP4"}, status_code=415, headers=headers)
        try:
            raw = request.headers.get("x-sam3-manifest", "")
            if len(raw) > 20000:
                raise ValueError("Oversize manifest")
            manifest = validate_manifest(json.loads(raw))
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    return JSONResponse({"error": "Video too large"}, status_code=413, headers=headers)
                data.extend(chunk)
            if not data or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
                raise ValueError("Invalid media")
        except (ValueError, TypeError, KeyError):
            return JSONResponse({"error": "Invalid request"}, status_code=400, headers=headers)
        try:
            result = await segment(bytes(data), manifest)
            return JSONResponse(result, headers=headers)
        except Exception:
            # No media, request content, provider exceptions or credentials in logs/responses.
            return JSONResponse({"error": "Segmentation unavailable"}, status_code=503, headers=headers)
    return app
