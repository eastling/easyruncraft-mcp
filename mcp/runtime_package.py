"""Install immutable runtime packages. Never extract archive paths or links unchecked."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

TOOLS = ('photo', 'light', 'vector', 'fig', 'design', 'film', 'effect', 'sound', 'pdf', 'word', 'grid', 'deck', 'cad')


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def install(archive, store, expected_hash, smoke=False):
    if digest(archive) != expected_hash:
        raise ValueError('Package checksum mismatch')
    store = Path(store).resolve()
    store.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 10000 or len({m.name for m in members}) != len(members):
            raise ValueError('Invalid package file list')
        header = next(m for m in members if m.name == 'manifest.json')
        if not header.isfile() or header.size > 2 * 1024 * 1024:
            raise ValueError('Invalid package manifest')
        manifest = json.load(tar.extractfile(header))
        revision = manifest.pop('revision')
        if hashlib.sha256(canonical(manifest)).hexdigest() != revision:
            raise ValueError('Package revision mismatch')
        manifest['revision'] = revision
        kind, slug = manifest['kind'], manifest['slug']
        if manifest['contract'] != 1 or kind not in ('browser', 'native') or slug not in TOOLS:
            raise ValueError('Unsupported runtime contract')
        pins = {f['path']: f for f in manifest['files']}
        if len(pins) != len(manifest['files']) or {m.name for m in members} != {'manifest.json', *('files/' + p for p in pins)}:
            raise ValueError('Package contents differ from manifest')
        if sum(p['bytes'] for p in pins.values()) > 1024 * 1024 * 1024:
            raise ValueError('Package exceeds expanded size limit')
        target = store / kind / 'releases' / slug / revision
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.install-', dir=target.parent))
        try:
            for member in members:
                if member.name == 'manifest.json':
                    continue
                relative = member.name.removeprefix('files/')
                path = PurePosixPath(relative)
                if path.is_absolute() or '..' in path.parts or str(path) != relative or not member.isfile():
                    raise ValueError('Unsafe package path or file type')
                pin = pins[relative]
                if member.size != pin['bytes'] or member.size < 0:
                    raise ValueError('Package file size mismatch')
                destination = staging / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, destination.open('xb') as output:
                    shutil.copyfileobj(source, output)
                if digest(destination) != pin['sha256']:
                    raise ValueError('Package file checksum mismatch')
                destination.chmod(0o755 if kind == 'native' and relative == manifest['binary'] else 0o644)
            if kind == 'browser':
                from urllib.parse import urlsplit
                entry = urlsplit(manifest['entry']).path
                if entry not in pins or not entry.endswith('.html') or '#' in manifest['entry']:
                    raise ValueError('Browser entry is absent from package')
                for item in manifest.get('preloads', []):
                    if item['href'] not in pins or item['rel'] not in ('preload', 'modulepreload'):
                        raise ValueError('Invalid browser preload')
            else:
                if manifest['platform'] != 'linux-x86_64' or manifest['binary'] != slug + 'craft-cli' or manifest['binary'] not in pins:
                    raise ValueError('Native executable is absent from package')
                if smoke:
                    executable = staging / manifest['binary']
                    staging.chmod(0o755)
                    result = subprocess.run([str(executable), 'version' if slug == 'grid' else '--version'],
                                            capture_output=True, text=True, timeout=30, cwd='/tmp',
                                            user=65534 if os.getuid() == 0 else None,
                                            group=65534 if os.getuid() == 0 else None,
                                            env={'PATH': '/usr/bin:/bin', 'HOME': '/tmp', 'LANG': 'C.UTF-8'})
                    if result.returncode or manifest['version'] not in result.stdout:
                        raise ValueError('Native executable version/startup check failed')
            (staging / 'manifest.json').write_bytes(canonical(manifest))
            # The package directory becomes visible only when every file is verified.
            if target.exists():
                if (target / 'manifest.json').read_bytes() != canonical(manifest):
                    raise ValueError('Immutable runtime revision already differs')
                for relative, pin in pins.items():
                    if digest(target / relative) != pin['sha256']:
                        raise ValueError('Installed immutable runtime was modified')
            else:
                staging.chmod(0o755)
                os.rename(staging, target)
            return {k: v for k, v in manifest.items() if k != 'files'}
        finally:
            if staging.exists():
                shutil.rmtree(staging)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('store')
    parser.add_argument('sha256')
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    print(json.dumps(install(args.archive, args.store, args.sha256, args.smoke)))
