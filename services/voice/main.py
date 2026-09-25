"""OmniVoice TTS service. Run: .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001"""
import io
import os
import tempfile
import threading
import time
from functools import lru_cache

import soundfile as sf
import torch
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from omnivoice import OmniVoice
from pydantic import BaseModel, Field

SR = 24_000
KEY = os.environ.get("SERVICE_KEY", "")
DEVICE = os.environ.get("VOICE_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
STEPS = int(os.environ.get("VOICE_STEPS", "16"))  # diffusion steps: fewer = faster, rougher
DEFAULT_INSTRUCT = os.environ.get("VOICE_INSTRUCT", "female, moderate pitch, american accent")
REF_TEXT = "Hello everyone, welcome to today's class. Let's get started with something interesting."

model = OmniVoice.from_pretrained(
    "k2-fsa/OmniVoice", device_map=DEVICE, dtype=torch.float32 if DEVICE == "cpu" else torch.float16
)
lock = threading.Lock()  # ponytail: one synthesis at a time; the model isn't safe to share across threads
app = FastAPI()


class VoiceConfig(BaseModel):
    instruct: str = Field(DEFAULT_INSTRUCT, max_length=200)  # voice design, e.g. "male, low pitch, british accent"
    speed: float = Field(1.0, ge=0.5, le=2.0)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    voice_config: VoiceConfig = VoiceConfig()


@lru_cache(maxsize=8)
def voice_for(instruct: str):
    # Voice design picks a new speaker on every call. Render one reference line from the instruct,
    # then clone it, so every beat of a lesson sounds like the same teacher.
    ref = model.generate(text=REF_TEXT, instruct=instruct, num_step=STEPS)[0]
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        sf.write(f.name, ref, SR)
        return model.create_voice_clone_prompt(ref_audio=f.name, ref_text=REF_TEXT)


def check_key(key: str):
    if KEY and key != KEY:
        raise HTTPException(401, "bad service key")


@app.get("/health")
def health():
    return {"ok": True, "model": "OmniVoice", "device": DEVICE, "steps": STEPS}


@app.post("/tts")
def tts(req: TTSRequest, x_service_key: str = Header("")):
    check_key(x_service_key)
    t0 = time.perf_counter()
    with lock:
        prompt = voice_for(req.voice_config.instruct)
        audio = model.generate(
            text=req.text, voice_clone_prompt=prompt, num_step=STEPS, speed=req.voice_config.speed
        )[0]
    buf = io.BytesIO()
    sf.write(buf, audio, SR, format="WAV", subtype="PCM_16")
    return Response(
        buf.getvalue(),
        media_type="audio/wav",
        headers={
            "X-Duration-Ms": str(round(len(audio) / SR * 1000)),
            "X-Synth-Ms": str(round((time.perf_counter() - t0) * 1000)),
        },
    )


with lock:
    voice_for(DEFAULT_INSTRUCT)  # warm up: loads kernels and caches the default voice before the first request
