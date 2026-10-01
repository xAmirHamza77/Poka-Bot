"""Private online backup of a Windows Poka server, retaining 14 snapshots."""
import json
import sqlite3
import tarfile
import tempfile
from pathlib import Path
from datetime import datetime, timezone
root=Path(__file__).resolve().parent
config=json.loads((root/'config.json').read_text(encoding='utf-8-sig'))
data=Path(config['DATA_DIR']);workspace=Path(config['WORKSPACE_ROOT']);out=root/'backups';out.mkdir(exist_ok=True)
name=out/datetime.now(timezone.utc).strftime('poka-%Y%m%d-%H%M%S.tar.gz')
database=next(data.glob('*.sqlite3'))
with tempfile.TemporaryDirectory(dir=out) as temp:
    snapshot=Path(temp)/database.name
    with sqlite3.connect(database) as source,sqlite3.connect(snapshot) as target:source.backup(target)
    with tarfile.open(name,'w:gz') as archive:
        archive.add(snapshot,arcname='data/'+database.name)
        for item in data.iterdir():
            if item!=database and not item.name.endswith(('-wal','-shm')):archive.add(item,arcname='data/'+item.name)
        if workspace.exists():archive.add(workspace,arcname='workspace')
        archive.add(root/'config.json',arcname='config.json')
for old in sorted(out.glob('poka-*.tar.gz'))[:-14]:old.unlink()
print('Poka backup completed.')
