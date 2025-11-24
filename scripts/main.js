/**
 * ============================================================================
 * 模块名称: Visual QTE
 * 功能描述: 在 FVTT 中实现QTE。
 *           支持连击、随机位置、音效反馈及战报汇总。
 * 作者: Tiwelee
 * ============================================================================
 */

const MODULE_ID = 'visual-qte';
let qteSocket;

// 音效文件路径配置
const SOUNDS = {
    PERFECT: `modules/${MODULE_ID}/sounds/perfect.wav`,
    GOOD:    `modules/${MODULE_ID}/sounds/good.wav`,
    BAD:     `modules/${MODULE_ID}/sounds/bad.wav`
};

/* -------------------------------------------- */
/*  核心业务逻辑 (Core API)                      */
/* -------------------------------------------- */

/**
 * VisualQTE 静态类
 * 负责处理数据生成、Socket广播以及对外暴露 API 接口。
 * 这里的逻辑与 UI 解耦，方便宏命令直接调用。
 * 抽象出以后可以通过宏命令const qte = game.modules.get("visual-qte")?.api;
 * 获取qte，然后通过qte.trigger({
        count: 5,        // 5连击
        duration: 2000,  // 速度 2000ms
        gmPlay: true     // GM也玩
    });
    直接调用
    或者通过qte.openDialog();直接呼出菜单。
 */
class VisualQTE {

    /**
     * 触发 QTE 事件的主入口。
     * 生成随机序列并通过 Socket 分发给所有客户端。
     * 
     * @param {Object} options - 配置对象
     * @param {number} [options.count=3] - 连击次数 (生成几个按键)
     * @param {number} [options.duration=2500] - 单次 QTE 的持续时间 (毫秒)，越小越难
     * @param {boolean} [options.gmPlay=true] - GM 是否参与游戏
     * @param {Array<string>} [options.targetIds=[]] 指定的目标玩家ID列表，为空则广播所有人
     */
    static trigger({ count = 3, duration = 2500, gmPlay = true, targetIds = [], windowSize = 300 } = {}) {
        // 环境检查
        if (!qteSocket) {
            ui.notifications.error("Visual-QTE | Socketlib 未加载，无法运行。");
            return;
        }

        // 生成按键序列
        const sequence = [];
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '; // 26个字母 + 空格

        for (let i = 0; i < count; i++) {
            // 1. 随机按键
            const randomChar = chars.charAt(Math.floor(Math.random() * chars.length));
            const keyDisplay = randomChar === ' ' ? 'SPACE' : randomChar;
            const keyCode = randomChar === ' ' ? 'Space' : `Key${randomChar}`;
            
            // 2. 随机判定点 (为了游戏体验，限制在总时长的 30% ~ 70% 之间)
            const minRatio = 0.3;
            const maxRatio = 0.7;
            const randomRatio = Math.random() * (maxRatio - minRatio) + minRatio;
            const targetTime = duration * randomRatio;

            sequence.push({
                id: i,
                keyDisplay: keyDisplay,
                targetKey: keyCode,
                duration: duration,
                hitTime: targetTime,
                windowSize: windowSize // 判定窗口宽容度 (ms)
            });
        }

        const payload = { sequence, gmPlay };

        if (targetIds && targetIds.length > 0) {
            // 发送给指定玩家 (利用 socketlib 的 executeForUsers)
            // 这种模式下，不在列表里的人(包括GM)完全不会收到信号，所以不需要在客户端判断 gmPlay
            // socketlib 的 executeForUsers 会自动根据targetIds来发送，发送给特定玩家的参数是不带ID的，所以不需要修改下面的客户端逻辑
            qteSocket.executeForUsers("startQTESequence", targetIds, payload);
            ui.notifications.info(`QTE 已发送给 ${targetIds.length} 位指定玩家。`);
        }
        else{
            // 广播事件至所有客户端
            qteSocket.executeForEveryone("startQTESequence", payload);
            ui.notifications.info(`QTE 触发: ${count} 连击 (速度: ${duration}ms)`);
        }
        
    }

