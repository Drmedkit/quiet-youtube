#!/usr/bin/python -I
"""Administrator installer. Installs the service; first password setup activates policy."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crx import pack

ROOT = Path(__file__).resolve().parent.parent
LIB = Path('/usr/local/lib/quiet-youtube')
SHARE = Path('/usr/local/share/quiet-youtube')
STATE = Path('/var/lib/quiet-youtube')
POLICIES = {'chromium': '/etc/chromium/policies/managed', 'chrome': '/etc/opt/chrome/policies/managed', 'brave': '/etc/brave/policies/managed'}
UNIT = Path('/etc/systemd/system/quiet-youtube.service')


def copy_owned(source, target):
    if any(path.is_symlink() for path in source.rglob('*')):
        raise ValueError('Refusing to install source files containing symlinks.')
    shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for path in [target, *target.rglob('*')]:
        os.chown(path, 0, 0)
        os.chmod(path, 0o755 if path.is_dir() or path.name == 'quiet-youtube' else 0o644)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', choices=POLICIES, default='chromium')
    parser.add_argument('--replace-extension', action='append', default=[], help='Block a previous unpacked prototype ID after activation.')
    parser.add_argument('--uninstall', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with pkexec or sudo. The parent password is set separately.')
    if args.uninstall:
        if not (SHARE / 'installation.json').exists():
            parser.error('No system installation found.')
        installed = json.loads((SHARE / 'installation.json').read_text())
        subprocess.run(['systemctl', 'disable', '--now', 'quiet-youtube.service'], check=True)
        Path(POLICIES[installed['browser']], 'quiet-youtube.json').unlink(missing_ok=True)
        UNIT.unlink(missing_ok=True)
        Path('/usr/local/bin/quiet-youtube').unlink(missing_ok=True)
        shutil.rmtree(LIB)
        shutil.rmtree(SHARE)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        print(json.dumps({'ok': True, 'data': {'uninstalled': True, 'retainedState': str(STATE)}}))
        return
    extension = ROOT / 'browser-extension'
    if not extension.is_dir():
        extension = ROOT / 'dist/extension'
    if not (extension / 'background.js').is_file():
        parser.error('Use the built release archive, or run npm run build first.')
    import re
    if any(not re.fullmatch('[a-p]{32}', eid) for eid in args.replace_extension):
        parser.error('Invalid previous extension ID.')
    if (SHARE / 'installation.json').exists():
        previous = json.loads((SHARE / 'installation.json').read_text())
        if previous['browser'] != args.browser:
            parser.error('Uninstall the existing browser deployment before selecting a different browser.')
    for path in (LIB, SHARE, STATE):
        if path.is_symlink():
            parser.error('Installation paths must not be symlinks.')
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, 0, 0)
        os.chmod(path, 0o700 if path == STATE else 0o755)
    policy_dir = Path(POLICIES[args.browser])
    policy_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(policy_dir, 0o755)
    key = STATE / 'signing.pem'
    if not key.exists():
        old_mask = os.umask(0o077)
        try:
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        finally:
            os.umask(old_mask)
    os.chmod(key, 0o600)
    # Stage all executable code and the signed browser artifact before updating
    # the service. The released installer does not execute scripts from a URL.
    with tempfile.TemporaryDirectory(prefix='quiet-youtube-install-') as temporary:
        staging = Path(temporary)
        copy_owned(ROOT / 'native', staging / 'native')
        eid, version = pack(extension, staging / 'extension.crx', key)
        shutil.copy2(staging / 'extension.crx', SHARE / 'extension.crx')
        copy_owned(staging / 'native', LIB)
    update_url = (SHARE / 'updates.xml').as_uri()
    (SHARE / 'updates.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">'
        f'<app appid="{eid}"><updatecheck codebase="{(SHARE / "extension.crx").as_uri()}" version="{version}" /></app></gupdate>\n')
    installation = dict(browser=args.browser, extensionId=eid, updateUrl=update_url,
                        policyPath=str(policy_dir / 'quiet-youtube.json'), replaces=args.replace_extension, version=version)
    (SHARE / 'installation.json').write_text(json.dumps(installation, indent=2) + '\n')
    for path in SHARE.iterdir():
        os.chown(path, 0, 0)
        os.chmod(path, 0o644)
    executable = Path('/usr/local/bin/quiet-youtube')
    if executable.is_symlink() and executable.resolve() == LIB / 'quiet-youtube':
        pass
    elif executable.exists() or executable.is_symlink():
        parser.error('An unrelated /usr/local/bin/quiet-youtube exists; refusing to replace it.')
    else:
        executable.symlink_to(LIB / 'quiet-youtube')
    unit = (ROOT / 'packaging/quiet-youtube.service').read_text().replace('@POLICY_DIR@', str(policy_dir))
    UNIT.write_text(unit)
    os.chmod(UNIT, 0o644)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', 'quiet-youtube.service'], check=True)
    subprocess.run(['systemctl', 'restart', 'quiet-youtube.service'], check=True)
    print(json.dumps({'ok': True, 'data': {'installed': True, 'browser': args.browser, 'extensionId': eid,
          'next': 'Set your parent password in the Omarchy panel to activate managed browser rules.'}}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'ok': False, 'error': {'code': 'install_failed', 'message': 'System installation failed. Inspect the installer and system service before retrying.'}}))
        sys.exit(1)
