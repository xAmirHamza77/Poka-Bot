const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const PE = await import('pe-library');
  const RE = await import('resedit');
  const exePath = path.join(context.appOutDir, 'Poka.exe');
  const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);
  const icon = RE.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '../build/icon.ico')));
  const groups = RE.Resource.IconGroupEntry.fromEntries(res.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
    RE.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icon.icons.map(item => item.data));
  }
  for (const version of RE.Resource.VersionInfo.fromEntries(res.entries)) {
    version.setFileVersion(0, 2, 0, 0, 1033);
    version.setProductVersion(0, 2, 0, 0, 1033);
    version.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Poka', ProductName: 'Poka', OriginalFilename: 'Poka.exe', InternalName: 'Poka', CompanyName: 'Poka contributors' });
    version.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};
