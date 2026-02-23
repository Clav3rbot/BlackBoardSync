const rules = require('./webpack.rules')
const plugins = require('./webpack.plugins')
const CopyPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')
const path = require('path')
const { execSync } = require('child_process')

// Get the current git commit hash at build time
const GIT_COMMIT_HASH = execSync('git rev-parse HEAD').toString().trim()

module.exports = {
    entry: './src/index.ts',
    module: { rules },
    plugins: [
        ...plugins,
        new webpack.DefinePlugin({
            BUILD_COMMIT_HASH: JSON.stringify(GIT_COMMIT_HASH),
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'static/icons'),
                    to: path.resolve(__dirname, '.webpack/main/static/icons'),
                },
            ],
        }),
    ],
    resolve: {
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.scss'],
    },
}
