module.exports = {
    packagerConfig: {
        name: 'BlackBoard Sync',
        icon: './static/icons/win/icon',
    },
    plugins: [
        {
            name: '@electron-forge/plugin-webpack',
            config: {
                mainConfig: './webpack.main.config.js',
                renderer: {
                    config: './webpack.renderer.config.js',
                    entryPoints: [
                        {
                            html: './src/index.html',
                            js: './src/renderer.tsx',
                            name: 'main_window',
                            preload: {
                                js: './src/preload.ts',
                            },
                        },
                    ],
                },
            },
        },
    ],
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'BlackBoardSync',
                setupIcon: './static/icons/win/icon.ico',
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            config: {
                name: 'BlackBoard Sync',
                icon: './static/icons/mac/icon.icns',
                format: 'ULFO',
            },
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['win32', 'darwin', 'linux'],
        },
    ],
}
