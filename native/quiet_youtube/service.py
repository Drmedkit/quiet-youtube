import copy
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import socket
import socketserver
import struct
import tempfile
import threading
import time
import urllib.parse
import urllib.request

FILTERS = ('hideShorts', 'hideComments', 'hideRecommendations', 'hideSearch',
           'hideEndScreens', 'hideLiveChat', 'hideNotifications', 'disableAutoplay')
DEFAULTS = dict(homeFeed='subscriptions', channels=[], **dict.fromkeys(FILTERS, True))
CHANNEL_ID = re.compile(r'UC[\w-]{22}', re.ASCII)
MAX_REQUEST = 32768
SESSION_SECONDS = 900


class ControlError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def require(condition, message, code='invalid_request'):
    if not condition:
        raise ControlError(code, message)


def atomic_json(path, value, mode=0o600):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_settings(value):
    require(isinstance(value, dict), 'Settings must be an object.')
    require(not (set(value) - set(DEFAULTS)), 'Unknown settings key.')
    result = copy.deepcopy(DEFAULTS)
    for key, val in value.items():
        if key in FILTERS:
            require(type(val) is bool, f'{key} must be true or false.')
        elif key == 'homeFeed':
            require(val in ('subscriptions', 'home'), 'Choose subscriptions or home.')
        elif key == 'channels':
            require(isinstance(val, list) and len(val) <= 50, 'Use at most 50 channels.')
            seen = set()
            channels = []
            for channel in val:
                require(isinstance(channel, dict), 'Invalid channel.')
                cid = channel.get('id', '')
                require(isinstance(cid, str) and CHANNEL_ID.fullmatch(cid), 'Invalid channel ID.')
                require(cid not in seen, 'Duplicate channel ID.')
                seen.add(cid)
                name, handle = channel.get('name', cid), channel.get('handle', '')
                require(isinstance(name, str) and len(name) <= 160, 'Invalid channel name.')
                require(isinstance(handle, str) and len(handle) <= 100, 'Invalid channel handle.')
                require(not handle or re.fullmatch(r'@[\w.·-]{3,99}', handle), 'Invalid channel handle.')
                channels.append(dict(id=cid, name=name, handle=handle))
            val = channels
        result[key] = val
    return result


def password_hash(password, salt=None):
    require(isinstance(password, str) and 6 <= len(password) <= 128,
            'Use a parent password or PIN of 6 to 128 characters.')
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384,
                            r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32).hex()
    return {'salt': salt, 'hash': digest}


def resolve_channel(value):
    require(isinstance(value, str) and len(value) <= 500, 'Use a channel URL, ID or @handle.')
    value = value.strip()
    if CHANNEL_ID.fullmatch(value):
        path = '/channel/' + value
    elif value.startswith('@') and re.fullmatch(r'@[\w.·-]{3,99}', value):
        path = '/' + value
    else:
        url = urllib.parse.urlsplit(value if '://' in value else 'https://' + value)
        require(url.scheme == 'https' and url.netloc in ('www.youtube.com', 'youtube.com', 'm.youtube.com'),
                'Use an HTTPS YouTube channel URL.')
        match = re.fullmatch(r'/(channel/UC[\w-]{22}|@[\w.·%-]+|c/[\w.%-]+|user/[\w.%-]+)(?:/.*)?', url.path)
        require(match is not None, 'Use a channel link, not a video link.')
        path = '/' + match[1]
    # Only YouTube is fetched. Refuse redirects before sending any request to a
    # different host (including consent pages); never follow arbitrary URLs.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ControlError('channel_unavailable', 'YouTube redirected the channel request.')
    request = urllib.request.Request('https://www.youtube.com' + urllib.parse.quote(path, safe='/@%') + '?ucbcb=1&hl=en',
                                     headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=12) as response:
            data = response.read(8 * 1024 * 1024 + 1)
        require(len(data) <= 8 * 1024 * 1024, 'YouTube returned too much data.')
        html = data.decode('utf-8')
        match = re.search(r'(?:var )?ytInitialData\s*=\s*', html)
        require(match is not None, 'YouTube did not identify this channel.')
        initial, _ = json.JSONDecoder().raw_decode(html[match.end():])
        meta = initial['metadata']['channelMetadataRenderer']
        cid = meta['externalId']
        canonical = meta.get('vanityChannelUrl', '')
        handle = urllib.parse.unquote(urllib.parse.urlsplit(canonical).path).strip('/')
        if not handle.startswith('@'):
            handle = ''
        channel = dict(id=cid, name=str(meta.get('title', cid))[:160], handle=handle[:100])
        return validate_settings({'channels': [channel]})['channels'][0]
    except ControlError:
        raise
    except Exception:
        raise ControlError('channel_unavailable', 'Could not verify that channel with YouTube. Try again.') from None


