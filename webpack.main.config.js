module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/electron-main/main.js',
  /**
   * Native `.node` addon: bundling with @vercel/webpack-asset-relocator-loader can emit
   * `require(undefined + 'build/Release/keytar.node')` in dev. Load from node_modules at runtime.
   */
  externals: {
    keytar: 'commonjs2 keytar',
  },
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
};
