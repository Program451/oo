"""Compare a smaller multilingual model on the fixed existing validation split.
Protocol is fixed before evaluating the final audit. No test-driven fitting.
"""
import hashlib,json,random,time
from datetime import datetime,timezone
import torch
from safetensors.torch import save_file,load_file
from dataset import build_dataset,LABELS
from final_audit import build_audit
from e5_core import ROOT,BASE,load_e5,batch_text,evaluate_e5

def dump(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
def main():
    random.seed(42);torch.manual_seed(42);torch.set_num_threads(4)
    data=build_dataset();data['test']=build_audit()
    run=ROOT/'runs'/('e5-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'));run.mkdir(parents=True)
    protocol={'base_model':'intfloat/multilingual-e5-small','method':'Gradient fine-tuning of the last two transformer layers and an eight-class linear head','seed':42,'epochs_max':12,'encoder_learning_rate':0.00001,'head_learning_rate':0.001,'batch_size':8,'split_counts':{k:len(v) for k,v in data.items()},'dataset_source':'Assistant-authored synthetic examples, not real pupil observations','dataset_hash':hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest(),'model_source':json.loads((BASE/'asyl-source.json').read_text()),'selection':'Lowest validation cross-entropy; final 64 examples are never used for fitting or checkpoint selection','comparison_rule':'Prefer E5 over Qwen only if selected validation macro F1 exceeds Qwen validation macro F1 0.7749368686868687; require final macro F1 >= 0.75','created_at':datetime.now(timezone.utc).isoformat(),'gpu':torch.cuda.get_device_name(0)}
    dump(run/'protocol.json',protocol);print(json.dumps({'run':str(run),'protocol':protocol}),flush=True)
    model,tokenizer,device=load_e5();model.eval();started=time.monotonic()
    with torch.no_grad():
        embeddings=torch.cat([model.embed(batch_text(tokenizer,[r['text'] for r in data['train'][i:i+8]],device)) for i in range(0,128,8)])
        model.centre.copy_(embeddings.mean(0))
        features=model.features(embeddings)
        target=torch.tensor([r['label_id'] for r in data['train']],device=device)
        prototypes=torch.stack([features[target==i].mean(0) for i in range(8)])
        model.head.weight.copy_(torch.nn.functional.normalize(prototypes,dim=1)*10);model.head.bias.zero_()
    # Reference classifier uses class centres with a frozen pretrained encoder.
    baseline,base_predictions=evaluate_e5(model,tokenizer,device,data['test'])
    dump(run/'baseline-test.json',{'metrics':baseline,'predictions':base_predictions,'reference':'Frozen E5 with training-set class centres, no gradient fine-tuning'})
    for param in model.encoder.parameters():param.requires_grad=False
    for layer in model.encoder.encoder.layer[-2:]:
        for param in layer.parameters():param.requires_grad=True
    trainable={n:p for n,p in model.named_parameters() if p.requires_grad}
    initial={n:p.detach().cpu().clone() for n,p in trainable.items()}
    protocol['trainable_parameters']=sum(p.numel() for p in trainable.values());protocol['total_parameters']=sum(p.numel() for p in model.parameters());dump(run/'protocol.json',protocol)
    optimizer=torch.optim.AdamW([{'params':[p for n,p in trainable.items() if n.startswith('encoder.')],'lr':.00001},{'params':model.head.parameters(),'lr':.001}],weight_decay=.01)
    best=float('inf');history=[]
    for epoch in range(12):
        # Frozen layers retain deterministic pretrained features; last layers/head train.
        model.eval()
        for layer in model.encoder.encoder.layer[-2:]:layer.train()
        model.head.train();rows=data['train'].copy();random.shuffle(rows);loss_sum=0
        for start in range(0,len(rows),8):
            group=rows[start:start+8];batch=batch_text(tokenizer,[r['text'] for r in group],device)
            logits=model(batch);loss=torch.nn.functional.cross_entropy(logits,torch.tensor([r['label_id'] for r in group],device=device))
            optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(list(trainable.values()),1);optimizer.step();loss_sum+=float(loss.detach())*len(group)
        validation,_=evaluate_e5(model,tokenizer,device,data['validation'])
        record={'epoch':epoch+1,'training_loss':loss_sum/len(rows),'validation':validation,'elapsed_seconds':time.monotonic()-started};history.append(record);dump(run/'history.json',history)
        if validation['loss']<best:
            best=validation['loss'];dump(run/'selected.json',{'epoch':epoch+1,'validation':validation})
            save_file({n:t.detach().cpu().contiguous() for n,t in model.state_dict().items() if n in trainable or n=='centre'},run/'weights.safetensors')
        print(json.dumps({'epoch':epoch+1,'loss':record['training_loss'],'validation_accuracy':validation['accuracy'],'validation_macro_f1':validation['macro_f1'],'validation_loss':validation['loss']}),flush=True)
    weights=load_file(run/'weights.safetensors');model.load_state_dict(weights,strict=False)
    selected=json.loads((run/'selected.json').read_text());final,predictions=evaluate_e5(model,tokenizer,device,data['test'])
    changed=sum(int(torch.count_nonzero(weights[n]-v)) for n,v in initial.items())
    eligible=selected['validation']['macro_f1']>.7749368686868687 and final['macro_f1']>=.75
    report={'protocol':protocol,'selected':selected,'baseline_test':baseline,'baseline_name':'Frozen E5 + training-set class centres','trained_test':final,'training_seconds':time.monotonic()-started,'gpu_peak_mb':torch.cuda.max_memory_allocated()/1024**2,'adapter_sha256':hashlib.sha256((run/'weights.safetensors').read_bytes()).hexdigest(),'updated_parameters':changed,'prototype_eligible':eligible,'test_predictions':predictions,'limitations':['Small synthetic same-author dataset; real school accuracy unknown.','Only text classification is trained, not arithmetic or unrestricted dialogue.','Qwen and E5 were compared by validation; the audit is a shared synthetic comparison, not an independently authored benchmark.']}
    dump(run/'report.json',report)
    if eligible:
        dump(ROOT/'training-result.json',{'run':str(run.relative_to(ROOT)),'report':str((run/'report.json').relative_to(ROOT)),'prototype_eligible':True})
        dump(ROOT/'active.json',{'backend':'e5','base_model':protocol['base_model'],'weights':str((run/'weights.safetensors').relative_to(ROOT)),'report':str((run/'report.json').relative_to(ROOT)),'labels':LABELS})
    print(json.dumps({'complete':True,'run':str(run),'validation_macro_f1':selected['validation']['macro_f1'],'baseline_accuracy':baseline['accuracy'],'trained_accuracy':final['accuracy'],'trained_macro_f1':final['macro_f1'],'eligible':eligible,'updated_parameters':changed}),flush=True)

if __name__=='__main__':main()
