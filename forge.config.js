const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

/**
 * Copies keytar into each packaged resources directory under node_modules so
 * webpack externals (`require('keytar')`) resolve correctly at runtime.
 */
function installKeytarForRuntime(packageResult) {
  const keytarSourceDir = path.resolve(__dirname, 'node_modules', 'keytar');
  if (!fs.existsSync(keytarSourceDir)) {
    throw new Error(`Expected keytar module at ${keytarSourceDir}`);
  }

  for (const outputPath of packageResult.outputPaths || []) {
    let resourcesDir = path.join(outputPath, 'resources');
    if (process.platform === 'darwin') {
      const appBundleName = fs.readdirSync(outputPath).find((entry) => entry.endsWith('.app'));
      if (!appBundleName) {
        continue;
      }
      resourcesDir = path.join(outputPath, appBundleName, 'Contents', 'Resources');
    }
    if (!fs.existsSync(resourcesDir)) {
      continue;
    }
    const targetDir = path.join(resourcesDir, 'node_modules', 'keytar');
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(keytarSourceDir, targetDir, { recursive: true, force: true });
  }
}

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: [
      'dist-rust',
      'submodules/pi-mono',
      'node_modules/keytar',
      'resources/app-icon.png',
      'resources/app-icon-macos.png',
    ],
    icon: path.resolve(__dirname, 'resources/app-icon'),
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      installKeytarForRuntime(packageResult);
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        port: 3001,
        // Keep dev CSP strict enough to avoid unsafe-eval warnings.
        devContentSecurityPolicy:
          "default-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:3001 http://127.0.0.1:3001 ws://localhost:3001 ws://127.0.0.1:3001;",
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/frontend/index.html',
              js: './src/frontend/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/electron-main/ipc/preload.js',
              },
            },
          ],
        },
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
