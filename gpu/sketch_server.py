"""
LumiRoam sketch server: redraws a real Wikimedia Commons photo as a child's crayon drawing.

img2img keeps the photo's layout (where the building sits, where the horizon is), and the
prompt pushes the style. SDXL-Turbo needs only a few steps, so a sketch takes about a second
on an RTX 4000 Ada, next to Gemma on the same GPU.

Run behind Caddy, which handles HTTPS and the bearer key, on 127.0.0.1:8001.
"""

import base64
import io
import os

import requests
import torch
from diffusers import AutoPipelineForImage2Image
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

MODEL = os.environ.get("SKETCH_MODEL", "stabilityai/sdxl-turbo")
UA = "LumiRoam/0.1 sketch server (open-source photographer's tour guide)"

pipe = AutoPipelineForImage2Image.from_pretrained(MODEL, torch_dtype=torch.float16, variant="fp16").to("cuda")
pipe.set_progress_bar_config(disable=True)

app = FastAPI()

NEGATIVE = "photo, photorealistic, realistic, 3d render, text, watermark, signature"


class SketchRequest(BaseModel):
    image_url: str
    prompt: str
    strength: float = 0.6  # lower keeps more of the photo's layout, higher is more "crayon"
    seed: int = 7


def load(url: str) -> Image.Image:
    if not url.startswith("https://upload.wikimedia.org/"):
        raise HTTPException(400, "only Wikimedia Commons images")
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    # centre-crop to 4:3 and scale to 512x384 (SDXL-Turbo is trained around 512px)
    w, h = img.size
    target = 4 / 3
    if w / h > target:
        nw = int(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.resize((512, 384), Image.LANCZOS)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "cuda": torch.cuda.is_available()}


@app.post("/sketch")
def sketch(req: SketchRequest):
    init = load(req.image_url)
    steps = 4
    # img2img runs steps * strength denoising steps; it needs at least one
    strength = max(req.strength, 1 / steps)
    out = pipe(
        prompt=req.prompt,
        negative_prompt=NEGATIVE,
        image=init,
        num_inference_steps=steps,
        strength=strength,
        guidance_scale=0.0,  # Turbo is trained without classifier-free guidance
        generator=torch.Generator("cuda").manual_seed(req.seed),
    ).images[0]
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return {"png_base64": base64.b64encode(buf.getvalue()).decode()}
