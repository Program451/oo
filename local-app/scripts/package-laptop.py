"""Build an isolated Windows CPU distribution; never publish the personal ZIP."""
import argparse
import hashlib
import importlib.metadata as metadata
import json
import shutil
import sys
import zipfile
from pathlib import Path
from packaging.requirements import Requirement

parser = argparse.ArgumentParser()
parser.add_argument('--python-zip', type=Path, required=True)
parser.add_argument('--torch-wheel', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
stage = root / 'outputs' / 'portable-build' / 'Asyl-AI'
if stage.exists():
    raise SystemExit('Build folder already exists. Use a new build directory; do not overwrite a running worker.')
stage.mkdir(parents=True)
runtime = stage / 'runtime'
packages = runtime / 'Lib' / 'site-packages'
packages.mkdir(parents=True)

def unpack(archive, destination):
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            target = (destination / entry.filename).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Unsafe archive path')
        z.extractall(destination)

unpack(args.python_zip, runtime)
unpack(args.torch_wheel, packages)
(runtime / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages\n../local-ai\nimport site\n', encoding='ascii')

# Copy only the installed inference dependency closure, preserving licenses.
# Torch comes from the official CPU wheel, not the installed CUDA environment.
pending = ['transformers', 'safetensors', 'torch']
seen = set()
versions = {}
while pending:
    name = pending.pop().lower().replace('_', '-')
    if name in seen:
        continue
    seen.add(name)
    dist = metadata.distribution(name)
    versions[dist.metadata['Name']] = '2.7.1+cpu' if name == 'torch' else dist.version
    for text in dist.requires or []:
        req = Requirement(text)
        if req.marker is None or req.marker.evaluate({'extra': ''}):
            pending.append(req.name)
    if name == 'torch':
        continue
    source = Path(dist.locate_file('')).resolve()
    for entry in dist.files or []:
        src = Path(dist.locate_file(entry)).resolve()
        if not src.is_relative_to(source) or not src.is_file() or '__pycache__' in src.parts:
            continue
        target = packages / src.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)

def copy(relative):
    source = root / relative
    target = stage / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

for name in ['remote_worker.py', 'e5_core.py', 'model_core.py', 'dataset.py', 'active.json', 'TRAINING_REPORT.md']:
    copy(Path('local-ai') / name)
base = root / 'local-ai' / 'models' / 'multilingual-e5-small'
for source in base.iterdir():
    if source.is_file():
        copy(source.relative_to(root))
active = json.loads((root / 'local-ai' / 'active.json').read_text(encoding='utf-8'))
for key in ['weights', 'report']:
    relative = Path('local-ai') / active[key].replace('\\', '/')
    if not (root / relative).resolve().is_relative_to(root / 'local-ai'):
        raise ValueError('Unsafe model path')
    copy(relative)

def write(relative, text, encoding='utf-8'):
    target = stage / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding=encoding, newline='\n')

