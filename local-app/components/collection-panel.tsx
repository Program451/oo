"use client";
import {useState,useEffect,useRef,type FormEvent} from 'react';
import {QrCode,RefreshCw,Plus,Download,ExternalLink,CheckCircle2,LoaderCircle,MessageCircle,Vote,LockKeyhole,Printer} from 'lucide-react';

type Survey={id:string;title:string;kind:'feedback'|'poll';dishes:string[];total:number;counts:{dish:string;total:number}[];closesAt:string;closed:boolean;createdAt:string};
type State={configured:boolean;url:string;surveys:Survey[];lastSync:string;syncing:boolean};
type SyncState=State&{addedReviews:number;addedVotes:number;hasMore:boolean};
function counted(n:number,forms:[string,string,string]){const last=n%10,lastTwo=n%100;return `${n} ${lastTwo>=11&&lastTwo<=14?forms[2]:last===1?forms[0]:last>=2&&last<=4?forms[1]:forms[2]}`;}

function PollResults({survey}:{survey:Survey}){
 return <section className="poll-results inline-poll" aria-label={'Результаты голосования: '+survey.title}>
  <h4>Выбор учеников</h4>
  {survey.dishes.map(dish=>{const count=survey.counts.find(c=>c.dish===dish)?.total||0,percent=survey.total?Math.round(count/survey.total*100):0;
   return <div key={dish}><div className="dish-row-top"><span>{dish}</span><strong>{counted(count,['голос','голоса','голосов'])} · {percent}%</strong></div><div className="bar-track" aria-hidden="true"><span style={{width:percent+'%'}}/></div></div>;
  })}
  <p className="field-help">{survey.total?'Показаны предпочтения участников. Меню согласует ответственный за питание.':'Пока голосов нет. Результаты появятся здесь автоматически.'}</p>
 </section>;
}

