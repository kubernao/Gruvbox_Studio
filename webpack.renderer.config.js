const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const CompressionPlugin = require('compression-webpack-plugin');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const rules = require('./webpack.rules');
const path = require('path');
const { isExpectedMonacoCancellation } = require('./src/frontend/components/DiffViewer/utils/monacoCancellation.js');

const isProduction = process.env.NODE_ENV === 'production';
const analyzeBundle = process.env.WEBPACK_ANALYZE === '1';

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

module.exports = {
  cache: {
    type: 'filesystem',
    buildDependencies: { config: [__filename] },
  },
  devtool: isProduction ? 'source-map' : 'eval-cheap-module-source-map',
  devServer: {
    client: {
      overlay: {
        errors: true,
        warnings: false,
        runtimeErrors: (error) => !isExpectedMonacoCancellation(error),
      },
    },
  },
  plugins: [
    new MonacoWebpackPlugin({
      filename: 'static/monaco/[name].worker.js',
      // Keep baseline language support lean; load niche languages on demand.
      languages: ['markdown', 'javascript', 'typescript', 'json', 'shell', 'css', 'yaml'],
    }),
    ...(isProduction
      ? [
          new CompressionPlugin({
            test: /\.(js|css|html|svg)$/i,
            algorithm: 'brotliCompress',
            filename: '[path][base].br',
            threshold: 10 * 1024,
            minRatio: 0.8,
          }),
        ]
      : []),
    ...(analyzeBundle ? [new BundleAnalyzerPlugin()] : []),
  ],
  module: {
    rules: [
      ...rules,
      ...(isProduction
        ? [
            {
              test: /\.(png|jpe?g|gif|webp|svg)$/i,
              type: 'asset',
              parser: {
                dataUrlCondition: { maxSize: 8 * 1024 },
              },
            },
          ]
        : []),
    ],
  },
  optimization: {
    chunkIds: 'deterministic',
    moduleIds: 'deterministic',
    // Keep preload bundles self-contained. A shared runtime chunk can prevent
    // preload from executing before renderer chunks are available, which leaves
    // `window.electronAPI` undefined at runtime.
    runtimeChunk: false,
    splitChunks: {
      // Do not split initial chunks; preload must not depend on additional
      // synchronous chunks at startup.
      chunks: 'async',
      maxInitialRequests: 20,
      cacheGroups: {
        monacoVendor: {
          test: /[\\/]node_modules[\\/]monaco-editor[\\/]/,
          name: 'vendor.monaco',
          priority: 30,
        },
        editorVendor: {
          test: /[\\/]node_modules[\\/](@mdxeditor|@codemirror|codemirror|mermaid|katex)[\\/]/,
          name: 'vendor.editor',
          priority: 20,
        },
        pdfVendor: {
          test: /[\\/]node_modules[\\/]pdfjs-dist[\\/]/,
          name: 'vendor.pdf',
          priority: 20,
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          priority: 10,
        },
      },
    },
    minimize: isProduction,
    minimizer: isProduction
      ? [
          new TerserPlugin({
            extractComments: false,
            terserOptions: {
              compress: {
                drop_console: process.env.STRIP_CONSOLE !== '0',
                passes: 2,
              },
              mangle: true,
              format: { comments: false },
            },
          }),
          new CssMinimizerPlugin(),
          new ImageMinimizerPlugin({
            minimizer: {
              implementation: ImageMinimizerPlugin.imageminMinify,
              options: {
                plugins: [
                  ['mozjpeg', { quality: 75 }],
                  ['pngquant', { quality: [0.65, 0.85] }],
                  ['svgo', { plugins: [{ name: 'preset-default' }] }],
                ],
              },
            },
          }),
        ]
      : [],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    fallback: {
      path: require.resolve('path-browserify'),
    },
    alias: {
      // Single React instance for the renderer bundle. Without this, libraries like `commit-graph`
      // can resolve a second copy of React and hooks throw: Cannot read properties of null (reading 'useState').
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      // Fork-ready seam: if commit-graph needs local patches, point this alias
      // at your fork build and update `src/renderer/features/versionControl/vendors/commitGraphVendor.ts`.
      // 'commit-graph': path.resolve(__dirname, 'submodules/commit-graph-fork/dist/index.js'),
    },
  },
};