start = r'''@echo off
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "OMP_NUM_THREADS=4"
set "MKL_NUM_THREADS=4"
if not exist "runtime\python.exe" goto missing
if not exist "local-data\remote-worker.json" goto connection
"%~dp0runtime\python.exe" -u "%~dp0local-ai\remote_worker.py"
if errorlevel 1 pause
exit /b
:connection
echo Connection settings are missing. Read START-HERE.txt.
pause
exit /b 1
:missing
echo Extract the entire ZIP before starting the AI. Read START-HERE.txt.
pause
exit /b 1
'''
write('Start-Asyl-AI.cmd', start.replace('\n', '\r\n'), 'ascii')
write('Stop-Asyl-AI.cmd', '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\stop-ai-worker.ps1"\r\npause\r\n', 'ascii')
stop = (root / 'scripts' / 'stop-ai-worker.ps1').read_text(encoding='utf-8')
stop = stop.replace("'local-ai\\.venv\\Scripts\\python.exe'", "'runtime\\python.exe'")
write('scripts/stop-ai-worker.ps1', stop)
write('Check-Asyl-AI.cmd', '@echo off\r\ncd /d "%~dp0"\r\nset "PYTHONUTF8=1"\r\nset "OMP_NUM_THREADS=4"\r\nset "MKL_NUM_THREADS=4"\r\n"%~dp0runtime\\python.exe" "%~dp0local-ai\\check_runtime.py"\r\npause\r\n', 'ascii')
write('local-ai/check_runtime.py', '''import json, sys, time
from pathlib import Path
from e5_core import load_e5, classify_e5
from safetensors.torch import load_file
root = Path(__file__).resolve().parent
active = json.loads((root / 'active.json').read_text(encoding='utf-8'))
started = time.monotonic()
model, tokenizer, device = load_e5('cpu')
model.load_state_dict(load_file(root / active['weights'].replace('\\\\', '/')), strict=False)
model.eval()
for text in ['Суп был холодный.', 'Спасибо, было вкусно!', 'Тамақ суық болды.', 'Не знаю.']:
    label = classify_e5(model, tokenizer, device, text)
    print(text, '=>', label if label in ('positive', 'insufficient') else 'complaint')
print('Проверка завершена: модель загружена на CPU. Python:', sys.version.split()[0])
print('Это проверка запуска, а не оценка точности. Время:', round(time.monotonic()-started, 1), 'сек.')
''')
write('Open-Cabinet.url', '[InternetShortcut]\nURL=https://cabinet.asyl.studynesthub.com/\n', 'ascii')
write('Open-Feedback-Site.url', '[InternetShortcut]\nURL=https://asyl.studynesthub.com/\n', 'ascii')
write('START-HERE.txt', '''Asyl As — запуск ИИ на ноутбуке (Windows 10/11, x64)

1. Полностью распакуйте архив в обычную папку, например Documents\\Asyl-AI.
   Не запускайте файлы из окна ZIP. Сохраняйте всю папку вместе.
2. Откройте Start-Asyl-AI.cmd. Python и модель уже включены в архив.
   Устанавливать Python, CUDA, Node.js и библиотеки отдельно не требуется.
3. Дождитесь сообщения «ИИ подключён к сайту». Оставьте окно открытым.
4. Откройте https://cabinet.asyl.studynesthub.com/ и введите личный код.
   В личном архиве код лежит в local-data/Код входа в кабинет.txt.
5. В «AI-помощник» нажмите «Анализ отзывов», проверьте категории.
   Для знакомства выберите «Демонстрация»; реальные данные — «Мои данные».
6. Для остановки закройте окно ИИ или откройте Stop-Asyl-AI.cmd.

Если скачан общий архив из GitHub, скопируйте свою папку local-data из
отдельного архива настроек рядом со Start-Asyl-AI.cmd. Общий архив
намеренно не содержит личного подключения. Существующие коды не меняются.

Связь с сайтом требует интернета. Вычисления выполняются на процессоре
ноутбука, видеокарта не требуется. Первый запуск может занять около минуты;
скорость зависит от компьютера. Рекомендуется 8 ГБ ОЗУ и 3 ГБ свободного
места для ZIP и распаковки. Входящие порты открывать не нужно.
Запускайте одну копию модуля. При перезагрузке запустите его снова.
Если сеть временно пропала, модуль повторяет подключение автоматически.

Кабинет и сайт отзывов работают даже при выключенном ноутбуке.
Ученикам передавайте QR-ссылки опросов, не код кабинета и не личный архив.
Личный архив содержит токен вашего ИИ: не публикуйте и не пересылайте его.

Для диагностики откройте Check-Asyl-AI.cmd. Он проверяет загрузку модели
на четырёх учебных фразах без отправки на сайт и без изменения данных.

Модель: дообученная intfloat/multilingual-e5-small, 128 искусственных
обучающих примеров. Это исследовательский прототип; категории могут быть
ошибочными и требуют проверки. Никакого нового обучения эта упаковка
не выполняет. Числовые расчёты и рекомендации формирует программа.
Подробности: local-ai/TRAINING_REPORT.md.

Сайт отзывов: https://asyl.studynesthub.com/
Кабинет: https://cabinet.asyl.studynesthub.com/
Исходники: https://github.com/Program451/oo (нужен доступ к репозиторию).

Состав: Python 3.12.10 с python.org; PyTorch CPU 2.7.1 с download.pytorch.org;
зависимости из проверенной среды проекта (см. runtime-versions.json).
Лицензии Python — runtime/LICENSE.txt; библиотек — их каталоги .dist-info
в runtime/Lib/site-packages; базовой модели — local-ai/models/.../README.md.
''', 'utf-8-sig')
write('runtime-versions.json', json.dumps(versions, indent=2, ensure_ascii=False))
write('build-sources.json', json.dumps({
    'python_url': 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
    'python_sha256': hashlib.sha256(args.python_zip.read_bytes()).hexdigest(),
    'torch_index': 'https://download.pytorch.org/whl/cpu',
    'torch_sha256': hashlib.sha256(args.torch_wheel.read_bytes()).hexdigest(),
    'base_model': 'intfloat/multilingual-e5-small',
    'model_commit': '614241f622f53c4eeff9890bdc4f31cfecc418b3',
}, indent=2))
print('Prepared portable runtime:', stage)
print('Run the runtime check before archiving. Exclude runtime logs, PID and lock files.')
