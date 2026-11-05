"""The laptop makes outbound HTTPS requests; no incoming ports are opened."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
import json
import re
import time
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / 'local-data'
DATA.mkdir(exist_ok=True)
lock = (DATA / 'remote-worker.lock').open('a+b')
lock.seek(0)
lock.write(b'0')
lock.flush()
lock.seek(0)
try:
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    print('Модуль ИИ уже запущен. Статус виден в кабинете сайта.', flush=True)
    raise SystemExit(0)

config = json.loads((DATA / 'remote-worker.json').read_text(encoding='utf-8'))
url = urlsplit(config['url'])
if url.scheme != 'https' or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment or not re.fullmatch('[a-f0-9]{64}', config.get('token', '')):
    raise RuntimeError('Некорректная настройка подключения ИИ')
origin = 'https://' + url.netloc
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None
client = urllib.request.build_opener(NoRedirect)
def api(route, data):
    request = urllib.request.Request(origin + route, data=json.dumps(data, ensure_ascii=False).encode('utf-8'), headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'}, method='POST')
    with client.open(request, timeout=20) as response:
        payload = response.read(40001)
        if len(payload) > 40000:
            raise ValueError('Слишком большой ответ сайта')
        return json.loads(payload)

print('Загружаю дообученную модель. Сайт и отзывы доступны независимо от запуска ИИ.', flush=True)
from e5_core import load_e5, classify_e5
from safetensors.torch import load_file
active = json.loads((ROOT / 'active.json').read_text(encoding='utf-8'))
def safe_file(value):
    result = (ROOT / value.replace('\\', '/')).resolve()
    if not result.is_relative_to(ROOT):
        raise ValueError('Invalid model path')
    return result
report = json.loads(safe_file(active['report']).read_text(encoding='utf-8'))
model, tokenizer, device = load_e5()
model.load_state_dict(load_file(safe_file(active['weights'])), strict=False)
model.eval()
health = {'ready': True, 'model': 'multilingual-e5-small · Asyl As', 'reviewRequired': True,
    'training': {**report['protocol']['split_counts'], 'baselineAccuracy': report['baseline_test']['accuracy'],
        'trainedAccuracy': report['trained_test']['accuracy'], 'macroF1': report['trained_test']['macro_f1'],
        'adapterSha256': report['adapter_sha256']}}
(DATA / 'remote-worker.pid').write_text(str(os.getpid()), encoding='ascii')
connected = False
try:
    while True:
        try:
            packet = api('/api/worker/poll', {'health': health})
            if not connected:
                print('ИИ подключён к сайту. Анализ запускается кнопкой в кабинете. Для остановки закройте окно или используйте Stop-Asyl-AI.cmd.', flush=True)
                connected = True
            job = packet.get('job')
            if job:
                rows = job.get('reviews')
                if not isinstance(rows, list) or len(rows) > 24 or any(not isinstance(r, dict) or not isinstance(r.get('id'), str) or len(r['id']) > 100 or not isinstance(r.get('text'), str) or not 1 <= len(r['text']) <= 300 for r in rows):
                    raise ValueError('Неверное задание ИИ')
                answer = {'id': job['id'], 'lease': job['lease']}
                try:
                    labels = []
                    for row in rows:
                        label = classify_e5(model, tokenizer, device, row['text'])
                        labels.append({'id': row['id'], 'label': label if label in ('positive', 'insufficient') else 'complaint'})
                    answer['classifications'] = labels
                except Exception:
                    answer['error'] = True
                for attempt in range(3):
                    try:
                        api('/api/worker/result', answer)
                        print('Анализ завершён. Проверьте категории в кабинете.', flush=True)
                        break
                    except urllib.error.HTTPError as error:
                        if error.code == 410:
                            break
                        if attempt == 2:
                            raise
                        time.sleep(2)
                    except (OSError, ValueError):
                        if attempt == 2:
                            raise
                        time.sleep(2)
            time.sleep(3)
        except (OSError, ValueError, KeyError, urllib.error.HTTPError):
            if connected:
                print('Связь с сайтом временно потеряна. Подключение восстановится автоматически.', flush=True)
            connected = False
            time.sleep(10)
except KeyboardInterrupt:
    print('Модуль ИИ остановлен.', flush=True)
finally:
    pid_file = DATA / 'remote-worker.pid'
    if pid_file.exists() and pid_file.read_text().strip() == str(os.getpid()):
        pid_file.unlink()
    lock.close()
