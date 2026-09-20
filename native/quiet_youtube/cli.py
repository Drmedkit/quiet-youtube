import argparse
import getpass
import json
import os
from pathlib import Path
import socket
import sys
from .service import ControlError, Manager, Server, MAX_REQUEST, atomic_json

DEFAULT_SOCKET = '/run/quiet-youtube/control.sock'


def call(path, request):
    data = (json.dumps(request) + '\n').encode()
    if len(data) > MAX_REQUEST:
        raise ControlError('invalid_request', 'Request is too large.')
    try:
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(20)
            client.connect(path)
            client.sendall(data)
            with client.makefile('rb') as stream:
                response = json.loads(stream.readline(262145))
    except (OSError, ValueError):
        raise ControlError('unavailable', 'Quiet YouTube service is unavailable. Run the system installer first.') from None
    if not response.get('ok'):
        raise ControlError(response['error']['code'], response['error']['message'])
    return response['data']


def session_path(socket_path):
    import hashlib
    base = Path(os.environ.get('XDG_RUNTIME_DIR', '/run/user/' + str(os.getuid()))) / 'quiet-youtube'
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    if base.is_symlink() or base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077:
        raise ControlError('session_permissions', 'Session directory must be private to your account.')
    return base / (hashlib.sha256(socket_path.encode()).hexdigest()[:16] + '.json')


def load_token(path):
    try:
        if path.is_symlink() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
            raise ControlError('session_permissions', 'Session file must be private to your account.')
        return json.loads(path.read_text()).get('token', '')
    except FileNotFoundError:
        return ''


def password(prompt, stdin=False, confirm=False):
    if stdin:
        value = sys.stdin.readline(1024).rstrip('\r\n')
    else:
        if not sys.stdin.isatty():
            raise ControlError('password_required', 'Use an interactive terminal or --password-stdin. Never pass passwords as arguments.')
        value = getpass.getpass(prompt)
        if confirm and value != getpass.getpass('Repeat parent password: '):
            raise ControlError('password_mismatch', 'Passwords do not match.')
    return value


def parser():
    p = argparse.ArgumentParser(description='Quiet YouTube: parent-controlled YouTube rules for Omarchy.')
    p.add_argument('--socket', default=DEFAULT_SOCKET)
    p.add_argument('--json', action='store_true', help='Machine-readable output; never includes stored password hashes.')
    sub = p.add_subparsers(dest='command', required=True)
    for name in ('status', 'lock', 'rpc'):
        sub.add_parser(name)
    for name in ('setup', 'unlock', 'password'):
        command = sub.add_parser(name)
        command.add_argument('--password-stdin', action='store_true')
        if name == 'password':
            command.add_argument('--reset', action='store_true', help='Administrator recovery; requires root.')
    protect = sub.add_parser('protection')
    protect.add_argument('action', choices=['on', 'off'])
    channels = sub.add_parser('channels')
    channels.add_argument('action', choices=['list', 'add', 'remove'])
    channels.add_argument('value', nargs='?')
    settings = sub.add_parser('settings')
    settings.add_argument('action', choices=['get', 'set'])
    settings.add_argument('key', nargs='?')
    settings.add_argument('value', nargs='?')
    config = sub.add_parser('config')
    config.add_argument('action', choices=['export', 'import'])
    config.add_argument('file', nargs='?', help='JSON file or - for stdin/stdout.')
    serve = sub.add_parser('serve')
    serve.add_argument('--demo', action='store_true', help='Development only: user-owned state, no system policies.')
    serve.add_argument('--state-dir', default='/var/lib/quiet-youtube')
    serve.add_argument('--installation', default='/usr/local/share/quiet-youtube/installation.json')
    return p


