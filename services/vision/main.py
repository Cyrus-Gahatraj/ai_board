"""RF-DETR room-camera service (stock COCO checkpoint). Run: npm run vision  (from web/)

The classroom page streams JPEG frames over a websocket, sending the next frame once it has this reply:
  -> binary JPEG (<= 2 MB, ~640 px wide)
  <- {"persons": int, "phones": int, "inference_ms": int}   or   {"error": str}
Policy (what counts as distracted, alerts) lives in web/lib/engagement.ts, not here.
"""
import io
import os
import threading
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from PIL import Image
from rfdetr import RFDETRMedium, RFDETRNano, RFDETRSmall

MODEL = os.environ.get("VISION_MODEL", "nano")
CONF = float(os.environ.get("VISION_CONF", "0.5"))
ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")}
MAX_FRAME = 2_000_000

model = {"small": RFDETRSmall, "medium": RFDETRMedium}.get(MODEL, RFDETRNano)()  # first run downloads the checkpoint
lock = threading.Lock()  # ponytail: one inference at a time; plenty for one classroom at 2 fps
app = FastAPI()


def detect(jpeg: bytes) -> dict:
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    t0 = time.perf_counter()
    with lock:
        det = model.predict(img, threshold=CONF)
    names = list(det.data.get("class_name", []))  # predict() maps COCO ids to names for us
    return {
        "persons": names.count("person"),
        "phones": names.count("cell phone"),
        "inference_ms": round((time.perf_counter() - t0) * 1000),
    }


@app.get("/health")
def health():
    return {"ok": True, "model": f"rfdetr-{MODEL}", "conf": CONF}


@app.websocket("/ws")
async def ws(sock: WebSocket):
    # Browsers can't send custom headers on a websocket, so the guard is: localhost-only bind + an Origin allowlist.
    if sock.headers.get("origin") not in ORIGINS:
        await sock.close(code=1008)
        return
    await sock.accept()
    try:
        while True:
            jpeg = await sock.receive_bytes()
            if len(jpeg) > MAX_FRAME:
                await sock.send_json({"error": "frame too large"})
                continue
            try:
                await sock.send_json(await run_in_threadpool(detect, jpeg))
            except Exception as e:  # a bad frame shouldn't kill the stream
                await sock.send_json({"error": str(e)})
    except WebSocketDisconnect:
        pass
