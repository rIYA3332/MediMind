# ============================================================
# CarePlan Service — FastAPI version
# Run: uvicorn care_plan_service:app --host 0.0.0.0 --port 8002
# ============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
import json        
import os
from transformers import T5ForConditionalGeneration, T5Tokenizer
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

app = FastAPI(title="Care Plan T5 Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load model once on startup ────────────────────────────────
MODEL_PATH = "./careplan_model/careplan_t5large"

# ── FIX: patch tokenizer_config.json before loading ──────────
config_path = os.path.join(MODEL_PATH, "tokenizer_config.json")
with open(config_path, "r") as f:
    cfg = json.load(f)
if isinstance(cfg.get("extra_special_tokens"), list):
    cfg["extra_special_tokens"] = {}
    with open(config_path, "w") as f:
        json.dump(cfg, f, indent=2)
        
print("Loading T5 model...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_PATH)
model.eval()
device = torch.device("cpu")
model  = model.to(device)
print("Model ready on port 8002")


# ── Request schema ────────────────────────────────────────────
class PatientInput(BaseModel):
    age:        int    = 70
    gender:     str    = "female"
    weight:     str    = "normal weight"
    conditions: str    = "general health"
    bp:         str    = "120/80"
    sugar:      str    = "95"
    hr:         str    = "72"
    temp:       str    = "98.4"


# ── Model inference ───────────────────────────────────────────
def run_model(p: PatientInput) -> dict:
    input_text = (
        f"generate care plan: "
        f"patient: {p.age}yo {p.gender}, {p.weight}\n"
        f"conditions: {p.conditions}\n"
        f"vitals: blood_pressure={p.bp} mmHg, blood_sugar={p.sugar} mg/dL, "
        f"heart_rate={p.hr} bpm, temperature={p.temp}F\n"
        f"task: diet, exercise, caution"
    )
    inputs = tokenizer(
        input_text, return_tensors="pt",
        max_length=192, truncation=True,
    ).to(device)

    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=300,
            num_beams=4,
            repetition_penalty=2.5,
            no_repeat_ngram_size=3,
            early_stopping=True,
            length_penalty=1.0,
        )

    raw  = tokenizer.decode(output[0], skip_special_tokens=True)
    diet = ex = caution = ""

    if "Diet:" in raw:
        after = raw.split("Diet:", 1)[1]
        if "Exercise:" in after:
            diet = after.split("Exercise:", 1)[0].strip()
            rest = after.split("Exercise:", 1)[1]
            if "Caution:" in rest:
                ex      = rest.split("Caution:", 1)[0].strip()
                caution = rest.split("Caution:", 1)[1].strip()
            else:
                ex = rest.strip()
        else:
            diet = after.strip()

    return {"raw": raw, "diet": diet, "exercise": ex, "caution": caution}


# ── Routes ────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "Care Plan T5 Service running on port 8002"}


@app.get("/api/careplan/health")
def health():
    return {"status": "ok", "model": MODEL_PATH}


@app.post("/api/careplan/generate")
def generate(patient: PatientInput):
    try:
        result = run_model(patient)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}