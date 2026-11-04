"""Select operational three-class triage using validation, retain all fine-label results."""
import json,hashlib,argparse
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parent
LABELS=['complaint','positive','insufficient']
def collapse(label):return label if label in ('positive','insufficient') else 'complaint'
def score(rows):
    matrix=[[0]*3 for _ in range(3)]
    for row in rows:matrix[LABELS.index(collapse(row['label']))][LABELS.index(collapse(row['prediction']))]+=1
    classes={}
    for i,label in enumerate(LABELS):
        actual=sum(matrix[i]);called=sum(r[i] for r in matrix);tp=matrix[i][i]
        precision=tp/called if called else 0;recall=tp/actual if actual else 0
        classes[label]={'precision':precision,'recall':recall,'f1':2*precision*recall/(precision+recall) if precision+recall else 0,'support':actual}
    n=len(rows);acc=sum(matrix[i][i] for i in range(3))/n;z=1.96;den=1+z*z/n;centre=(acc+z*z/(2*n))/den;margin=z*(acc*(1-acc)/n+z*z/(4*n*n))**.5/den
    return {'accuracy':acc,'macro_f1':sum(x['f1'] for x in classes.values())/3,'samples':n,'per_class':classes,'confusion_matrix':matrix,'label_order':LABELS,'accuracy_wilson_95':[centre-margin,centre+margin],'majority_accuracy':max(sum(row) for row in matrix)/n}
def collapse_validation(metrics):
    rows=[]
    for i,label in enumerate(metrics['label_order']):
        for j,pred in enumerate(metrics['label_order']):rows += [{'label':label,'prediction':pred}]*metrics['confusion_matrix'][i][j]
    return score(rows)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--reviewed-prototype',action='store_true');args=parser.parse_args()
    candidates=[ROOT/'runs'/'20261104T191835Z',ROOT/'runs'/'e5-20261104T193236Z']
    reports=[json.loads((p/'report.json').read_text(encoding='utf-8')) for p in candidates]
    selection=[collapse_validation(r['selected']['validation']) for r in reports]
    selected=max(range(len(reports)),key=lambda i:selection[i]['macro_f1'])
    source=candidates[selected];r=reports[selected]
    if selected!=1:raise SystemExit('E5 did not win validation; no activation')
    base=json.loads((source/'baseline-test.json').read_text(encoding='utf-8'))
    final=score(r['test_predictions']);baseline=score(base['predictions'])
    eligible=selection[selected]['macro_f1']>=.8 and final['macro_f1']>=.8 and final['accuracy']>final['majority_accuracy']
    protocol={**r['protocol'],'task':'Three-way review triage: complaint, positive, insufficient information','internal_labels':8,'output_labels':3,'selection':'Operational task simplified after validation error analysis; choose model by collapsed validation macro F1. Final comparison is developmental, not an independently authored benchmark.','comparison_rule':'Validation macro F1 >= .80, control macro F1 >= .80, control accuracy above majority baseline'}
    report={**r,'protocol':protocol,'selected':{**r['selected'],'validation':selection[selected]},'baseline_test':baseline,'trained_test':final,'prototype_eligible':eligible,'fine_label_results':{'baseline':r['baseline_test'],'trained':r['trained_test']},'validation_candidates':{'qwen':selection[0],'e5':selection[1]},'test_predictions':[{**x,'fine_label':x['label'],'fine_prediction':x['prediction'],'label':collapse(x['label']),'prediction':collapse(x['prediction']),'correct':collapse(x['label'])==collapse(x['prediction'])} for x in r['test_predictions']], 'limitations':r['limitations']+['Three categories were chosen after development error analysis. Do not advertise these scores as eight-category accuracy or independent real-world validation.']}
    for tag,metrics,rows in [('baseline',baseline,base['predictions']),('trained',final,r['test_predictions'])]:metrics['by_language']={lang:score([x for x in rows if x['language']==lang]) for lang in ('ru','kk')}
    (source/'triage-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if eligible or args.reviewed_prototype:
        (ROOT/'active.json').write_text(json.dumps({'backend':'e5','triage':True,'review_required':not eligible,'base_model':protocol['base_model'],'weights':str((source/'weights.safetensors').relative_to(ROOT)),'report':str((source/'triage-report.json').relative_to(ROOT)),'labels':LABELS},indent=2),encoding='utf-8')
        (ROOT/'training-result.json').write_text(json.dumps({'run':str(source.relative_to(ROOT)),'report':str((source/'triage-report.json').relative_to(ROOT)),'prototype_eligible':eligible,'review_required':not eligible},indent=2),encoding='utf-8')
    print(json.dumps({'task':'3-class triage','validation':selection[selected],'baseline':baseline,'trained':final,'eligible':eligible}),flush=True)
if __name__=='__main__':main()
