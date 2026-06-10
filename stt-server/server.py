"""Local speech-to-text sidecar: faster-whisper (small.en, int8) behind FastAPI.

Run:  uvicorn server:app --host 127.0.0.1 --port 8077
First start downloads the model (~460 MB) to ~/.cache/huggingface.
The Node bot serializes requests, so concurrency=1 here is fine and keeps RAM low.
"""
import os
import tempfile

from fastapi import FastAPI, Request
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "small.en")
THREADS = int(os.environ.get("WHISPER_THREADS", "4"))

# Bias decoding toward radio vocabulary — big accuracy win for 10-codes/callsigns.
INITIAL_PROMPT = (
    "Police dispatch radio traffic. Dispatch, this is 7-Adam-12, show me 10-8. "
    "Codes: 10-4, 10-6, 10-7, 10-8, 10-11, 10-15, 10-19, 10-23, 10-97, code 4. "
    "New call priority 2 robbery at the bank. Attach 2-Lincoln-30 to call 5. "
    "Clear call 5. BOLO white sedan heading north on Route 9."
)

model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS)
app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/transcribe")
async def transcribe(request: Request):
    data = await request.body()
    fd, path = tempfile.mkstemp(suffix=".wav")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        segments, _info = model.transcribe(
            path,
            language="en",
            beam_size=2,
            initial_prompt=INITIAL_PROMPT,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    finally:
        os.unlink(path)
    return {"text": text}
