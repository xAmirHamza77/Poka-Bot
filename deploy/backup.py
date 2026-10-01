"""Online SQLite backup plus the encryption key; output archives are private."""
import os, sqlite3, tarfile, tempfile
from pathlib import Path
from datetime import datetime, timezone
root = Path('/var/lib/poka')
out = root / 'backups'; out.mkdir(mode=0o700, exist_ok=True)
name = out / (datetime.now(timezone.utc).strftime('poka-%Y%m%d-%H%M%S') + '.tar.gz')
with tempfile.TemporaryDirectory(dir=out) as temp:
    snapshot = Path(temp) / 'poka.sqlite3'
    # Discover the database filename without opening a nonexistent database.
    database = next((root/'data').glob('*.sqlite3'))
    with sqlite3.connect(str(database)) as source, sqlite3.connect(str(snapshot)) as target:
        source.backup(target)
    with tarfile.open(name, 'w:gz') as archive:
        archive.add(snapshot, arcname='data/' + database.name)
        for item in (root/'data').iterdir():
            if item != database and not item.name.endswith(('-wal', '-shm')):
                archive.add(item, arcname='data/' + item.name)
        archive.add(root/'workspace', arcname='workspace')
name.chmod(0o600)
for stale in sorted(out.glob('poka-*.tar.gz'))[:-14]: stale.unlink()
print('Poka backup completed.')