    /**
     * 打开配置窗口的快捷方法
     */
    static openDialog() {
        new QTEDialog().render(true);
    }
}

/* -------------------------------------------- */
/*  初始化与钩子 (Hooks & Init)                 */
/* -------------------------------------------- */

Hooks.once("socketlib.ready", () => {
    // 注册 Socket 处理函数
    qteSocket = socketlib.registerModule(MODULE_ID);
    qteSocket.register("startQTESequence", QTEOverlay.startSequence);

    // 暴露 API 到全局 game 对象
    // 使用方法: game.modules.get('visual-qte').api.trigger(...)
    game.modules.get(MODULE_ID).api = VisualQTE;

    console.log(`${MODULE_ID} | 初始化完成，API 已暴露。`);
});

/**
 * 在场景控制栏添加 GM 专用按钮
 */
Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user.isGM) return;
    
    const tokenTools = controls.find(c => c.name === 'token');
    if (tokenTools) {
        tokenTools.tools.push({
            name: 'trigger-qte',
            title: 'QTE 配置',
            icon: 'fas fa-stopwatch',
            onClick: () => {
                VisualQTE.openDialog();
            },
            button: true
        });
    }
});

/* -------------------------------------------- */
/*  配置界面 (Form Application)                 */
/* -------------------------------------------- */

/**
 * QTE 参数配置窗口
 * 继承自 FormApplication，负责收集 GM 输入并调用 VisualQTE.trigger
 */
class QTEDialog extends FormApplication {
    constructor(object, options) { super(object, options); }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "qte-config-dialog",
            title: "QTE 配置",
            template: `modules/${MODULE_ID}/templates/qte-dialog.hbs`, 
            classes: ["qte-config-window"], 
            width: 350,
            height: "auto",
            closeOnSubmit: true
        });
    }
    /**
     * 准备传递给 HTML 模板的数据
     * 这里我们需要获取所有非 GM 的在线玩家
     */
    getData() {
        const data = super.getData();
        
        // 获取所有在线用户 
        data.players = game.users.filter(u => u.active && !u.isSelf).map(u => ({
            id: u.id,
            name: u.name,
            color: u.color,
            active: true // 默认全选
        }));
        
        return data;
    }

    /**
     * 处理表单提交
     * @param {Event} event 
     * @param {Object} formData - HTML 表单数据
     */
    async _updateObject(event, formData) {
        const count = parseInt(formData.count);
        const gmPlay = formData.gmPlay;
        const duration = parseInt(formData.difficulty);
        const windowSize = parseInt(formData.windowSize);
        // --- 解析玩家目标 ---
        const targetIds = [];
        for (let [key, value] of Object.entries(formData)) {
            if (key.startsWith('targets.') && value === true) {
                const userId = key.split('.')[1];
                targetIds.push(userId);
            }
        }
        // 如果 GM 勾选了 "GM 参与"，则把 GM 自己的 ID 也加进去 (如果是指定模式)
        if (targetIds.length > 0 && gmPlay) {
            if (!targetIds.includes(game.user.id)) {
                targetIds.push(game.user.id);
            }
        }
        
        // 委托核心逻辑处理
        VisualQTE.trigger({ count, duration, gmPlay, targetIds, windowSize  });
    }
}

/* -------------------------------------------- */
/*  客户端游戏引擎 (Client Engine)              */
/* -------------------------------------------- */

/**
 * 负责在客户端渲染 UI、处理动画、监听输入并计算得分。
 * 这是一个完全静态的控制类。
 */
class QTEOverlay {
    static sequence = [];
    static currentIndex = 0;
    static results = [];
    static isActive = false;
    static timeoutId = null;
    static startTime = 0;
    static boundHandleKey = null;

