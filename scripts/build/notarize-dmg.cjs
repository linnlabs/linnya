const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');
const rootDir = path.resolve(__dirname, '..', '..');

async function notarizeDmg() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const appName = packageJson.build.productName;
  const version = packageJson.version;
  const arch = 'arm64'; // Assuming arm64, adjust if necessary
  const dmgPath = path.join(rootDir, `dist_build/dist_electron/${appName}-${version}-${arch}.dmg`);

  if (!fs.existsSync(dmgPath)) {
    console.error(`Error: DMG file not found at ${dmgPath}`);
    console.error('Please run the finalize-dmg:mac script first to create and sign the DMG.');
    process.exit(1);
  }

  if (!process.env.APPLE_ID) {
    console.error('Error: APPLE_ID environment variable is not set.');
    process.exit(1);
  }
  if (!process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.error('Error: APPLE_APP_SPECIFIC_PASSWORD environment variable is not set.');
    process.exit(1);
  }
  if (!process.env.APPLE_TEAM_ID) {
    console.error('Error: APPLE_TEAM_ID environment variable is not set.');
    process.exit(1);
  }

  console.log(`Starting notarization for ${dmgPath}`);

  try {
    await notarize({
      appBundleId: packageJson.build.appId, // This is still needed for context
      appPath: dmgPath, // We are notarizing the DMG directly
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
      tool: 'notarytool',
    });
    console.log('Notarization submission successful! Waiting for Apple to process...');
  } catch (error) {
    console.error('Notarization failed:', error);
    process.exit(1);
  }
}

notarizeDmg();
