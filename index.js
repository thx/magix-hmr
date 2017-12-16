const portfinder = require('portfinder')
const fs = require('fs')
const chalk = require('chalk')
const gulp = require('gulp')
const path = require('path')
const combineTool = require('magix-combine')
const combineDeps = require('magix-combine/plugins/util-deps')
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
    hmrJs
}) => {

    let wsPort //websocket端口

    //获取一个未被占用的端口
    portfinder.getPort((err, _wsPort) => {
        wsPort = _wsPort
        const ws = new WebSocket.Server({
            port: wsPort
        })

        console.log(chalk.green(`[HMR] 服务已启动`))

        gulp.watch(watchFiles, (e) => {
            console.log(chalk.yellow('[HMR] file changed', e.path))
            let pathObjs = {
                originPath: e.path,
                depsPaths: []
            }

            if (combineTool.removeCache) {
                console.log(chalk.yellow('[HMR] remove cahce', e.path))
                combineTool.removeCache(e.path);
            }

            //combine-tool-config里配置的scopedCss特殊处理，直接全页刷新，不再HMR
            let isReload = false
            if (scopedCss && scopedCss.length) {
                scopedCss.forEach((cssPath) => {
                    if (path.relative(e.path, cssPath) === '') {
                        isReload = true
                    }
                })
            }

            if (!isReload) {
                //less/html等文件找到最终依赖viewjs
                //js文件即是本身
                let extname = path.extname(e.path)
                let depsPaths = []
                if (extname === '.js') {
                    depsPaths = [e.path]
                } else {
                    let deps = combineDeps.getDependencies(e.path)
                    for (let k in deps) {
                        depsPaths.push(k)
                    }
                }

                pathObjs = {
                    originPath: e.path,
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

    })

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