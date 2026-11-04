"""Offline, loopback-only inference for the locally trained adapter."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from peft import PeftModel
from model_core import ROOT, load_base, classify

PORT=11435
LOCK=threading.Lock()

def safe_local(path):
    resolved=(ROOT/path).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError("Invalid local model path")
    return resolved

def main():
    active=json.loads((ROOT/"active.json").read_text(encoding="utf-8"))
    report=json.loads(safe_local(active["report"]).read_text(encoding="utf-8"))
    if active.get('backend')=='e5':
        from e5_core import load_e5,classify_e5
        from safetensors.torch import load_file
        model,tokenizer,device=load_e5()
        model.load_state_dict(load_file(safe_local(active['weights'])),strict=False)
        def predict(text):
            label=classify_e5(model,tokenizer,device,text)
            return label if not active.get('triage') or label in ('positive','insufficient') else 'complaint'
        model_label='multilingual-e5-small · Asyl As'
    else:
        model,tokenizer,tokens,device=load_base()
        model=PeftModel.from_pretrained(model,safe_local(active["adapter"]),local_files_only=True)
        predict=lambda text:classify(model,tokenizer,tokens,device,text)
        model_label='Qwen3-1.7B + Asyl As LoRA'
    model.eval()
    public={"ready":True,"model":model_label,"device":device,"offline":True,"reviewRequired":active.get('review_required',False),
            "training":{**report['protocol']['split_counts'],"source":"Учебные синтетические отзывы",
                        "baselineAccuracy":report["baseline_test"]["accuracy"],"trainedAccuracy":report["trained_test"]["accuracy"],
                        "macroF1":report["trained_test"]["macro_f1"],"adapterSha256":report["adapter_sha256"]}}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass # Do not log pupil feedback.
        def send_json(self,code,data):
            body=json.dumps(data,ensure_ascii=False).encode("utf-8")
            self.send_response(code);self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
        def authorized(self):
            return self.headers.get("Host") in (f"127.0.0.1:{PORT}",f"localhost:{PORT}") and self.headers.get("X-Asyl-Client")=="local" and not self.headers.get("Origin")
        def do_GET(self):
            if not self.authorized():return self.send_json(403,{"error":"Local application only"})
            if self.path=="/health":return self.send_json(200,public)
            self.send_json(404,{"error":"Not found"})
        def do_POST(self):
            if not self.authorized():return self.send_json(403,{"error":"Local application only"})
            if self.path=="/shutdown":
                self.send_json(200,{"ok":True})
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            if self.path!="/classify":return self.send_json(404,{"error":"Not found"})
            try:
                length=int(self.headers.get("Content-Length","0"))
                if not 0<length<=40000:raise ValueError()
                data=json.loads(self.rfile.read(length));rows=data["reviews"]
                if not isinstance(rows,list) or len(rows)>24:raise ValueError()
                for row in rows:
                    if not isinstance(row,dict) or not isinstance(row.get("id"),str) or not isinstance(row.get("text"),str) or len(row["id"])>100 or not 1<=len(row["text"])<=300:raise ValueError()
            except (ValueError,KeyError,TypeError):
                return self.send_json(400,{"error":"Неверный формат отзывов"})
            if not LOCK.acquire(blocking=False):return self.send_json(429,{"error":"Модель занята предыдущим анализом"})
            try:
                results=[{"id":row["id"],"label":predict(row['text'])} for row in rows]
                self.send_json(200,{"model":public["model"],"classifications":results})
            except Exception:
                self.send_json(500,{"error":"Локальная модель не смогла разобрать отзыв. Сократите текст и повторите."})
            finally:LOCK.release()
    print(json.dumps({"ready":True,"url":f"http://127.0.0.1:{PORT}","device":device,"model":public["model"]}),flush=True)
    ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()

if __name__=="__main__":main()
