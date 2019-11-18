/**
 * 利用websocket实现view层级热更新
 *  - 浏览器端websocket服务
 *  - wsPort要与matfile.js里启动的ws服务的端口相同
 *  - 基于seajs模块加载器
 */

module.exports = (wsPort, host, rootAppName) => {
    return `
;
(function () {
    seajs.use(['magix', '$$'], function (M, $) {
        var oldMountView = M.Vframe.prototype.mountView;
        M.Vframe.prototype.mountView = function (path, params) {
            this.viewInitParams = params;
            oldMountView.apply(this, arguments);
        };
    });

    var ws = new WebSocket('ws://${host}:${wsPort}')
    ws.onopen = function () {
        console.log("[HMR] websocket 握手成功!");
    };
    ws.onclose = function (e) {
        console.log('[HMR] websocket 服务器关闭了!')
    }
    ws.onmessage = function (e) {
        var parseData = JSON.parse(e.data)

        if (parseData.type === 'error') {
            console.error(parseData.message)
            return 
        }

        var pathObjs = parseData
        console.log('[HMR] 本地修改的文件数据', pathObjs)

        //将本地文件path处理成magix view的path
        //exp: /Users/chongzhi/work/scaffold/src/app/views/examples/third.html --> app/views/examples/third
        //dirname: 指定包路径起始文件夹
        var resolvePath2View = function (_path) {
            var rexp = new RegExp('.+(${rootAppName}\/[^\.]+)(?:\.[^\.]+)?')
            var parse = rexp.exec(_path)
            return parse && parse[1]
        }

        //找到对应的view更新
        seajs.use(['magix', '$$'], function (magix, $) {
            var allVframes = magix.Vframe.all()
            var currentVframes = [] //有可能有多个相同的view

            for (var key in allVframes) {
                var vframe = allVframes[key]
                if (!vframe.path) continue
                var info = magix.parseUrl(vframe.path);

                pathObjs.depsPaths.forEach(function (_path) {
                    if (info.path === resolvePath2View(_path)) {
                        currentVframes.push(vframe)
                    }
                })
            }
            //如果存在对应的view，则更新
            //if (currentVframes.length && currentVframes.length === pathObjs.depsPaths.length) 
            if (currentVframes.length) {
                //支持多种样式格式
                var supportStyles = /(:?\.css|\.less|\.sass|\.scss)$/

                if (supportStyles.test(pathObjs.originPath)) {
                    var styles = magix.applyStyle;
                    var added = '${rootAppName}_' + resolvePath2View(pathObjs.originPath).replace(/\\//g, '_') + '_';
                    for (var s in styles) {
                        if (s == added) {
                            delete styles[s];
                            $('#' + s).remove();
                            break;
                        }
                    }
                }

                // require 移除view模块缓存
                pathObjs.depsPaths.forEach(function (_path) {
                    var view = resolvePath2View(_path);
                    var path = seajs.resolve(view);
                    delete seajs.cache[path];
                    delete seajs.data.fetchedList[path];
                })

                // 重新加载view模块
                currentVframes.forEach(function (vf) {
                    vf.mountView(vf.path, vf.viewInitParams)
                })
            }
            //不存在则直接reload整个页面
            else {
                console.log('[HMR] 非view的js更改直接刷新页面')
                window.location.reload()
            }

        }, function (err) {
            console.log('[HMR] 加载magix模块失败，重新刷新页面')
            window.location.reload()
        })
    }
})()
`
}