const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const rules = require('./webpack.rules');
const plugins = require('./webpack.plugins');

module.exports = {
    mode: 'production',
    entry: './src/renderer.tsx',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.[contenthash].js',
        clean: true,
    },
    module: { rules },
    resolve: {
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.scss'],
    },
    plugins: [
        ...plugins,
        new HtmlWebpackPlugin({ template: './src/index.html' }),
    ],
};