def main():
    # Permit the convenient `quiet-youtube status --json` form for agents.
    argv = sys.argv[1:]
    if '--json' in argv:
        argv.remove('--json')
        argv.insert(0, '--json')
    args = parser().parse_args(argv)
    try:
        if args.command == 'serve':
            if not args.demo and os.getuid() != 0:
                raise ControlError('admin_required', 'The protected service must run as root.')
            installation = None if args.demo else json.loads(Path(args.installation).read_text())
            manager = Manager(args.state_dir, installation=installation, demo=args.demo)
            target = Path(args.socket)
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            if target.exists():
                try:
                    call(str(target), {'op': 'status'})
                except ControlError as error:
                    if error.code != 'unavailable':
                        raise
                    target.unlink()
                else:
                    raise ControlError('already_running', 'A service is already using this socket.')
            with Server(target, manager) as server:
                os.chmod(target, 0o600 if args.demo else 0o666)
                try:
                    server.serve_forever()
                finally:
                    target.unlink(missing_ok=True)
            return
        if args.command == 'rpc':
            raw = sys.stdin.buffer.readline(MAX_REQUEST + 1)
            if len(raw) > MAX_REQUEST:
                raise ControlError('invalid_request', 'Request is too large.')
            request = json.loads(raw)
            result = call(args.socket, request)
            if request.get('op') == 'session.cli':
                atomic_json(session_path(args.socket), result)
                result = {'cliAuthorized': True, 'expiresAt': result['expiresAt']}
            print(json.dumps({'ok': True, 'data': result}))
            return
        request = {'op': 'status'}
        session = None
        if args.command not in ('status', 'setup'):
            session = session_path(args.socket)
        if args.command == 'setup':
            request = {'op': 'setup', 'password': password('Choose parent password: ', args.password_stdin, True)}
        elif args.command == 'unlock':
            result = call(args.socket, {'op': 'login', 'password': password('Parent password: ', args.password_stdin)})
            atomic_json(session, result)
            result = {'unlocked': True, 'expiresAt': result['expiresAt']}
            print(json.dumps({'ok': True, 'data': result}) if args.json else 'Unlocked for 15 minutes. Run quiet-youtube lock when finished.')
            return
        elif args.command == 'lock':
            request = {'op': 'logout', 'token': load_token(session)}
        elif args.command == 'password':
            request = {'op': 'password.reset' if args.reset else 'password.change',
                       'password': password('New parent password: ', args.password_stdin, True)}
        elif args.command == 'protection':
            request = {'op': 'protection.set', 'enabled': args.action == 'on'}
        elif args.command == 'channels':
            if args.action != 'list':
                if not args.value:
                    raise ControlError('invalid_request', 'Supply a channel @handle, URL or ID.')
                request = {'op': 'channels.' + args.action,
                           'input' if args.action == 'add' else 'id': args.value}
        elif args.command == 'settings' and args.action == 'set':
            if args.key is None or args.value is None:
                raise ControlError('invalid_request', 'Supply a settings key and value.')
            value = {'true': True, 'false': False}.get(args.value, args.value)
            request = {'op': 'settings.set', 'key': args.key, 'value': value}
        elif args.command == 'config' and args.action == 'import':
            if not args.file:
                raise ControlError('invalid_request', 'Supply a settings JSON file or - for stdin.')
            data = sys.stdin.read(MAX_REQUEST) if args.file == '-' else Path(args.file).read_text()
            request = {'op': 'config.import', 'settings': json.loads(data)}
        if session and 'token' not in request:
            request['token'] = load_token(session)
        result = call(args.socket, request)
        if args.command == 'lock' or args.command == 'password':
            session.unlink(missing_ok=True)
        if args.command == 'config' and args.action == 'export':
            result = result['settings']
            if args.file and args.file != '-':
                # Never export the password hash or a live session token.
                atomic_json(args.file, result)
                result = {'exported': args.file}
        elif args.command == 'channels' and args.action == 'list':
            result = result['settings']['channels']
        elif args.command == 'settings' and args.action == 'get':
            result = result['settings']
        print(json.dumps({'ok': True, 'data': result}) if args.json else json.dumps(result, indent=2))
    except (ControlError, OSError, ValueError) as error:
        code = error.code if isinstance(error, ControlError) else 'local_error'
        message = str(error) if isinstance(error, ControlError) else 'Could not read or write the requested local configuration.'
        if args.json or args.command == 'rpc':
            print(json.dumps({'ok': False, 'error': {'code': code, 'message': message}}))
        else:
            print(message, file=sys.stderr)
        sys.exit(1)
