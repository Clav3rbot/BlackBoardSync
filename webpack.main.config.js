const rules = require('./webpack.rules')
const plugins = require('./webpack.plugins')
const CopyPlugin = require('copy-webpack-plugin')
const path = require('path')

module.exports = {
    entry: './src/index.ts',
    module: { rules },
    plugins: [
        ...plugins,
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
