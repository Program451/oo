import os
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
import json
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from dataset import SYSTEM, LABELS

ROOT = Path(__file__).resolve().parent
BASE = ROOT / "models" / "Qwen3-1.7B"

def load_base():
    tokenizer = AutoTokenizer.from_pretrained(BASE, local_files_only=True, trust_remote_code=False)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=dtype, attn_implementation="sdpa", local_files_only=True, trust_remote_code=False).to(device)
    token_ids = [tokenizer.encode(str(i), add_special_tokens=False) for i in range(len(LABELS))]
    if any(len(ids) != 1 for ids in token_ids):
        raise RuntimeError("Expected single-token digit labels")
    return model, tokenizer, [ids[0] for ids in token_ids], device

def encode(tokenizer, text, device):
    prompt = tokenizer.apply_chat_template([
        {"role":"system","content":SYSTEM},
        {"role":"user","content":json.dumps({"review":text},ensure_ascii=False)}
    ], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    batch = tokenizer(prompt,return_tensors="pt",add_special_tokens=False)
    if batch.input_ids.shape[1] > 640:
        raise ValueError("Отзыв слишком длинный для локальной модели; сократите его до 300 символов.")
    return batch.to(device)

def label_logits(model, batch, token_ids):
    return model(**batch,use_cache=False).logits[:, -1, token_ids].float()

@torch.inference_mode()
def classify(model, tokenizer, token_ids, device, text):
    batch = encode(tokenizer,text,device)
    logits = label_logits(model,batch,token_ids)
    idx = int(logits.argmax(-1).item())
    return LABELS[idx]

def score(expected, predicted):
    confusion = [[0]*len(LABELS) for _ in LABELS]
    for true, pred in zip(expected,predicted):
        confusion[LABELS.index(true)][LABELS.index(pred)] += 1
    per_class = {}
    for i,label in enumerate(LABELS):
        tp=confusion[i][i]; actual=sum(confusion[i]); called=sum(row[i] for row in confusion)
        precision=tp/called if called else 0
        recall=tp/actual if actual else 0
        f1=2*precision*recall/(precision+recall) if precision+recall else 0
        per_class[label]={"precision":precision,"recall":recall,"f1":f1,"support":actual}
    n=len(expected); accuracy=sum(a==b for a,b in zip(expected,predicted))/n if n else 0
    z=1.96; den=1+z*z/n; centre=(accuracy+z*z/(2*n))/den
    margin=z*((accuracy*(1-accuracy)/n+z*z/(4*n*n))**0.5)/den
    return {"accuracy":accuracy,"macro_f1":sum(x["f1"] for x in per_class.values())/len(LABELS),
            "samples":n,"accuracy_wilson_95":[max(0,centre-margin),min(1,centre+margin)],
            "per_class":per_class,"confusion_matrix":confusion,"label_order":LABELS}

def evaluate(model, tokenizer, token_ids, device, rows):
    model.eval()
    predictions=[]; losses=[]
    with torch.inference_mode():
        for row in rows:
            logits=label_logits(model,encode(tokenizer,row["text"],device),token_ids)
            predictions.append(LABELS[int(logits.argmax(-1).item())])
            losses.append(float(torch.nn.functional.cross_entropy(logits,torch.tensor([row["label_id"]],device=device))))
    result=score([r["label"] for r in rows],predictions)
    result["loss"]=sum(losses)/len(losses)
    result["by_language"]={language:score([r["label"] for r in rows if r["language"]==language],[p for r,p in zip(rows,predictions) if r["language"]==language]) for language in ("ru","kk")}
    return result,[{**r,"prediction":p,"correct":r["label"]==p} for r,p in zip(rows,predictions)]
