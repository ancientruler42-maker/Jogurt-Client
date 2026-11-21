/**
 * Embed the Jogurt Client icon into the Windows .exe after pack.
 * Avoids electron-builder's winCodeSign path (needs admin/symlink rights).
 */
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = (context.packager.appInfo.productFilename || 'JogurtClient') + '.exe';
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found:', exePath);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('[afterPack] icon not found:', iconPath);
    return;
  }

  let rcedit;
  try {
    rcedit = require('rcedit');
  } catch (e) {
    console.warn('[afterPack] rcedit package missing, skip icon embed:', e.message);
    return;
  }

  const run = rcedit.rcedit || rcedit;
  console.log('[afterPack] embedding icon into', exePath);
  await run(exePath, {
    icon: iconPath,
    'version-string': {
      CompanyName: 'Jogurt',
      FileDescription: 'Jogurt Client',
      ProductName: 'Jogurt Client',
      OriginalFilename: exeName,
    },
    'product-version': context.packager.appInfo.version || '2.2.1',
    'file-version': context.packager.appInfo.version || '2.2.1',
  });
  console.log('[afterPack] icon embedded successfully');
};