    /**
     * 接收 Socket 信号，启动序列
     */
    static startSequence(payload) {
        // 如果是 GM 且配置为不参与，则忽略
        if (game.user.isGM && !payload.gmPlay) return;
        if (QTEOverlay.isActive) return;

        // 初始化状态
        QTEOverlay.sequence = payload.sequence;
        QTEOverlay.currentIndex = 0;
        QTEOverlay.results = [];
        QTEOverlay.isActive = true;

        // 开始第一个 QTE
        QTEOverlay.playNext();
    }

    /**
     * 播放序列中的下一个 QTE
     */
    static playNext() {
        // 检查序列是否结束
        if (QTEOverlay.currentIndex >= QTEOverlay.sequence.length) {
            QTEOverlay.finishSequence();
            return;
        }

        const data = QTEOverlay.sequence[QTEOverlay.currentIndex];
        
        // 清理旧 DOM 并创建新 DOM
        $('#qte-overlay').remove();
        QTEOverlay.createDOM(data);

        // 绑定键盘事件
        QTEOverlay.boundHandleKey = (e) => QTEOverlay.handleKey(e, data);
        document.addEventListener('keydown', QTEOverlay.boundHandleKey);

        // 开始计时
        QTEOverlay.startTime = Date.now();

        // 设置超时判定 (自动失败)
        QTEOverlay.timeoutId = setTimeout(() => {
            QTEOverlay.resolveStep(false, '超时', 'result-bad', data);
        }, data.duration);
    }

    /**
     * 构建 HTML 结构并插入页面
     * 包含位置随机化和动画速率计算
     */
    static createDOM(data) {
        const isSpace = data.keyDisplay === 'SPACE';
        
        // 根据判定时间计算内圈大小，确保外圈缩小时两者能重合
        const targetScale = 1 - (data.hitTime / data.duration);
        const targetSizePx = 300 * targetScale; 

        // 随机屏幕位置 (限制在 20%~80% 区域内)
        const minPos = 20; const maxPos = 80;
        const randTop = Math.floor(Math.random() * (maxPos - minPos) + minPos);
        const randLeft = Math.floor(Math.random() * (maxPos - minPos) + minPos);
        const containerStyle = `top: ${randTop}%; left: ${randLeft}%; transform: translate(-50%, -50%); position: absolute;`;

        const html = `
            <div id="qte-overlay">
                <div class="qte-container" style="${containerStyle}">
                    <div class="qte-approach-ring" style="animation: shrinkRing ${data.duration}ms linear forwards;"></div>
                    <div class="qte-target-ring" style="width: ${targetSizePx}px; height: ${targetSizePx}px;"></div>
                    <div class="qte-key-prompt ${isSpace ? 'space' : ''}">${data.keyDisplay}</div>
                    <div id="qte-result-text" class="qte-result"></div>
                </div>
            </div>
        `;

        $('body').append(html);
        // 下一帧添加 active 类以触发 CSS transition
        requestAnimationFrame(() => { $('#qte-overlay').addClass('active'); });
    }

    /**
     * 键盘输入处理逻辑
     */
    static handleKey(event, data) {
        // 忽略重复按键和修饰键
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
        const pressedKey = event.code;

        // 判定按键正确性
        if (pressedKey === data.targetKey) {
            const elapsed = Date.now() - QTEOverlay.startTime;
            const diff = Math.abs(elapsed - data.hitTime); // 计算时间误差
            
            const halfWindow = data.windowSize / 2;
            const perfectWindow = halfWindow * 0.4;

            // 判定等级
            if (diff <= perfectWindow) {
                QTEOverlay.resolveStep(true, "完美!!", "result-perfect", data, diff);
            } else if (diff <= halfWindow) {
                QTEOverlay.resolveStep(true, "精彩", "result-good", data, diff);
            } else {
                QTEOverlay.resolveStep(false, "太早/太晚", "result-bad", data, diff);
            }
        } else {
            // 按错键直接判负
            QTEOverlay.resolveStep(false, "按键错误", "result-bad", data);
        }
    }

