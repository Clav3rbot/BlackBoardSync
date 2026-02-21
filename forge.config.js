const path = require('path')

module.exports = {
    packagerConfig: {
        name: 'BlackBoard Sync',
        icon: path.resolve(__dirname, 'static/icons/win/icon'),
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
                setupExe: 'BlackBoard Sync Setup.exe',
            },
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['win32'],
        },
        {
            name: '@electron-forge/maker-dmg',
            config: arch => ({
                name: `BlackBoard Sync macOS-${arch}`,
                icon: path.resolve(__dirname, 'static/icons/mac/icon.icns'),
                format: 'ULFO',
                overwrite: true,
            }),
        },
    ],
    publishers: [
        {
            name: '@electron-forge/publisher-github',
            config: {
                repository: {
                    name: 'BlackBoardSync',
                    owner: 'Clav3rbot',
                },
                draft: true,
            },
        },
    ],
}
