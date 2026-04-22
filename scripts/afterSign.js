const { execSync } = require('child_process');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${appOutDir}/${appName}.app`;

  // Detect whether a real Developer ID identity is available. If the
  // env vars for notarization aren't set, we are in unsigned / ad-hoc
  // territory and must NOT attempt hardened-runtime signing or
  // notarization — both will produce a bundle that refuses to launch
  // on any Mac other than the build machine.
  const hasAppleCreds = Boolean(process.env.appleId && process.env.appleIdPassword);

  // Always do a deep ad-hoc re-sign as a safety net. electron-builder
  // signs per-file in a specific order; if any helper binary or
  // embedded framework ends up with a stale or missing signature the
  // whole bundle fails to launch on other machines with a generic
  // "cannot install" / "damaged" popup. Re-signing the whole tree
  // with ad-hoc (`-`) guarantees every Mach-O has a consistent
  // signature from the same identity.
  try {
    console.log(`[afterSign] Deep ad-hoc re-signing ${appName} ...`);
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log(`[afterSign] Ad-hoc signature verified on ${appName}.app`);
  } catch (err) {
    console.error('[afterSign] Ad-hoc re-sign failed:', err.message);
  }

  // Strip the com.apple.quarantine xattr from the bundle contents
  // before the DMG is built. (The DMG itself will still pick up a
  // quarantine bit when the user downloads it from a browser, but
  // inner binaries without quarantine launch more reliably.)
  try {
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('[afterSign] xattr -cr failed (non-fatal):', err.message);
  }

  if (!hasAppleCreds) {
    console.log(
      '[afterSign] No Apple Developer credentials in env — skipping notarization. ' +
        'Shipping ad-hoc signed bundle. End users must run "Open Anyway" once in ' +
        'System Settings → Privacy & Security (or xattr -dr com.apple.quarantine).',
    );
    return;
  }

  // Lazy-load notarize because @electron/notarize is ESM-only
  const { notarize } = await import('@electron/notarize');

  console.log(`[afterSign] Starting notarization for ${appName} (${appBundleId})...`);

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath: appPath,
      appleId: process.env.appleId,
      appleIdPassword: process.env.appleIdPassword,
      teamId: process.env.teamId,
    });
    console.log('[afterSign] Notarization completed successfully');
  } catch (error) {
    console.error('[afterSign] Notarization failed:', error);
    throw error;
  }
};
