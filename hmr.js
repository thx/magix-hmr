/**
 * 利用websocket实现view层级热更新
 *  - 浏览器端websocket服务
 *  - wsPort要与matfile.js里启动的ws服务的端口相同
 *  - 基于seajs模块加载器
 */

module.exports = (wsPort, host, isMagix5) => {
  return `
;
(function () {
    seajs.use(['${isMagix5 ? 'magix5' : 'magix'}'], function (Magix) {
        const oldMountView = Magix.Vframe.prototype.${isMagix5 ? 'mount' : 'mountView'};
        Magix.Vframe.prototype.mountView = function (${isMagix5 ? 'node, ' : ''}path, params) {
            this.viewInitParams = params;
            oldMountView.apply(this, arguments);
        };
    });

    const ws = new WebSocket('ws://${host}:${wsPort}')
    ws.onopen = function () {
        console.log("[HMR] websocket 握手成功!");
    };
    ws.onclose = function (e) {
        console.log('[HMR] websocket 服务器关闭了!')
    }
    ws.onmessage = function (e) {
        const pathObjs = JSON.parse(e.data)

        // isReload 强制直接刷新
        if (pathObjs.isReload) {
            return window.location.reload()
        }

        if (pathObjs.type === 'error') {
            console.error(pathObjs.message)
            return 
        }

        console.log('[HMR] 本地修改的文件数据', pathObjs)

        //将本地文件 path 处理成magix view 的 path
        //exp: /Users/chongzhi/work/scaffold/src/app/views/examples/third.html --> app/views/examples/third
        //dirname: 指定包路径起始文件夹

        //找到对应的view更新
        seajs.use(['${isMagix5 ? 'magix5' : 'magix'}'], function (Magix) {
            const allVframes = Magix.Vframe.all()
            const currentVframes = [] //有可能有多个相同的view

            for (const key in allVframes) {
                const vframe = allVframes[key]
                if (!vframe.path) continue
                const info = Magix.parseUrl(vframe.path);

                pathObjs.depsPaths.forEach(function (_path) {
                    if (info.path === _path) {
                        currentVframes.push(vframe)
                    }
                })
            }
            
            // 清除 Magix 缓存的样式文件，支持多种格式
            const supportStyles = /(:?\.css|\.less|\.sass|\.scss)$/
            if (supportStyles.test(pathObjs.originPath)) {
                const styles = Magix.applyStyle;
                for (const s in styles) {
                    if (s == pathObjs.originPathResolve) {
                        delete styles[s];
                        document.getElementById(s).remove()
                        break;
                    }
                }
            }

            // seajs 移除 view 模块缓存
            pathObjs.depsPaths.forEach(function (view) {
                const path = seajs.resolve(view);
                delete seajs.cache[path];
                delete seajs.data.fetchedList[path];
            })

            // 如果当前页面存在对应的 view，则立即更新
            if (currentVframes.length) {
                // 重新加载view模块
                currentVframes.forEach(function (vf) {
                    vf.${isMagix5 ? 'mount' : 'mountView'}(${isMagix5 ? 'vf.root, ' : ''}vf.path, vf.viewInitParams)
                })
            }

        }, function (err) {
            console.log('[HMR] 加载magix模块失败，重新刷新页面')
            window.location.reload()
        })
    }
})()
`
}
