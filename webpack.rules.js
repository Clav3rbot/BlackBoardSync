module.exports = [
    {
        test: /\.tsx?$/,
        exclude: /(node_modules|\.webpack)/,
        use: {
            loader: 'ts-loader',
            options: { transpileOnly: true },
        },
    },
    {
        test: /\.s[ac]ss$/i,
        use: [
            'style-loader',
            'css-loader',
            {
                loader: 'sass-loader',
                options: {
                    api: 'modern-compiler',
                },
            },
        ],
    },
    {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
    },
    {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
    },
]
