const portfinder = require('portfinder')
const fs = require('fs')
const chalk = require('chalk')
const gulp = require('gulp')
const path = require('path')
const WebSocket = require('ws')
const hmrjsfn = require('./hmr')

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
    cssSelectorPrefix,
    //可以自行指定注入到页面的hmr脚本
    hmrJs,
    //可以固定websocket的端口号，不自动生成
    wsPort,
    combineTool
}) => {

    if (wsPort) {
        startServer()
    } else {
        portfinder.getPort((err, _wsPort) => {
            wsPort = _wsPort
            startServer()
        })
    }

    //获取一个未被占用的端口
    function startServer() {
        const ws = new WebSocket.Server({
            port: wsPort
        })

        console.log(chalk.green(`[HMR] 服务已启动`))

        gulp.watch(watchFiles, (e) => {
            let filePath = e.path
            console.log(chalk.yellow('[HMR] file changed', filePath))

            /**
             * 针对less/scss文件可以指定它所被import的父级文件，以实现热更新
             * 样式文件中注释表明被引用的来源文件
             * 注释写法: 
             *   @call: ./index.less
             */
            let supportStyles = /(:?\.css|\.less|\.sass|\.scss)/
            if (supportStyles.test(path.extname(filePath))) {
                let styleContent = fs.readFileSync(filePath, 'utf8')
                let exec = /\/\*\s*@call\s*:\s*([^;^\s]+)\s*;?\s*\*\//.exec(styleContent)
                if (exec && exec[1]) {
                    filePath = path.resolve(path.dirname(filePath), exec[1])
                }
            }

            let pathObjs = {
                originPath: filePath,
                depsPaths: []
            }

            if (combineTool.removeCache) {
                console.log(chalk.yellow('[HMR] remove cahce', filePath))
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
                if (extname === '.js') {
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

        ws.on('connection', client => {
            console.log(chalk.green('[HMR] websocket握手成功'))
        });

    }

    return function* combine(next) {
        yield next

        let body = this.body.toString()
        if (body == 'Not Found') {
            throw new Error('路径：' + this.path + ' 对应的文件没有找到')
        }

        //浏览器端的websocket代码
        hmrJs = hmrJs || hmrjsfn(wsPort, cssSelectorPrefix)

        //插入热更新所需要的js文件
        body = body.replace('</body>', `<script>${hmrJs}</script></body>`)
        this.body = body
    }
}