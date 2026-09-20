#!/usr/bin/env python3
from pathlib import Path
import argparse
import hashlib
import shutil
import tarfile

parser = argparse.ArgumentParser(description='Build the Omarchy release archive.')
parser.add_argument('--sync-repository', action='store_true', help='Refresh the committed browser-extension used by omarchy plugin add.')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root/'dist/omarchy-plugin'
if output.exists():
    shutil.rmtree(output)
output.mkdir(parents=True)
for name in ['manifest.json','README.md','AGENTS.md','CONTRIBUTING.md','LICENSE','THIRD-PARTY-NOTICES.md','licenses','CHANGELOG.md','SECURITY.md','native','omarchy','packaging','docs']:
    source = root/name
    if source.is_dir():
        shutil.copytree(source,output/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    else:
        shutil.copy2(source,output/name)
shutil.copytree(root/'dist/extension',output/'browser-extension')
if args.sync_repository:
    browser = root/'browser-extension'
    if browser.exists():
        shutil.rmtree(browser)
    shutil.copytree(root/'dist/extension',browser)
archive=root/'dist/quiet-youtube-omarchy.tar.gz'
with tarfile.open(archive,'w:gz') as bundle:
    def public_metadata(info):
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        return info
    bundle.add(output,arcname='quiet-youtube-omarchy',filter=public_metadata)
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.with_suffix(archive.suffix+'.sha256')).write_text(checksum+'  '+archive.name+'\n')
print('Omarchy package:',archive)
