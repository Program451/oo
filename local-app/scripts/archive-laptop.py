"""Archive a tested portable build; personal downloads stay outside GitHub."""
import argparse
import hashlib
import shutil
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--personal', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
stage = root / 'outputs' / 'portable-build' / 'Asyl-AI'
out = root / 'outputs' / 'downloads'
out.mkdir(parents=True, exist_ok=True)
generic = out / 'Asyl-AI-Windows-x64.zip'
private = out / 'Asyl-AI-Windows-My-Cabinet.zip'
connection = out / 'Asyl-AI-My-Connection.zip'
exclude = {'__pycache__', 'local-data'}

def checksum(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def verify(path):
    with zipfile.ZipFile(path) as archive:
        damaged = archive.testzip()
        if damaged:
            raise RuntimeError('Invalid ZIP entry: ' + damaged)
    print(path.name, path.stat().st_size, 'bytes; ZIP CRC OK', flush=True)

if not (stage / 'runtime' / 'python.exe').is_file() or not (stage / 'Start-Asyl-AI.cmd').is_file():
    raise SystemExit('Prepare and test the portable build first.')
with zipfile.ZipFile(generic, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
    for source in sorted(stage.rglob('*')):
        relative = source.relative_to(stage)
        if source.is_file() and not any(part in exclude for part in relative.parts):
            archive.write(source, (Path('Asyl-AI') / relative).as_posix())
verify(generic)
(out / 'Asyl-AI-Windows-x64.sha256').write_text(checksum(generic) + '  ' + generic.name + '\n', encoding='ascii')

if args.personal:
    # Two explicitly selected files. No server secrets, data, passwords or logs.
    private_files = [root / 'local-data' / 'remote-worker.json', root / 'local-data' / 'Код входа в кабинет.txt']
    if not all(p.is_file() for p in private_files):
        raise SystemExit('Personal connection files are missing.')
    shutil.copyfile(generic, private)
    with zipfile.ZipFile(private, 'a', compression=zipfile.ZIP_DEFLATED) as archive:
        for source in private_files:
            archive.write(source, 'Asyl-AI/local-data/' + source.name)
    with zipfile.ZipFile(connection, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for source in private_files:
            archive.write(source, 'Asyl-AI/local-data/' + source.name)
    verify(private)
    verify(connection)
    (out / 'PERSONAL-SHA256SUMS.txt').write_text(''.join(checksum(p) + '  ' + p.name + '\n' for p in [private, connection]), encoding='ascii')
    print('Personal ZIP files contain access settings. Do NOT upload them to GitHub.', flush=True)
