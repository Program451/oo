import os
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
import torch
from transformers import AutoTokenizer, AutoModel
from model_core import ROOT, score
from dataset import LABELS

BASE=ROOT/'models'/'multilingual-e5-small'
class ReviewModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder=AutoModel.from_pretrained(BASE,local_files_only=True,trust_remote_code=False,attn_implementation='sdpa')
        self.head=torch.nn.Linear(self.encoder.config.hidden_size,len(LABELS))
        self.register_buffer('centre',torch.zeros(self.encoder.config.hidden_size))
    def embed(self,batch):
        hidden=self.encoder(**batch).last_hidden_state
        mask=batch['attention_mask'].unsqueeze(-1)
        mean=(hidden*mask).sum(1)/mask.sum(1).clamp(min=1)
        return torch.nn.functional.normalize(mean,p=2,dim=1)
    def features(self,embeddings):
        return torch.nn.functional.normalize(embeddings-self.centre,p=2,dim=1)
    def forward(self,batch):return self.head(self.features(self.embed(batch)))

def load_e5(device=None):
    device=device or ('cuda' if torch.cuda.is_available() else 'cpu')
    model=ReviewModel().to(device)
    tokenizer=AutoTokenizer.from_pretrained(BASE,local_files_only=True,trust_remote_code=False)
    return model,tokenizer,device

def batch_text(tokenizer,texts,device):
    return tokenizer(['query: '+t for t in texts],return_tensors='pt',padding=True,truncation=True,max_length=160).to(device)

@torch.inference_mode()
def evaluate_e5(model,tokenizer,device,rows):
    model.eval();predictions=[];losses=[]
    for start in range(0,len(rows),8):
        group=rows[start:start+8]
        logits=model(batch_text(tokenizer,[r['text'] for r in group],device))
        predictions.extend(LABELS[i] for i in logits.argmax(-1).tolist())
        losses.extend(torch.nn.functional.cross_entropy(logits,torch.tensor([r['label_id'] for r in group],device=device),reduction='none').tolist())
    result=score([r['label'] for r in rows],predictions);result['loss']=sum(losses)/len(losses)
    result['by_language']={lang:score([r['label'] for r in rows if r['language']==lang],[p for r,p in zip(rows,predictions) if r['language']==lang]) for lang in ('ru','kk')}
    return result,[{**r,'prediction':p,'correct':r['label']==p} for r,p in zip(rows,predictions)]

@torch.inference_mode()
def classify_e5(model,tokenizer,device,text):
    model.eval()
    return LABELS[int(model(batch_text(tokenizer,[text],device)).argmax(-1).item())]