    /**
     * 结算当前步骤
     * 停止动画、显示结果、播放音效并调度下一步
     */
    static resolveStep(success, text, cssClass, data, diff = 0) {
        // 移除监听，防止多次触发
        document.removeEventListener('keydown', QTEOverlay.boundHandleKey);
        clearTimeout(QTEOverlay.timeoutId);
        
        // 冻结动画状态
        $('.qte-approach-ring').css('animation-play-state', 'paused');

        // 记录成绩
        QTEOverlay.results.push({
            key: data.keyDisplay,
            success: success,
            ratingText: text,
            ratingClass: cssClass,
            diff: diff
        });

        // UI 反馈
        const resEl = $('#qte-result-text');
        resEl.text(text).addClass(`${cssClass} show`);
        QTEOverlay.playSound(cssClass);

        // 延迟进入下一轮
        setTimeout(() => {
            $('#qte-overlay').removeClass('active');
            setTimeout(() => {
                $('#qte-overlay').remove();
                QTEOverlay.currentIndex++;
                QTEOverlay.playNext(); // 递归调用
            }, 200);
        }, 800);
    }

    /**
     * 序列结束，生成并发送汇总战报
     */
    static finishSequence() {
        QTEOverlay.isActive = false;
        
        // 统计分数
        let perfects = 0; let goods = 0; let fails = 0;
        let rows = '';
        
        QTEOverlay.results.forEach(r => {
            if (r.ratingClass === 'result-perfect') perfects++;
            else if (r.ratingClass === 'result-good') goods++;
            else fails++;

            const color = r.success ? (r.ratingClass === 'result-perfect' ? '#fbbf24' : '#4ade80') : '#f87171';
            const diffText = r.success ? `${Math.round(r.diff)}ms` : '-';
            
            // 构建表格行
            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <td style="padding: 4px; font-weight:bold;">[${r.key}]</td>
                    <td style="padding: 4px; color:${color};">${r.ratingText}</td>
                    <td style="padding: 4px; text-align:right; color:#888;">${diffText}</td>
                </tr>
            `;
        });

        // 综合评价
        let totalScoreTitle = "挑战失败";
        let totalScoreColor = "#f87171";

        const totalCount = QTEOverlay.results.length;
        const failRatio = fails / totalCount;
        
        if (failRatio <= 0.3) { // 失败次数不超过30%
            if (fails === 0) {
                if (perfects === totalCount) {
                    totalScoreTitle = "完美达成!!";
                    totalScoreColor = "#ffd700";
                } else {
                    totalScoreTitle = "全部成功!";
                    totalScoreColor = "#4ade80";
                }
            } else {
                // 有失败但不超过30%
                totalScoreTitle = "挑战成功";
                totalScoreColor = "#fbbf24"; // 橙色表示勉强
            }
        }

        // 发送聊天消息
        const chatContent = `
            <div style="font-family: 'Signika', sans-serif; background: #222; color: #eee; padding: 10px; border: 2px solid #444; border-radius: 8px;">
                <div style="text-align:center; border-bottom: 2px solid ${totalScoreColor}; margin-bottom: 10px; padding-bottom: 5px;">
                    <h2 style="margin:0; color:${totalScoreColor}; text-shadow: 0 0 10px ${totalScoreColor};">${totalScoreTitle}</h2>
                    <span style="font-size:12px; color:#aaa;">${game.user.name} 的成绩单</span>
                </div>
                <table style="width:100%; font-size:14px; border-collapse: collapse;">
                    ${rows}
                </table>
                <div style="margin-top: 10px; font-size: 12px; text-align: center; color: #888;">
                    完美: ${perfects} | 精彩: ${goods} | 失误: ${fails}
                </div>
            </div>
        `;

        ChatMessage.create({ user: game.user.id, content: chatContent });
    }

    /**
     * 播放音效辅助函数
     */
    static playSound(cssClass) {
        let src = SOUNDS.BAD;
        if (cssClass === 'result-perfect') src = SOUNDS.PERFECT;
        else if (cssClass === 'result-good') src = SOUNDS.GOOD;
        
        AudioHelper.play({src: src, volume: 0.8, loop: false}, false);
    }
}