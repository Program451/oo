"""Download public model files from official model repositories."""
import json
import os
import time
import urllib.request
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_ID = "Qwen/Qwen3-1.7B"
DEST = ROOT / "models" / "Qwen3-1.7B"

def main():
    global MODEL_ID,DEST
    parser=argparse.ArgumentParser();parser.add_argument('--model',choices=['Qwen/Qwen3-1.7B','intfloat/multilingual-e5-small'],default=MODEL_ID)
    MODEL_ID=parser.parse_args().model;DEST=ROOT/'models'/MODEL_ID.split('/')[-1]
    DEST.mkdir(parents=True, exist_ok=True)
    pinned = "614241f622f53c4eeff9890bdc4f31cfecc418b3" if MODEL_ID == "intfloat/multilingual-e5-small" else "70d244cc86ccca08cf5af4e1e306ecf908b1ad5e"
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{MODEL_ID}/revision/{pinned}", timeout=40) as r:
        meta = json.load(r)
    revision = meta["sha"]
    wanted = {"config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt", "LICENSE", "README.md"}
    files = [x["rfilename"] for x in meta["siblings"] if x["rfilename"] in wanted or x["rfilename"].endswith(".safetensors") or x["rfilename"].endswith(".safetensors.index.json")]
    print(json.dumps({"model":MODEL_ID,"revision":revision,"files":files}), flush=True)
    for name in files:
        target = DEST / name
        if target.exists() and target.stat().st_size:
            print(f"Already downloaded: {name}", flush=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(target.suffix + ".part")
        url = f"https://huggingface.co/{MODEL_ID}/resolve/{revision}/{name}"
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=120) as response, temp.open("wb") as out:
                    count, last = 0, time.monotonic()
                    while chunk := response.read(4*1024*1024):
                        out.write(chunk)
                        count += len(chunk)
                        if time.monotonic() - last > 20:
                            print(f"{name}: {count/1024**2:.0f} MiB", flush=True)
                            last = time.monotonic()
                os.replace(temp, target)
                print(f"Downloaded: {name} ({target.stat().st_size} bytes)", flush=True)
                break
            except Exception as exc:
                print(f"Download attempt {attempt+1} failed: {type(exc).__name__}", flush=True)
                if attempt == 2:
                    raise
    (DEST / "asyl-source.json").write_text(json.dumps({"model_id":MODEL_ID,"revision":revision,"license":meta.get('cardData',{}).get('license','see model card'),"source":"https://huggingface.co/"+MODEL_ID},indent=2),encoding="utf-8")

if __name__ == "__main__":
    main()
