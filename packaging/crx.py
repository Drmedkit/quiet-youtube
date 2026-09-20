"""Create a CRX3 with a device-local RSA key using OpenSSL (no private key in releases)."""
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import zipfile


def varint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    return bytes(result + bytes([value]))


def field(number, value):
    return varint((number << 3) | 2) + varint(len(value)) + value


def pack(source, destination, key):
    source, destination, key = Path(source), Path(destination), Path(key)
    public = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER'], stderr=subprocess.DEVNULL)
    identity = hashlib.sha256(public).digest()[:16]
    eid = ''.join(chr(97 + int(char, 16)) for char in identity.hex())
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob('*')):
            if path.is_symlink():
                raise ValueError('Extension files must not be symlinks.')
            if path.is_file():
                archive.write(path, str(path.relative_to(source)))
    archive = buffer.getvalue()
    signed_data = field(1, identity)
    signature = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key)],
                               input=b'CRX3 SignedData\0' + struct.pack('<I', len(signed_data)) + signed_data + archive,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout
    proof = field(1, public) + field(2, signature)
    header = field(2, proof) + field(10000, signed_data)
    destination.write_bytes(b'Cr24' + struct.pack('<II', 3, len(header)) + header + archive)
    version = json.loads((source / 'manifest.json').read_text())['version']
    return eid, version
