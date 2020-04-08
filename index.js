const portfinder = require('portfinder')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const WebSocket = require('ws')
const hmrjsfn = require('./hmr')
const chokidar = require('chokidar')

module.exports = ({
    customLog = console.log,
    cwd = process.cwd(),
    //热更新监听的文件
    watchFiles = [
        'src/**/*.js',
        'src/**/*.ts',
        'src/**/*.mx',
        'src/**/*.css',
        'src/**/*.html',
        'src/**/*.scss',
        'src/**/*.less'
    ],
    //全局的样式，必须触发全页刷新
    scopedCss,
    //可以自行指定注入到页面的hmr脚本
    hmrJs,
    rootAppName = 'app', //默认的项目app目录名
    //可以固定websocket的端口号，不自动生成
    wsPort,
    combineTool,
    host = '127.0.0.1'
}, ws) => {
    let watcher

    if (wsPort) {
        watcher = startServer()
    } else {
        //获取一个未被占用的端口
        portfinder.getPort((err, _wsPort) => {
            wsPort = _wsPort
            watcher = startServer()
        })
    }

    function startServer() {
        if (!ws) {
            ws = new WebSocket.Server({
                port: wsPort
            })
        }

        customLog(chalk.green(`[HMR] 服务已启动`))
        const watcher = chokidar.watch(watchFiles)

        watcher.on('change', (_filePath) => {

            let filePath = path.resolve(cwd, _filePath)
            customLog('[HMR]', chalk.green('file changed'), chalk.cyan(filePath))

            /**
             * 针对less/scss文件可以指定它所被import的父级文件，以实现热更新
             * 样式文件中注释表明被引用的来源文件
             * 注释写法: 
             *   @dependent: ./index.less
             */
            let supportStyles = /(:?\.css|\.less|\.sass|\.scss)/
            if (supportStyles.test(path.extname(filePath))) {
                let styleContent = fs.readFileSync(filePath, 'utf8')
                let exec = /\/\*\s*@dependent\s*:\s*([^;\s]+)\s*;?\s*\*\//.exec(styleContent) // 注释形式 '/*...*/'
                let exec2 = /\/\/\s*@dependent\s*:\s*([^;\s]+);?/.exec(styleContent) //注释形式 '//'

                if (exec && exec[1]) {
                    filePath = path.resolve(path.dirname(filePath), exec[1])
                } else if (exec2 && exec2[1]) {
                    filePath = path.resolve(path.dirname(filePath), exec2[1])
                }
            }

            let pathObjs = {
                originPath: filePath,
                depsPaths: []
            }

            if (combineTool.removeCache) {
                // customLog('[HMR]', chalk.green('remove cahce'), chalk.cyan(filePath))
                combineTool.removeCache(filePath);
            }

            //combine-tool-config里配置的scopedCss特殊处理，直接全页刷新，不再HMR
            let isReload = false
            if (scopedCss && scopedCss.length) {
                scopedCss.forEach((cssPath) => {
                    if (path.relative(filePath, cssPath) === '') {
                        isReload = true
                    }
                })
            }

            function resolvePath2View(_path) {
                var rexp = new RegExp(`.+(${rootAppName}\/[^\.]+)(?:\.[^\.]+)?`)
                var parse = rexp.exec(_path)
                return parse && parse[1]
            }

            if (!isReload) {

                //less/html等文件找到最终依赖viewjs
                //js文件即是本身
                let extname = path.extname(filePath)
                let depsPaths = []
                let supportJs = ['.js', '.ts', '.es']
                if (supportJs.indexOf(extname) > -1) {
                    depsPaths = [resolvePath2View(filePath)]
                } else {
                    let deps = combineTool.getFileDependents(filePath)
                    for (let k in deps) {
                        depsPaths.push(resolvePath2View(k))
                    }
                }

                let originPathResolve = `${combineTool.config().projectName}_${resolvePath2View(filePath).replace(/\//g, '_')}_`;

                pathObjs = {
                    originPath: filePath,
                    originPathResolve,
                    depsPaths: depsPaths
                }
            }
            //多窗口多客户端同时发送信息
            ws.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(pathObjs));
                }
            })
        })

        return watcher

    }

    const returnComb = function* combine(next) {
        yield next
        let body = this.body.toString()
        if (body == 'Not Found') {
            throw new Error('路径：' + this.path + ' 对应的文件没有找到')
        }

        //浏览器端的websocket代码
        host = host.replace(/^https?:\/\//, '')
        hmrJs = hmrJs || hmrjsfn(wsPort, host)

        //插入热更新所需要的js文件
        body = body.replace('</body>', `
            <script>${hmrJs}</script>
            </body>
        `)
        this.body = body

    }
    returnComb.watcher = watcher
    return returnComb
}