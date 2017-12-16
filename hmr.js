/**
 * 利用websocket实现view层级热更新
 *  - 浏览器端websocket服务
 *  - wsPort要与matfile.js里启动的ws服务的端口相同
 *  - 基于seajs模块加载器
 */
;
(function () {
    seajs.use(['magix', '$$'], function (M, $) {
        var oldMountView = M.Vframe.mountView;
        M.Vframe.mountView = function (path, params) {
            this.viewInitParams = params;
            oldMountView.apply(this, arguments);
        };
        var View_ApplyStyle = function (key, css) {
            if (css && !View_ApplyStyle[key]) {
                View_ApplyStyle[key] = 1;
                $('head').append('<style id="' + key + '">' + css + '</style>');
            }
        };
        M.applyStyle = View_ApplyStyle;
    });

    var ws = new WebSocket('ws://127.0.0.1:${wsPort}')
    ws.onopen = function () {
        console.log("[HMR] websocket 握手成功!");
        ws.send('[HMR] 浏览器端发送的信息')
    };
    ws.onclose = function (e) {
        console.log('[HMR] websocket 服务器关闭了!')
    }
    ws.onmessage = function (e) {
        var pathObjs = JSON.parse(e.data)
        console.log('[HMR] 本地修改的文件数据', pathObjs)

        //将本地文件path处理成magix view的path
        //exp: /Users/chongzhi/work/scaffold/src/app/views/examples/third.html --> app/views/examples/third
        //dirname: 指定包路径起始文件夹
        var resolvePath2View = function (_path, dirname = 'app') {
            var rexp = new RegExp(`.+(${dirname}\/[^\.]+)(?:\.[^\.]+)?`)
            var parse = rexp.exec(_path)
            return parse && parse[1]
        }

        //找到对应的view更新
        seajs.use(['magix', '$$'], function (magix, $) {
            var allVframes = magix.Vframe.all()
            var currentVframes = [] //有可能有多个相同的view

            for (var key in allVframes) {
                var vframe = allVframes[key]
                var info = magix.parseUrl(vframe.path);

                pathObjs.depsPaths.forEach(function (_path) {
                    if (info.path === resolvePath2View(_path)) {
                        currentVframes.push(vframe)
                    }
                })
            }
            //如果存在对应的view，则更新
            if (currentVframes.length) {
                //支持多种样式格式
                var supportStyles = /(:?\.css|\.less|\.sass|\.scss)$/

                if (supportStyles.test(pathObjs.originPath)) {
                    var styles = magix.applyStyle;
                    var added = '${cssSelectorPrefix}_' + resolvePath2View(pathObjs.originPath).replace(/\//g, '_') + '_';
                    for (var s in styles) {
                        if (s == added) {
                            delete styles[s];
                            $('#' + s).remove();
                            break;
                        }
                    }
                }

                currentVframes.forEach(function (vf) {
                    // require 移除view模块缓存
                    pathObjs.depsPaths.forEach(function (_path) {
                        var view = resolvePath2View(_path);
                        var path = seajs.resolve(view);
                        delete seajs.cache[path];
                        delete seajs.data.fetchedList[path];
                        // 重新加载view模块
                        vf.mountView(vf.path, vf.viewInitParams)
                    })
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