def browser_policy(settings, enabled, installation):
    eid = installation['extensionId']
    update = installation['updateUrl']
    require(re.fullmatch('[a-p]{32}', eid), 'Invalid installed extension ID.')
    require(update.startswith(('file:///usr/local/share/quiet-youtube/', 'https://')),
            'Invalid installed update URL.')
    extensions = {eid: {'installation_mode': 'force_installed', 'update_url': update, 'override_update_url': True}}
    for old_id in installation.get('replaces', []):
        require(re.fullmatch('[a-p]{32}', old_id), 'Invalid previous extension ID.')
        if old_id != eid:
            extensions[old_id] = {'installation_mode': 'blocked'}
    return {
        'ExtensionSettings': extensions,
        'ExtensionDeveloperModeSettings': 1,
        'DeveloperToolsAvailability': 2,
        'BrowserGuestModeEnabled': False,
        'BrowserAddPersonEnabled': False,
        'IncognitoModeAvailability': 1,
        '3rdparty': {'extensions': {eid: {'ParentSettings': dict(settings, enabled=enabled)}}},
    }


class Manager:
    def __init__(self, state_dir, installation=None, demo=False, clock=time.time):
        self.directory = Path(state_dir)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / 'state.json'
        self.installation = installation
        self.demo = demo
        self.clock = clock
        self.sessions = {}
        self.lock = threading.RLock()
        if self.path.exists():
            self.state = json.loads(self.path.read_text())
            validate_settings(self.state['settings'])
            require(self.state.get('version') == 1, 'Unsupported saved state.')
        else:
            self.state = dict(version=1, password=None, enabled=False, settings=copy.deepcopy(DEFAULTS),
                              attempts=0, retryAfter=0, revision=0)
        self.sync_policy()

    def sync_policy(self):
        if self.installation and self.state['password']:
            policy = browser_policy(self.state['settings'], self.state['enabled'], self.installation)
            atomic_json(self.installation['policyPath'], policy, 0o644)

    def commit(self):
        # Persist intended rules first, then publish. A write failure is reported;
        # restart republishes the intended rules rather than silently relaxing.
        atomic_json(self.path, self.state)
        self.sync_policy()

    def status(self):
        policy_applied = False
        if self.installation and self.state['password']:
            try:
                expected = browser_policy(self.state['settings'], self.state['enabled'], self.installation)
                policy_applied = json.loads(Path(self.installation['policyPath']).read_text()) == expected
            except (OSError, ValueError):
                pass
        return dict(configured=bool(self.state['password']), enabled=self.state['enabled'],
                    settings=copy.deepcopy(self.state['settings']), revision=self.state['revision'],
                    deployment='demo' if self.demo else 'system', policyWritten=policy_applied,
                    browser=self.installation.get('browser') if self.installation else None,
                    retryAfter=max(0, int(self.state['retryAfter'] - self.clock())),
                    sessionSeconds=SESSION_SECONDS)

    def auth(self, request, uid):
        token = request.get('token', '')
        if not isinstance(token, str):
            return False
        session = self.sessions.get(token)
        return bool(session and session['uid'] == uid and session['expires'] > self.clock())

    def handle(self, request, uid):
        require(isinstance(request, dict), 'Request must be an object.')
        op = request.get('op')
        require(isinstance(op, str), 'Missing operation.')
        with self.lock:
            if op in ('status', 'config.get'):
                return self.status()
            if op == 'login':
                require(bool(self.state['password']), 'Set a parent password first.', 'not_configured')
                now = self.clock()
                require(now >= self.state['retryAfter'], 'Too many attempts. Wait before trying again.', 'rate_limited')
                password = request.get('password')
                valid = False
                if isinstance(password, str) and 6 <= len(password) <= 128:
                    candidate = password_hash(password, self.state['password']['salt'])
                    valid = hmac.compare_digest(candidate['hash'], self.state['password']['hash'])
                if not valid:
                    self.state['attempts'] += 1
                    if self.state['attempts'] >= 5:
                        self.state['retryAfter'] = now + min(900, 60 * 2 ** min(4, (self.state['attempts'] - 5) // 5))
                    atomic_json(self.path, self.state)
                    raise ControlError('wrong_password', 'Incorrect parent password.')
                self.state['attempts'], self.state['retryAfter'] = 0, 0
                atomic_json(self.path, self.state)
                self.sessions = {key: val for key, val in self.sessions.items() if val['expires'] > now}
                if len(self.sessions) >= 64:
                    self.sessions.pop(next(iter(self.sessions)))
                token = secrets.token_urlsafe(32)
                self.sessions[token] = dict(uid=uid, expires=now + SESSION_SECONDS)
                return dict(token=token, expiresAt=now + SESSION_SECONDS)
            if op == 'logout':
                if self.auth(request, uid):
                    self.sessions.pop(request['token'], None)
                return {'locked': True}
            if op == 'setup':
                require(uid == 0 or self.demo, 'Initial setup requires administrator authentication.', 'admin_required')
                require(not self.state['password'], 'A parent password is already set.', 'already_configured')
                self.state['password'] = password_hash(request.get('password'))
                self.state['enabled'] = True
                self.state['revision'] += 1
                self.commit()
                return self.status()
            # Even a direct call to this socket needs the password session.
            # Administrator recovery is explicit; ordinary mutations never get
            # an implicit exemption based on a panel's visible lock state.
            if op == 'password.reset':
                require(uid == 0, 'Password recovery requires administrator authentication.', 'admin_required')
            else:
                require(self.auth(request, uid), 'Unlock with the parent password first.', 'locked')
            if op == 'session.cli':
                # An explicit, short grant lets a parent close the panel and
                # ask an agent to work. It expires independently of the panel.
                now = self.clock()
                self.sessions = {key: value for key, value in self.sessions.items() if value['expires'] > now}
                require(len(self.sessions) < 64, 'Too many sessions. Lock an existing session first.')
                token = secrets.token_urlsafe(32)
                expires = min(now + SESSION_SECONDS, self.sessions[request['token']]['expires'])
                self.sessions[token] = dict(uid=uid, expires=expires)
                return dict(token=token, expiresAt=expires)
            if op in ('password.change', 'password.reset'):
                self.state['password'] = password_hash(request.get('password'))
                self.state['attempts'], self.state['retryAfter'] = 0, 0
                self.sessions.clear()
            elif op == 'protection.set':
                require(type(request.get('enabled')) is bool, 'enabled must be true or false.')
                self.state['enabled'] = request['enabled']
            elif op == 'settings.set':
                key = request.get('key')
                require(isinstance(key, str) and key in DEFAULTS and key != 'channels', 'Unknown setting.')
                self.state['settings'] = validate_settings(dict(self.state['settings'], **{key: request.get('value')}))
            elif op == 'config.import':
                self.state['settings'] = validate_settings(request.get('settings'))
            elif op == 'channels.add':
                channel = resolve_channel(request.get('input'))
                channels = self.state['settings']['channels']
                if not any(item['id'] == channel['id'] for item in channels):
                    self.state['settings'] = validate_settings(dict(self.state['settings'], channels=channels + [channel]))
            elif op == 'channels.remove':
                cid = request.get('id')
                require(isinstance(cid, str) and CHANNEL_ID.fullmatch(cid), 'Use the stable channel ID.')
                self.state['settings']['channels'] = [c for c in self.state['settings']['channels'] if c['id'] != cid]
            else:
                raise ControlError('unknown_operation', 'Unknown operation.')
            self.state['revision'] += 1
            self.commit()
            return self.status()


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    def __init__(self, path, manager):
        self.manager = manager
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(str(path), Handler)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        super().process_request(request, address)

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(15)
        try:
            line = self.rfile.readline(MAX_REQUEST + 1)
            require(len(line) <= MAX_REQUEST and line.endswith(b'\n'), 'Invalid request size.')
            uid = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
            result = self.server.manager.handle(json.loads(line), uid)
            reply = {'ok': True, 'data': result}
        except ControlError as error:
            reply = {'ok': False, 'error': {'code': error.code, 'message': str(error)}}
        except (ValueError, UnicodeError, TypeError):
            reply = {'ok': False, 'error': {'code': 'invalid_request', 'message': 'Malformed request.'}}
        except Exception:
            # Never include raw requests, passwords, tokens or exception reprs.
            reply = {'ok': False, 'error': {'code': 'service_error', 'message': 'Could not apply the request. Check service health.'}}
        try:
            self.wfile.write((json.dumps(reply) + '\n').encode())
        except (OSError, TimeoutError):
            pass
