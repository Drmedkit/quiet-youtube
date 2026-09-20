import concurrent.futures
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
from quiet_youtube.service import Manager, ControlError, DEFAULTS


class ParentControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.now = 1000
        self.install = dict(extensionId='a'*32, updateUrl='file:///usr/local/share/quiet-youtube/updates.xml',
                            policyPath=str(Path(self.tmp.name)/'policy.json'), browser='chromium')
        self.manager = Manager(Path(self.tmp.name)/'state', self.install, clock=lambda: self.now)

    def setup_parent(self):
        self.manager.handle({'op': 'setup', 'password': 'test-only-parent'}, 0)

    def login(self, uid=1000):
        return self.manager.handle({'op': 'login', 'password': 'test-only-parent'}, uid)['token']

    def assert_error(self, code, request, uid=1000):
        with self.assertRaises(ControlError) as error:
            self.manager.handle(request, uid)
        self.assertEqual(error.exception.code, code)

    def test_setup_requires_admin_and_never_resets_existing_password(self):
        self.assert_error('admin_required', {'op': 'setup', 'password': 'test-only-parent'})
        self.setup_parent()
        self.assert_error('already_configured', {'op': 'setup', 'password': 'different-parent'}, 0)
        saved = self.manager.path.read_text()
        self.assertNotIn('test-only-parent', saved)
        self.assertEqual(self.manager.path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('password', self.manager.status())

    def test_direct_socket_requests_cannot_bypass_panel_lock(self):
        self.setup_parent()
        for request in [
            {'op':'protection.set','enabled':False,'admin':True},
            {'op':'settings.set','key':'hideShorts','value':False},
            {'op':'channels.add','input':'@jawed'},
            {'op':'channels.remove','id':'UC4QobU6STFB0P71PMvOGN5A'},
            {'op':'config.import','settings':{}},
            {'op':'password.change','password':'attacker-password'},
        ]:
            self.assert_error('locked', request)
        self.assertTrue(self.manager.status()['enabled'])

    def test_sessions_are_uid_bound_expire_and_revoke(self):
        self.setup_parent()
        token = self.login()
        request = {'op':'protection.set','enabled':False,'token':token}
        self.assert_error('locked', request, 1001)
        self.manager.handle(request, 1000)
        self.now += 901
        self.assert_error('locked', request)
        token = self.login()
        self.manager.handle({'op':'logout','token':token}, 1000)
        self.assert_error('locked', dict(request, token=token))

    def test_explicit_agent_grant_outlives_panel_but_cannot_extend_its_deadline(self):
        self.setup_parent()
        parent = self.login()
        self.assert_error('locked', {'op': 'session.cli'})
        self.now += 200
        child = self.manager.handle({'op': 'session.cli', 'token': parent}, 1000)
        self.assertEqual(child['expiresAt'], 1900)
        self.manager.handle({'op': 'logout', 'token': parent}, 1000)
        request = dict(op='protection.set', enabled=False, token=child['token'])
        self.manager.handle(request, 1000)
        self.assert_error('locked', request, 1001)
        self.now = 1901
        self.assert_error('locked', request)

    def test_guess_delay_survives_restart(self):
        self.setup_parent()
        for _ in range(5):
            self.assert_error('wrong_password', {'op':'login','password':'wrong-password'})
        self.manager = Manager(self.manager.directory, self.install, clock=lambda:self.now)
        self.assert_error('rate_limited', {'op':'login','password':'test-only-parent'})
        self.now += 61
        self.assertTrue(self.login())

    def test_password_change_revokes_every_session_and_admin_recovery_is_explicit(self):
        self.setup_parent()
        first, second = self.login(), self.login(1001)
        self.manager.handle({'op':'password.change','password':'new-test-parent','token':first},1000)
        for uid, token in [(1000,first),(1001,second)]:
            self.assert_error('locked', {'op':'protection.set','enabled':False,'token':token},uid)
        self.assert_error('wrong_password', {'op':'login','password':'test-only-parent'})
        self.assert_error('admin_required', {'op':'password.reset','password':'reset-parent'})
        self.manager.handle({'op':'password.reset','password':'reset-parent'},0)
        self.assertTrue(self.manager.handle({'op':'login','password':'reset-parent'},1000)['token'])

    def test_pause_keeps_force_install_and_managed_controls(self):
        self.setup_parent()
        result = self.manager.handle({'op':'protection.set','enabled':False,'token':self.login()},1000)
        self.assertFalse(result['enabled'])
        self.assertTrue(result['policyWritten'])
        policy = json.loads(Path(self.install['policyPath']).read_text())
        self.assertEqual(policy['ExtensionSettings']['a'*32]['installation_mode'],'force_installed')
        self.assertNotIn('*',policy['ExtensionSettings'])
        self.assertFalse(policy['3rdparty']['extensions']['a'*32]['ParentSettings']['enabled'])
        restarted = Manager(self.manager.directory,self.install)
        self.assertFalse(restarted.status()['enabled'])
        self.assertEqual(Path(self.install['policyPath']).stat().st_mode & 0o777,0o644)

    def test_invalid_settings_do_not_replace_last_good_rules(self):
        self.setup_parent()
        token = self.login()
        before = self.manager.status()['settings']
        for settings in [{'hideShorts':'false'},{'mode':'subscriptions'},{'channels':[{'id':'not-channel'}]},{'homeFeed':'unsafe'}]:
            self.assert_error('invalid_request', {'op':'config.import','settings':settings,'token':token})
            self.assertEqual(self.manager.status()['settings'],before)

    def test_channel_resolution_occurs_only_after_auth_and_deduplicates(self):
        self.setup_parent()
        channel = dict(id='UC4QobU6STFB0P71PMvOGN5A',name='Jawed',handle='@jawed')
        with patch('quiet_youtube.service.resolve_channel',return_value=channel) as resolve:
            self.assert_error('locked',{'op':'channels.add','input':'@jawed'})
            resolve.assert_not_called()
            request = dict(op='channels.add',input='@jawed',token=self.login())
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                list(executor.map(lambda _:self.manager.handle(request,1000),range(4)))
            self.assertEqual(self.manager.status()['settings']['channels'],[channel])

    def test_saved_rules_and_password_survive_service_restart_but_tokens_do_not(self):
        self.setup_parent()
        token = self.login()
        self.manager.handle(dict(op='settings.set',key='hideComments',value=False,token=token),1000)
        self.manager = Manager(self.manager.directory,self.install,clock=lambda:self.now)
        self.assertFalse(self.manager.status()['settings']['hideComments'])
        self.assert_error('locked',dict(op='protection.set',enabled=False,token=token))
        self.assertTrue(self.login())


class CliTransport(unittest.TestCase):
    def test_real_socket_cli_and_private_session(self):
        with tempfile.TemporaryDirectory() as temp:
            socket_path = str(Path(temp)/'control.sock')
            cli = [str(ROOT/'native/quiet-youtube'),'--socket',socket_path]
            env = dict(os.environ,XDG_RUNTIME_DIR=temp)
            process = subprocess.Popen(cli+['serve','--demo','--state-dir',str(Path(temp)/'state')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    if Path(socket_path).exists():break
                    if process.poll() is not None:self.fail(process.stderr.read().decode())
                    time.sleep(.03)
                def run(arguments, stdin=None, success=True):
                    result = subprocess.run(cli+arguments+['--json'],input=stdin,text=True,capture_output=True,env=env,timeout=10)
                    self.assertEqual(result.returncode==0,success,result.stdout+result.stderr)
                    return json.loads(result.stdout)
                run(['setup','--password-stdin'],'test-stdin-parent\n')
                self.assertFalse(run(['protection','off'],success=False)['ok'])
                run(['unlock','--password-stdin'],'test-stdin-parent\n')
                run(['settings','set','hideSearch','false'])
                self.assertFalse(run(['status'])['data']['settings']['hideSearch'])
                run(['lock'])
                run(['protection','off'],success=False)
                # RPC errors remain parseable; an extra attacker field cannot authenticate.
                payload=json.dumps(dict(op='protection.set',enabled=False,authenticated=True))+'\n'
                run(['rpc'],payload,success=False)
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stderr.close()


if __name__=='__main__':unittest.main()
