"""Real LoRA gradient updates; fixed train/validation/test split, no cloud use."""
import argparse
import hashlib
import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
import torch
from peft import LoraConfig, get_peft_model, PeftModel
from dataset import build_dataset, LABELS
from model_core import ROOT, BASE, load_base, encode, label_logits, evaluate

def save_json(path, data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--epochs",type=int,default=5)
    parser.add_argument("--resume",type=Path)
    parser.add_argument("--learning-rate",type=float,default=0.0001)
    parser.add_argument("--final-audit",action="store_true")
    args=parser.parse_args()
    if not torch.cuda.is_available():
        raise SystemExit("CUDA GPU unavailable. Training not started; use the project CUDA environment.")
    random.seed(42); torch.manual_seed(42); torch.cuda.manual_seed_all(42)
    torch.set_num_threads(4)
    data=build_dataset()
    if args.final_audit:
        from final_audit import build_audit
        data['test']=build_audit()
    run=ROOT/"runs"/datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run.mkdir(parents=True)
    dataset_hash=hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    protocol={"base_model":"Qwen/Qwen3-1.7B","method":"LoRA supervised eight-class review classification", "task":"Classify anonymous school-meal feedback in Russian and Kazakh", "seed":42,"epochs_max":args.epochs,"learning_rate":0.0001,"rank":8,"alpha":16,"dropout":0.05,"target_modules":["q_proj","v_proj"],"batch_size":1,"gradient_accumulation":8,"dataset_hash":dataset_hash,"dataset_source":"208 manually authored synthetic examples; no real pupil observations", "split_counts":{s:len(rows) for s,rows in data.items()},"selection":"Highest validation macro F1, then lowest validation loss; held-out test is not used for fitting or checkpoint selection", "gpu":torch.cuda.get_device_name(0),"model_source":json.loads((BASE/"asyl-source.json").read_text()),"created_at":datetime.now(timezone.utc).isoformat()}
    save_json(run/"protocol.json",protocol)
    protocol['learning_rate']=args.learning_rate
    protocol['dataset_source']='Assistant-authored synthetic examples; no real pupil observations or independent human audit'
    protocol['continued_from']=str(args.resume) if args.resume else None
    protocol['test_protocol']='Fresh 64-example synthetic audit frozen before continuation; original 48-example evaluation remains archived as development evidence' if args.final_audit else protocol['selection']
    save_json(run/"protocol.json",protocol)
    print(json.dumps({"run":str(run),"protocol":protocol},ensure_ascii=False),flush=True)
    model,tokenizer,token_ids,device=load_base()
    print("Evaluating the unchanged base model...",flush=True)
    baseline,base_predictions=evaluate(model,tokenizer,token_ids,device,data["test"])
    save_json(run/"baseline-test.json",{"metrics":baseline,"predictions":base_predictions})
    print(json.dumps({"baseline_accuracy":baseline["accuracy"],"baseline_macro_f1":baseline["macro_f1"]}),flush=True)
    model=PeftModel.from_pretrained(model,args.resume,is_trainable=True,local_files_only=True) if args.resume else get_peft_model(model,LoraConfig(r=8,lora_alpha=16,lora_dropout=.05,target_modules=["q_proj","v_proj"],task_type="CAUSAL_LM",bias="none"))
    model.config.use_cache=False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant":False})
    model.enable_input_require_grads()
    trainable=[p for p in model.parameters() if p.requires_grad]
    protocol["trainable_parameters"]=sum(p.numel() for p in trainable)
    protocol["total_parameters"]=sum(p.numel() for p in model.parameters())
    save_json(run/"protocol.json",protocol)
    optimizer=torch.optim.AdamW(trainable,lr=args.learning_rate,weight_decay=.01)
    history=[]; best=(-1,float("-inf")); started=time.monotonic()
    optimizer.zero_grad(set_to_none=True)
    for epoch in range(args.epochs):
        model.train(); rows=data["train"].copy(); random.shuffle(rows)
        loss_sum=0
        for step,row in enumerate(rows):
            logits=label_logits(model,encode(tokenizer,row["text"],device),token_ids)
            loss=torch.nn.functional.cross_entropy(logits,torch.tensor([row["label_id"]],device=device))
            if not torch.isfinite(loss):
                raise RuntimeError("Non-finite loss; refusing to save an unusable adapter")
            loss_sum+=float(loss.detach())
            (loss/8).backward()
            if (step+1)%8==0 or step+1==len(rows):
                torch.nn.utils.clip_grad_norm_(trainable,1)
                optimizer.step(); optimizer.zero_grad(set_to_none=True)
            if (step+1)%32==0:
                print(json.dumps({"epoch":epoch+1,"samples":step+1,"loss":round(loss_sum/(step+1),4),"elapsed_s":round(time.monotonic()-started),"gpu_peak_mb":round(torch.cuda.max_memory_allocated()/1024**2)}),flush=True)
        validation,_=evaluate(model,tokenizer,token_ids,device,data["validation"])
        record={"epoch":epoch+1,"training_loss":loss_sum/len(rows),"validation":validation,"elapsed_seconds":time.monotonic()-started}
        history.append(record); save_json(run/"history.json",history)
        criterion=(validation["macro_f1"],-validation["loss"])
        if criterion>best:
            best=criterion
            model.save_pretrained(run/"best-adapter",safe_serialization=True)
            save_json(run/"selected.json",{"epoch":epoch+1,"validation":validation})
        print(json.dumps({"epoch":epoch+1,"validation_accuracy":validation["accuracy"],"validation_macro_f1":validation["macro_f1"],"validation_loss":validation["loss"]}),flush=True)
    model.gradient_checkpointing_disable()
    model.load_adapter(run/"best-adapter",adapter_name="selected",is_trainable=False)
    model.set_adapter("selected")
    final,predictions=evaluate(model,tokenizer,token_ids,device,data["test"])
    adapter_path=run/"best-adapter"/"adapter_model.safetensors"
    from safetensors.torch import load_file
    adapter_weights=load_file(adapter_path)
    updated_b=sum(int(torch.count_nonzero(v)) for k,v in adapter_weights.items() if "lora_B" in k)
    if not updated_b:
        raise RuntimeError("LoRA B weights stayed zero: no real learning occurred")
    eligible=final["macro_f1"]>=baseline["macro_f1"] and final["macro_f1"]>=.75
    report={"protocol":protocol,"selected":json.loads((run/"selected.json").read_text()),"baseline_test":baseline,"trained_test":final,"training_seconds":time.monotonic()-started,"gpu_peak_mb":torch.cuda.max_memory_allocated()/1024**2,"adapter_sha256":hashlib.sha256(adapter_path.read_bytes()).hexdigest(),"nonzero_lora_b_weights":updated_b,"prototype_eligible":eligible,"limitations":["Small authored synthetic test; not independently collected school data.","Metrics do not establish real-world school accuracy, waste reduction or causal effect.","Only review-topic classification was fine-tuned; arithmetic and recommendations are separate application logic.","A human should review categories, especially ambiguous, mixed and unfamiliar feedback."],"test_predictions":predictions}
    save_json(run/"report.json",report)
    save_json(ROOT/"training-result.json",{"run":str(run.relative_to(ROOT)),"report":str((run/"report.json").relative_to(ROOT)),"prototype_eligible":eligible})
    if eligible:
        save_json(ROOT/"active.json",{"base_model":"Qwen/Qwen3-1.7B","adapter":str((run/"best-adapter").relative_to(ROOT)),"report":str((run/"report.json").relative_to(ROOT)),"labels":LABELS})
    print(json.dumps({"complete":True,"run":str(run),"baseline_accuracy":baseline["accuracy"],"trained_accuracy":final["accuracy"],"baseline_macro_f1":baseline["macro_f1"],"trained_macro_f1":final["macro_f1"],"eligible":eligible,"real_updated_lora_weights":updated_b}),flush=True)

if __name__=="__main__":
    main()
