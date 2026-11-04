import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).resolve().parent
pointer=json.loads((root/'training-result.json').read_text(encoding='utf-8'))
r=json.loads((root/pointer['report']).read_text(encoding='utf-8'))
fig,axes=plt.subplots(1,2,figsize=(11.5,4.5),layout='constrained')
fig.patch.set_facecolor('#f6f7f2')
values=[r['baseline_test']['accuracy']*100,r['trained_test']['accuracy']*100]
bars=axes[0].bar(['До дообучения','После дообучения'],values,color=['#a9b7a1','#24523c'],width=.55)
axes[0].bar_label(bars,labels=[f'{v:.1f}%' for v in values],padding=5,fontsize=13)
axes[0].set_ylim(0,105);axes[0].set_ylabel('Верные категории, %');axes[0].set_title('64 искусственных примера · 3 категории')
axes[0].spines[['top','right']].set_visible(False)
axes[0].axhline(75,color='#b28050',linestyle='--',linewidth=1,label='Всегда «жалоба»: 75%');axes[0].legend(loc='lower right',fontsize=8)
matrix=r['trained_test']['confusion_matrix']
axes[1].imshow(matrix,cmap='Greens',vmin=0)
names=['Жалоба','Положительный','Недостаточно']
axes[1].set_xticks(range(3),names,fontsize=8);axes[1].set_yticks(range(3),names,fontsize=8)
axes[1].set_xlabel('Предсказание модели');axes[1].set_ylabel('Разметка примера');axes[1].set_title('Все ответы, включая ошибки')
for i,row in enumerate(matrix):
    for j,n in enumerate(row):axes[1].text(j,i,str(n),ha='center',va='center',color='white' if n>25 else '#233c2d',fontsize=14)
fig.suptitle('Asyl As · дообученная multilingual-e5-small',fontweight='bold',fontsize=14)
fig.supxlabel('Разработческий учебный тест. Качество в реальной школе ещё не установлено. Метки проверяет человек.',fontsize=8,color='#586554')
out=root.parent/'outputs'/'local-training-results.png';fig.savefig(out,dpi=160);print(out)
