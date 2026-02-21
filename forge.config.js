const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')

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
                setupExe: 'BlackBoard Sync Windows Setup.exe',
            },
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
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
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
    hooks: {
        postMake: (_config, makeResults) => {
            // Zip the Windows .exe installer to avoid SmartScreen blocking
            const winRelease = makeResults.find(m => m.platform === 'win32')
            if (winRelease) {
                let zipPath
                console.log('Zipping exe installer...')
                winRelease.artifacts.forEach(art => {
                    if (art.endsWith('.exe')) {
                        zipPath = art.slice(0, -3) + 'zip'
                        const zip = new AdmZip()
                        zip.addFile(path.basename(art), fs.readFileSync(art))
                        fs.writeFileSync(zipPath, zip.toBuffer())
                    }
                })
                if (zipPath) {
                    winRelease.artifacts.push(zipPath)
                }
            }
            return makeResults
        },
    },
}
