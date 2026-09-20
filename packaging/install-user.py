#!/usr/bin/python -I
"""Install the Omarchy menu and CLI for the current user. No system policy changes."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime

root = Path(__file__).resolve().parent.parent
home = Path.home()
plugins = home / '.config/omarchy/plugins'
target = plugins / 'kids.quiet-youtube'
if os.getuid() == 0:
    sys.exit('Run this installer as the desktop user, not root.')
if not (root / 'browser-extension/manifest.json').is_file():
    sys.exit('Extract the built Omarchy release first; this installer uses its browser-extension folder.')
subprocess.run(['omarchy', 'plugin', 'validate', str(root)], check=True)
config = home / '.config/omarchy/shell.json'
if config.exists():
    shutil.copy2(config, config.with_name(config.name + '.before-quiet-youtube-' + datetime.now().strftime('%Y%m%d-%H%M%S')))
plugins.mkdir(parents=True, exist_ok=True)
if root != target:
    if target.exists():
        if not (target / 'manifest.json').is_file():
            sys.exit('Target folder is not an existing Quiet YouTube plugin.')
        import json
        if json.loads((target / 'manifest.json').read_text()).get('id') != 'kids.quiet-youtube':
            sys.exit('Target folder belongs to another plugin.')
    def ignore(source, names):
        skipped = [name for name in names if name == '__pycache__' or name.endswith('.pyc')]
        if Path(source) == root:
            # A git checkout can also contain development profiles, secrets,
            # dependencies and .git. Copy only release files into the plugin.
            allowed = {'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md',
                       'licenses', 'CHANGELOG.md', 'SECURITY.md', 'native', 'omarchy',
                       'packaging', 'docs', 'browser-extension'}
            skipped.extend(name for name in names if name not in allowed)
        return skipped
    # Publish entry points only after their files exist, so a live shell does
    # not cache a failed component while an update is being copied.
    shutil.copytree(root, target, dirs_exist_ok=True, ignore=ignore)
    shutil.copy2(root / 'manifest.json', target / 'manifest.json')
exe = home / '.local/bin/quiet-youtube'
exe.parent.mkdir(parents=True, exist_ok=True)
if exe.exists() and 'Quiet YouTube CLI launcher' not in exe.read_text():
    sys.exit('An unrelated ~/.local/bin/quiet-youtube exists; refusing to overwrite it.')
exe.write_text('#!/usr/bin/python -I\n# Quiet YouTube CLI launcher\nimport sys\nsys.path.insert(0, ' + repr(str(target / 'native')) + ')\nfrom quiet_youtube.cli import main\nmain()\n')
exe.chmod(0o755)
subprocess.run(['omarchy-shell','shell','rescanPlugins'], check=True)
subprocess.run(['omarchy','plugin','enable','kids.quiet-youtube','--section','right'], check=True)
print('Installed the Quiet YouTube menu and CLI. Open the top-right YouTube icon to set up parent controls.')