export default function CollectionPanel({dishes,onImported,hosted=false}:{dishes:string[];onImported:()=>Promise<void>;hosted?:boolean}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[syncError,setSyncError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[creating,setCreating]=useState(false),[kind,setKind]=useState<'feedback'|'poll'>('feedback'),[selected,setSelected]=useState<string|null>(null);
 const mounted=useRef(false),inFlight=useRef(false),stateRef=useRef<State|null>(null),onImportedRef=useRef(onImported),syncRef=useRef<(manual?:boolean)=>Promise<void>>(async()=>{});
 onImportedRef.current=onImported;
 async function request<T=State>(url:string,method='GET',body?:unknown):Promise<T>{
  const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)}),d=await r.json() as T&{error?:string};
  if(!r.ok)throw new Error(d.error||'Не удалось выполнить запрос');return d;
 }
 function update(next:State){if(mounted.current){stateRef.current=next;setState(next);}}
 async function refresh(){const next=await request('/api/feedback');update(next);return next;}
 async function sync(manual=false){
  if(!mounted.current||inFlight.current||stateRef.current?.configured===false)return;
  inFlight.current=true;setRefreshing(true);
  if(manual){setError('');setNotice('');}
  try{
   if(!stateRef.current){const cached=await refresh();if(!cached.configured||!mounted.current)return;}
   const next=await request<SyncState>('/api/feedback/sync','POST',{});
   if(!mounted.current)return;
   update(next);setSyncError('');
   if(manual||next.addedReviews||next.addedVotes)setNotice(`Получено: ${counted(next.addedReviews,['отзыв','отзыва','отзывов'])} и ${counted(next.addedVotes,['голос','голоса','голосов'])}.${next.hasMore?' Остальные ответы загрузятся при следующем обновлении.':''}`);
   if(next.addedReviews>0)await onImportedRef.current();
  }catch(e){if(mounted.current)setSyncError((e as Error).message);}
  finally{inFlight.current=false;if(mounted.current)setRefreshing(false);}
 }
 syncRef.current=sync;
 useEffect(()=>{
  mounted.current=true;
  const tick=()=>{if(document.visibilityState==='visible')void syncRef.current();};
  tick();
  const timer=setInterval(tick,15000);
  window.addEventListener('focus',tick);window.addEventListener('online',tick);document.addEventListener('visibilitychange',tick);
  return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',tick);window.removeEventListener('online',tick);document.removeEventListener('visibilitychange',tick);};
 },[]);
 async function create(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(inFlight.current)return;const f=new FormData(e.currentTarget);inFlight.current=true;setBusy(true);setError('');
  try{const s=await request<Survey>('/api/feedback/surveys','POST',{title:f.get('title'),kind,dishes:String(f.get('dishes')).split('\n').map(x=>x.trim()).filter(Boolean),days:Number(f.get('days'))});await refresh();if(mounted.current){setSelected(s.id);setCreating(false);setNotice('Опрос создан. Можно распечатать QR-код.');}}
  catch(e){if(mounted.current)setError((e as Error).message);}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 async function close(s:Survey){
  if(inFlight.current||!confirm(`Завершить «${s.title}»? Новые ответы перестанут приниматься.`))return;
  inFlight.current=true;setBusy(true);setError('');
  try{await request('/api/feedback/surveys','PATCH',{id:s.id});await refresh();if(mounted.current)setNotice('Сбор ответов завершён. Сохранённые ответы доступны.');}
  catch(e){if(mounted.current)setError((e as Error).message);}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const chosen=state?.surveys.find(s=>s.id===selected),working=busy||refreshing;
 return <section className="collection-panel">
  <div className="collection-intro card"><span className="collection-icon"><QrCode size={31}/></span><div><h2>Связь со школьной столовой</h2><p>Ученики отвечают по QR-коду. Голоса и отзывы обновляются автоматически, пока открыт этот раздел.</p><small>{hosted?'Кабинет защищён входом. Ученики видят только форму своего опроса.':'Измерения и локальная модель на сайт не отправляются.'}</small></div><button className="button primary" disabled={working||!state?.configured} onClick={()=>void sync(true)}>{refreshing?<LoaderCircle size={17} className="spin"/>:<RefreshCw size={17}/>}Обновить сейчас</button></div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {syncError&&<p className="form-error" role="alert">Не удалось обновить ответы: {syncError} Сохранённые результаты показаны ниже. Повторим автоматически.</p>}
  {notice&&<div className="notice soft" role="status"><CheckCircle2 size={18}/>{notice}</div>}
  {state&&!state.configured&&<div className="notice">Подключение сайта ещё не настроено. Инструкция находится в README проекта. Журнал и локальный анализ доступны независимо от сайта.</div>}
  <div className="collection-heading"><div><h3>Опросы и голосования</h3><p>Автообновление каждые 15 секунд{state?.lastSync?' · Обновлено: '+new Date(state.lastSync).toLocaleString('ru-RU'):''}</p></div><button className="button outline" disabled={!state?.configured||working} onClick={()=>setCreating(!creating)}><Plus size={17}/>{creating?'Скрыть форму':'Создать опрос'}</button></div>
  {creating&&<form className="card entry-form collection-form" onSubmit={create}>
   <div className="collection-types"><button type="button" aria-pressed={kind==='feedback'} onClick={()=>setKind('feedback')}><MessageCircle size={20}/><strong>Отзыв об обеде</strong><small>Оценка, причина и комментарий</small></button><button type="button" aria-pressed={kind==='poll'} onClick={()=>setKind('poll')}><Vote size={20}/><strong>Выбор блюда</strong><small>Один из согласованных вариантов</small></button></div>
   <label>Название опроса<input name="title" required minLength={4} maxLength={120} placeholder={kind==='poll'?'Какой гарнир попробуем?':'Обед — отзывы учеников'}/></label>
   <label>{kind==='poll'?'Варианты блюд — каждый с новой строки':'Блюда этого обеда — каждое с новой строки'}<textarea name="dishes" required defaultValue={dishes.slice(0,8).join('\n')} placeholder={'Рис с курицей\nГречка с котлетой'}/></label>
   <p className="field-help">{kind==='poll'?'От 2 до 8 вариантов. Согласуйте их с ответственным за питание.':'От 1 до 8 блюд. Ученик оставляет один ответ на этот опрос.'}</p>
   <label>Длительность<select name="days" defaultValue="1"><option value="1">1 день</option><option value="3">3 дня</option><option value="7">7 дней</option><option value="14">14 дней</option></select></label><button className="button primary" disabled={working}>Создать и получить QR-код</button>
  </form>}
  <div className="collection-grid"><div className="survey-list">
   {state?.surveys.map(s=>{const closed=s.closed||new Date(s.closesAt).getTime()<=Date.now();return <article className={'card survey-card '+(selected===s.id?'active':'')} key={s.id}>
    <div className="survey-kind">{s.kind==='poll'?<Vote size={16}/>:<MessageCircle size={16}/>} {s.kind==='poll'?'Голосование':'Отзывы'}<span className={'tag '+(closed?'':'good')}>{closed?'Завершён':'Открыт'}</span></div>
    <h3>{s.title}</h3>{s.kind==='feedback'&&<p>{s.dishes.join(' · ')}</p>}
    <div className="survey-meta"><strong>{counted(s.total,['ответ','ответа','ответов'])}</strong><small>До {new Date(s.closesAt).toLocaleString('ru-RU')}</small></div>
    {s.kind==='poll'&&<PollResults survey={s}/>}
    <div className="survey-actions"><button className="text-button" onClick={()=>setSelected(selected===s.id?null:s.id)}><QrCode size={16}/>{selected===s.id?'Скрыть QR-код':'Показать QR-код'}</button>{s.kind==='poll'&&<a className="text-button" href={'/api/feedback/results.csv?id='+s.id} download><Download size={15}/>Результаты CSV</a>}{!closed&&<button className="text-button" disabled={working} onClick={()=>void close(s)}>Завершить</button>}</div>
   </article>;})}
   {state&&!state.surveys.length&&<div className="card empty"><QrCode size={35}/><h3>Первый опрос начинается здесь</h3><p>Создайте опрос и разместите QR-код в столовой. Ответы появятся здесь автоматически.</p></div>}
  </div>
  {chosen&&state&&<aside className="card qr-card"><h3>{chosen.title}</h3><img src={'/api/feedback/qr?id='+chosen.id} width="264" height="264" alt={'QR-код опроса '+chosen.title}/><p>Наведи камеру телефона</p><a className="button primary" href={state.url+'/?s='+chosen.id} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Открыть страницу ученика</a><div className="survey-actions"><a className="text-button" href={'/api/feedback/qr?id='+chosen.id} download={'asyl-as-qr-'+chosen.id+'.svg'}><Download size={15}/>Скачать QR</a><a className="text-button" href={'/api/feedback/poster?id='+chosen.id} target="_blank" rel="noreferrer"><Printer size={15}/>Плакат</a></div></aside>}
  </div>
  <div className="notice soft"><LockKeyhole size={18}/><span>Выбор блюд виден в каждой карточке. Имена учеников не собираются; защита от повторов действует в пределах браузера. Отзывы доступны в «Отзывы учеников» → «Мои данные».</span></div>
 </section>;
}
