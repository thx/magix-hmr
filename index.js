const portfinder = require('portfinder')
const fs = require('fs')
const chalk = require('chalk')
const gulp = require('gulp')
const path = require('path')
const WebSocket = require('ws')
const hmrjsfn = require('./hmr')
const requestPromise = require('request-promise')

module.exports = ({
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
    // cssSelectorPrefix,
    //可以自行指定注入到页面的hmr脚本
    hmrJs,
    rootAppName = 'app', //默认的项目app目录名
    //可以固定websocket的端口号，不自动生成
    wsPort,
    closeDesiger,
    combineTool,
    host = '127.0.0.1',
    mdPort = 3007 //magix-desiger用的端口号，注入到页面上
}, ws) => {

    if (wsPort) {
        startServer()
    } else {
        //获取一个未被占用的端口
        portfinder.getPort((err, _wsPort) => {
            wsPort = _wsPort
            startServer()
        })
    }

    function startServer() {
        if (!ws) {
            ws = new WebSocket.Server({
                port: wsPort
            })
        }

        console.log(chalk.green(`[HMR] 服务已启动`))

        ws.on('connection', client => {
            console.log(chalk.green('[HMR] websocket握手成功'))
        })

        gulp.watch(watchFiles, (e) => {
            let filePath = e.path
            console.log('[HMR]', chalk.green('file changed'), chalk.cyan(filePath))

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
                // console.log('[HMR]', chalk.green('remove cahce'), chalk.cyan(filePath))
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

            if (!isReload) {
                //less/html等文件找到最终依赖viewjs
                //js文件即是本身
                let extname = path.extname(filePath)
                let depsPaths = []
                let supportJs = ['.js', '.ts', '.es']
                if (supportJs.indexOf(extname) > -1) {
                    depsPaths = [filePath]
                } else {
                    let deps = combineTool.getFileDependents(filePath)
                    for (let k in deps) {
                        depsPaths.push(k)
                    }
                }

                pathObjs = {
                    originPath: filePath,
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

    }

    return function* combine(next) {
        yield next

        let body = this.body.toString()
        if (body == 'Not Found') {
            throw new Error('路径：' + this.path + ' 对应的文件没有找到')
        }

        //--closeDesiger 控制是否启用magix-desiger
        let magixDesigerJs
        if (!closeDesiger) {
            //magix-desiger相关的js注入，保存在alp上面
            magixDesigerJs = yield requestPromise({
                url: 'https://mo.m.taobao.com/magix_desiger_page_version',
                rejectUnauthorized: false
            })
        }

        //浏览器端的websocket代码
        host = host.replace(/^https?:\/\//, '')
        hmrJs = hmrJs || hmrjsfn(wsPort, host, rootAppName)

        //插入热更新所需要的js文件
        body = body.replace('</body>', `
            <script>${hmrJs}</script>
            <!-- <magix-designer-port>${mdPort}</magix-designer-port> -->  
            ${magixDesigerJs ? `<script src="${magixDesigerJs}"></script>` : ``}
            </body>
        `)
        this.body = body
    }
}