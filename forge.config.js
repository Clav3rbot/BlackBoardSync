const path = require('path')

module.exports = {
    packagerConfig: {
        name: 'BlackBoard Sync',
        icon: path.resolve(__dirname, 'static/icons/win/icon'),
        asar: true,
        extraResource: [
            path.resolve(__dirname, 'static'),
        ],
    },
    hooks: {
        postPackage: async (forgeConfig, options) => {
            // Remove unused locale files (keep only English and Italian)
            const fs = require('fs')
            const localesDir = path.join(options.outputPaths[0], 'locales')
            if (fs.existsSync(localesDir)) {
                const keep = ['en-US.pak', 'it.pak']
                fs.readdirSync(localesDir).forEach(file => {
                    if (!keep.includes(file)) {
                        fs.unlinkSync(path.join(localesDir, file))
                    }
                })
                console.log('Cleaned locales, kept:', keep.join(', '))
            }
        },
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
                draft: false,
            },
        },
    ],
}
