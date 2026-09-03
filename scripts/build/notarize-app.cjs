const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');
const rootDir = path.resolve(__dirname, '..', '..');

async function notarizeApp() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const appName = packageJson.build.productName;
  const appPath = path.join(rootDir, `dist_build/dist_electron/mac-arm64/${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.error(`Error: App bundle not found at ${appPath}`);
    console.error('Please run the build:electron:prod:mac script first.');
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

  console.log(`Starting notarization for ${appPath}`);

  try {
    await notarize({
      appBundleId: packageJson.build.appId,
      appPath: appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
      tool: 'notarytool',
    });
    console.log('Notarization for .app submission successful! Waiting for Apple to process...');
  } catch (error) {
    console.error('Notarization for .app failed:', error);
    process.exit(1);
  }
}

notarizeApp();
