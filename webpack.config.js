import { createRequire } from "module";
import webpack from "webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyPlugin from "copy-webpack-plugin";

const require = createRequire(import.meta.url);

export default (_, argv) => ({
  entry: { main: "./app/index.tsx" },
  target: "web",
  devtool: argv.mode === "development" ? "source-map" : false,
  output: {
    filename: "[name].[contenthash].js",
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        // Disable fullySpecified for ESM modules in node_modules
        // (Aztec SDK uses `import 'process/browser'` without .js extension)
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./app/index.html",
    }),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
      process: "process/browser",
    }),
    new CopyPlugin({
      patterns: [
        { from: "app/assets", to: "assets", noErrorOnMissing: true },
      ],
    }),
  ],
  resolve: {
    extensions: [".tsx", ".ts", ".js", ".mjs", ".json"],
    alias: {
      "process/browser": "process/browser.js",
      "node:util": "util",
      "node:crypto": false,
      "node:fs": false,
      "node:path": false,
      "node:os": false,
      "node:stream": require.resolve("stream-browserify"),
      "node:buffer": require.resolve("buffer/"),
      "node:assert": require.resolve("assert/"),
    },
    fallback: {
      tty: false,
      path: false,
      net: false,
      crypto: false,
      fs: false,
      os: false,
      module: false,
      "node:util": require.resolve("util/"),
      util: require.resolve("util/"),
      assert: require.resolve("assert/"),
      buffer: require.resolve("buffer/"),
      stream: require.resolve("stream-browserify"),
    },
  },
  experiments: {
    asyncWebAssembly: true,
  },
  devServer: {
    port: 3000,
    hot: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    client: {
      overlay: false,
    },
    static: {
      directory: "./app",
      publicPath: "/",
    },
  },
});
