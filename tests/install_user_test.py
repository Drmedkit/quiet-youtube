import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest
from unittest.mock import patch


class UserInstallation(unittest.TestCase):
    def test_install_from_checkout_excludes_private_and_development_files(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / 'checkout'
            desktop_dir = base / 'desktop'
            source.mkdir()
            desktop_dir.mkdir()
            (source / 'packaging').mkdir()
            installer = source / 'packaging/install-user.py'
            shutil.copy2(Path(__file__).resolve().parents[1] / 'packaging/install-user.py', installer)
            public = {
                'manifest.json': json.dumps({'id': 'kids.quiet-youtube'}),
                'browser-extension/manifest.json': '{}',
                'omarchy/QuietYouTube.qml': '// fixture',
                'native/quiet_youtube/cli.py': '# fixture',
                'LICENSE': 'license fixture',
            }
            private = {
                '.demo-profile/Cookies': 'private cookie fixture',
                '.git/config': 'private remote fixture',
                '.env': 'private environment fixture',
                'state.json': 'private settings fixture',
                'signing.pem': 'private key fixture',
                'qa/screenshot.png': 'private screenshot fixture',
                'node_modules/example/index.js': '// development dependency',
                'native/__pycache__/cached.pyc': 'bytecode fixture',
            }
            for name, content in {**public, **private}.items():
                destination = source / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(content)
            with patch('pathlib.Path.home', return_value=desktop_dir), \
                 patch('os.getuid', return_value=1000), \
                 patch('subprocess.run'):
                runpy.run_path(str(installer), run_name='__main__')
            installed = desktop_dir / '.config/omarchy/plugins/kids.quiet-youtube'
            for name, content in public.items():
                self.assertEqual((installed / name).read_text(), content)
            for name in private:
                self.assertFalse((installed / name).exists(), name)
            self.assertTrue((desktop_dir / '.local/bin/quiet-youtube').is_file())


if __name__ == '__main__':
    unittest.main()
