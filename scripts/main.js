/**
 * ============================================================================
 * 模块名称: Visual QTE (视觉系快速反应事件)
 * 功能描述: 为 Foundry VTT 提供高互动性的 QTE 系统。
 *           包含 [精准点击] 和 [疯狂连打] 两种模式。
 *           支持音效、动画反馈、自定义难度及战报统计。
 * 作者: Tiwelee (Refactored)
 * ============================================================================
 */

const MODULE_ID = 'visual-qte';
let qteSocket;

// 音效资源路径配置
const SOUNDS = {
    PERFECT: `modules/${MODULE_ID}/sounds/perfect.wav`,
    GOOD:    `modules/${MODULE_ID}/sounds/good.wav`,
    BAD:     `modules/${MODULE_ID}/sounds/bad.wav`
};

/* -------------------------------------------------------------------------- */
/*                                1. 核心逻辑 API                              */
/* -------------------------------------------------------------------------- */

/**
 * VisualQTE 静态类
 * 负责业务逻辑的核心处理、数据生成以及 Socket 通信的分发。
 * 该类与 UI 解耦，可供宏命令直接调用。
 */
class VisualQTE {

    /**
     * 触发 QTE 事件的主入口。
     * 根据配置生成数据，并通过 Socket 分发给客户端。
     * 
     * @param {Object} config - 配置参数对象
     * @param {string} [config.mode='sequence'] - 模式: 'sequence'(精准) | 'mash'(连打)
     * @param {number} [config.count=3] - [Sequence] 连击次数
     * @param {number} [config.duration=2500] - [Sequence] 单次判定时长(ms)
     * @param {number} [config.windowSize=300] - [Sequence] 判定宽容度(ms)
     * @param {number} [config.mashDecay=30] - [Mash] 每秒衰减速度
     * @param {number} [config.mashDuration=10] - [Mash] 限时(秒)
     * @param {boolean} [config.gmPlay=true] - GM 是否参与 (仅广播模式有效)
     * @param {Array<string>} [config.targetIds=[]] - 指定目标玩家ID，为空则广播所有人
     */
    static trigger(config = {}) {
        // 1. 环境检查
        if (!qteSocket) {
            return ui.notifications.error("Visual-QTE | Socketlib 未加载，无法运行。");
        }

        // 2. 合并默认参数
        const data = foundry.utils.mergeObject({
            title: "",      // 默认标题为空字符串
            mode: 'sequence', 
            count: 3,
            duration: 2500,
            windowSize: 300,
            mashDecay: 30,
            mashDuration: 10,
            mashPower: 6,
            gmPlay: true,
            targetIds: []
        }, config);

        // 3. 如果是序列模式，预先生成按键数据
        if (data.mode === 'sequence') {
            data.sequence = [];
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '; // 26个字母 + 空格

            for (let i = 0; i < data.count; i++) {
                // 随机按键生成
                const randomChar = chars.charAt(Math.floor(Math.random() * chars.length));
                const keyDisplay = randomChar === ' ' ? 'SPACE' : randomChar;
                const keyCode = randomChar === ' ' ? 'Space' : `Key${randomChar}`;
                
                // 随机判定时间点 (总时长的 30% ~ 70%)
                const minRatio = 0.3;
                const maxRatio = 0.7;
                const randomRatio = Math.random() * (maxRatio - minRatio) + minRatio;
                const targetTime = data.duration * randomRatio;

                data.sequence.push({
                    id: i,
                    keyDisplay: keyDisplay,
                    targetKey: keyCode,
                    duration: data.duration,
                    hitTime: targetTime,
                    windowSize: data.windowSize
                });
            }
        }

        // 4. Socket 数据分发
        if (data.targetIds && data.targetIds.length > 0) {
            // --- 定向发送模式 ---
            // 仅发送给列表中的玩家 ID
            qteSocket.executeForUsers("startQTESession", data.targetIds, data);
            ui.notifications.info(`QTE [${data.mode}] 已发送给 ${data.targetIds.length} 位指定玩家。`);
        } else {
            // --- 全员广播模式 ---
            qteSocket.executeForEveryone("startQTESession", data);
            ui.notifications.info(`QTE [${data.mode}] 已广播给所有人。`);
        }
    }

    /**
     * 打开配置窗口的快捷方法
     */
    static openDialog() {
        new QTEDialog().render(true);
    }
}

/* -------------------------------------------------------------------------- */
/*                                2. 初始化与钩子                              */
/* -------------------------------------------------------------------------- */

Hooks.once("socketlib.ready", () => {
    // 注册模块与 Socket 函数
    qteSocket = socketlib.registerModule(MODULE_ID);
    qteSocket.register("startQTESession", QTEOverlay.startSession); 

    // 将 API 暴露到全局 game 对象，方便宏调用
    game.modules.get(MODULE_ID).api = VisualQTE;

    console.log(`${MODULE_ID} | 初始化完成，API 已就绪。`);
});

// 在场景控制栏添加 GM 按钮
Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user.isGM) return;
    
    const tokenTools = controls.find(c => c.name === 'token');
    if (tokenTools) {
        tokenTools.tools.push({
            name: 'trigger-qte',
            title: 'QTE 事件配置',
            icon: 'fas fa-stopwatch',
            onClick: () => VisualQTE.openDialog(),
            button: true
        });
    }
});

/* -------------------------------------------------------------------------- */
/*                                3. 配置界面 UI                               */
/* -------------------------------------------------------------------------- */

/**
 * QTE 参数配置窗口
 * 继承自 FormApplication，处理用户输入并调用 VisualQTE.trigger
 */
class QTEDialog extends FormApplication {
    constructor(object, options) { super(object, options); }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "qte-config-dialog",
            title: "QTE 配置",
            template: `modules/${MODULE_ID}/templates/qte-dialog.hbs`, 
            classes: ["qte-config-window"], 
            width: 440,
            height: "auto",
            closeOnSubmit: true
        });
    }

    /**
     * 准备传递给 Handlebars 模板的数据
     */
    getData() {
        const data = super.getData();
        // 获取所有在线用户 (用于目标选择列表)
        data.players = game.users.filter(u => u.active && !u.isSelf).map(u => ({
            id: u.id,
            name: u.name,
            color: u.color,
            active: true // 默认全选
        }));
        return data;
    }

    /**
     * 激活交互监听 (处理模式切换时的 UI 显隐)
     */
    activateListeners(html) {
        super.activateListeners(html);
        
        const modeSelect = html.find('#qte-mode-select');
        const seqSettings = html.find('#setting-sequence');
        const mashSettings = html.find('#setting-mash');

        modeSelect.change(ev => {
            const mode = ev.target.value;
            // 定义一个回调函数：动画结束后，强制窗口重新适应高度
            const resize = () => this.setPosition({ height: "auto" });
            if (mode === 'mash') {
                seqSettings.hide();
                // 在 slideDown 完成后调用 resize
                mashSettings.slideDown(200, resize);
            } else {
                mashSettings.hide();
                // 在 slideDown 完成后调用 resize
                seqSettings.slideDown(200, resize);
            }
        });
    }

    /**
     * 提交表单时的逻辑处理
     */
    async _updateObject(event, formData) {
        const gmPlay = formData.gmPlay;
        const mode = formData.mode;
        const title = formData.customTitle;

        // 解析目标玩家 IDs
        const targetIds = [];
        for (let [key, value] of Object.entries(formData)) {
            if (key.startsWith('targets.') && value === true) {
                targetIds.push(key.split('.')[1]);
            }
        }
        
        // 如果是指定模式且 GM 也要玩，手动加入 GM ID
        if (targetIds.length > 0 && gmPlay && !targetIds.includes(game.user.id)) {
            targetIds.push(game.user.id);
        }

        // 根据模式组装参数
        if (mode === 'sequence') {
            VisualQTE.trigger({ 
                title,
                mode: 'sequence',
                count: parseInt(formData.count), 
                duration: parseInt(formData.difficulty),
                windowSize: parseInt(formData.windowSize),
                gmPlay, targetIds
            });
        } else {
            VisualQTE.trigger({
                title,
                mode: 'mash',
                mashDecay: parseInt(formData.mashDecay),
                mashDuration: parseInt(formData.mashDuration),
                mashPower: parseInt(formData.mashPower), 
                gmPlay, targetIds
            });
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                                4. 客户端游戏引擎                            */
/* -------------------------------------------------------------------------- */

/**
 * 客户端静态引擎类
 * 负责渲染 UI、动画循环、输入监听及结果判定。
 */
class QTEOverlay {
    // --- 通用状态 ---
    static isActive = false;
    static mode = null;
    static title = ""; 

    // --- Sequence 模式变量 ---
    static sequence = [];
    static currentIndex = 0;
    static results = [];
    static timeoutId = null;
    static startTime = 0;

    // --- Mash 模式变量 ---
    static mashProgress = 50;
    static mashDecay = 20;
    static mashLoopId = null;
    static lastFrameTime = 0;
    static mashEndTime = 0;

    static boundHandleKey = null;

    /**
     * 客户端接收 Socket 信号的统一入口
     */
    static startSession(data) {
        // 如果是广播模式且 GM 不玩，则忽略
        if (game.user.isGM && !data.gmPlay) return;
        // 防止重复触发
        if (QTEOverlay.isActive) return;
        
        QTEOverlay.isActive = true;
        QTEOverlay.mode = data.mode;
        QTEOverlay.title = data.title || ""; 

        // 模式分发
        if (data.mode === 'sequence') {
            QTEOverlay.sequence = data.sequence;
            QTEOverlay.currentIndex = 0;
            QTEOverlay.results = [];
            QTEOverlay.playNextSequence();
        } else if (data.mode === 'mash') {
            QTEOverlay.startMash(data);
        }
    }

    /* ======================================================================
       区域 A: 连打模式 (Mash Mode) 逻辑
       ====================================================================== */

    static startMash(data) {
        // 1. 初始化数据
        this.mashProgress = 50; 
        this.mashDecay = data.mashDecay; 
        this.mashPower = data.mashPower;
        this.mashEndTime = Date.now() + (data.mashDuration * 1000);
        
        // 2. 创建 UI
        this.createMashDOM(data);

        // 3. 绑定按键
        this.boundHandleKey = (e) => this.handleMashKey(e);
        document.addEventListener('keydown', this.boundHandleKey);

        // 4. 启动渲染循环
        this.lastFrameTime = Date.now();
        this.gameLoop();
    }

    static createMashDOM(data) {
        const html = `
            <div id="qte-overlay">
                <div class="qte-mash-wrapper">
                    <div class="qte-mash-prompt">PRESS SPACE!</div>

                    <div class="qte-timer">--.--s</div>
                    <div class="qte-mash-row">
                        <!-- 左侧图标：玩家 -->
                        <div class="mash-icon player"><i class="fas fa-fist-raised"></i></div>
                        
                        <!-- 进度条轨道 -->
                        <div class="qte-progress-track">
                            <div class="qte-progress-fill" style="width: 50%;"></div>
                        </div>
                        
                        <!-- 右侧图标：系统/BOSS -->
                        <div class="mash-icon enemy"><i class="fas fa-skull"></i></div>
                    </div>
                </div>
                <div id="qte-result-text" class="qte-result"></div>
            </div>
        `;
        $('body').append(html);
        requestAnimationFrame(() => $('#qte-overlay').addClass('active'));
    }

    static handleMashKey(e) {
        if (e.repeat) return; 
        
        // 阻止 FVTT 默认行为 (如Token移动、暂停)
        e.preventDefault(); 
        e.stopPropagation();

        if (e.code === 'Space') {
            // 每次点击增加进度
            this.mashProgress += this.mashPower;
            
            // [修复]：按键瞬间立即判定胜利
            // 如果不在这里判断，GameLoop里的衰减可能会在下一帧立刻把它拉回 <100
            if (this.mashProgress >= 100) {
                this.mashProgress = 100;
                $('.qte-progress-fill').css('width', '100%'); // 视觉补满
                this.endMash(true, "突破成功!");
                return;
            }

            // 更新宽度
            const fill = $('.qte-progress-fill');
            fill.css('width', `${this.mashProgress}%`);
            
            // --- 新增：高光闪烁 ---
            // 移除类 -> 强制重绘 -> 添加类 (实现每次点击都闪)
            fill.removeClass('flash');
            void fill[0].offsetWidth; 
            fill.addClass('flash');

            // 轨道抖动
            const track = $('.qte-progress-track');
            track.removeClass('shake-pulse');
            void track[0].offsetWidth; 
            track.addClass('shake-pulse');

            // TODO：在这里也可以播放点击音效
        }
    }

    static gameLoop() {
        if (!this.isActive || this.mode !== 'mash') return;

        const now = Date.now();
        const deltaTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        // --- 计算并更新倒计时 ---
        const remaining = Math.max(0, (this.mashEndTime - now) / 1000);
        const timerEl = $('.qte-timer');
        timerEl.text(remaining.toFixed(2) + 's'); // 保留2位小数
        
        // 如果少于 3秒，加红色警告样式
        if (remaining <= 3) timerEl.addClass('urgent');

        // 1. 计算衰减
        this.mashProgress -= this.mashDecay * deltaTime;

        // 2. 更新 UI
        $('.qte-progress-fill').css('width', `${Math.max(0, this.mashProgress)}%`);

        // 3. 判定逻辑
        if (this.mashProgress <= 0) {
            this.endMash(false, "被压制!");
            return;
        }
        if (this.mashProgress >= 100) {
            this.endMash(true, "突破成功!");
            return;
        }
        if (now > this.mashEndTime) {
            this.endMash(false, "时间耗尽!");
            return;
        }

        // 4. 下一帧
        this.mashLoopId = requestAnimationFrame(() => this.gameLoop());
    }

    static endMash(success, text) {
        // 1. 停止循环和原有监听
        cancelAnimationFrame(this.mashLoopId);
        document.removeEventListener('keydown', this.boundHandleKey);

        // --- 新增：安全拦截器 (Cool-down Blocker) ---
        // 防止玩家还在疯狂按空格，导致 QTE 结束后 Token 乱动或暂停游戏
        const blocker = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        // 挂载拦截器，捕获阶段执行
        document.addEventListener('keydown', blocker, true);
        
        // 1.5秒后移除拦截器 (与 UI 消失时间同步)
        setTimeout(() => {
            document.removeEventListener('keydown', blocker, true);
        }, 1500);
        // ------------------------------------------

        const resEl = $('#qte-result-text');
        const cssClass = success ? 'result-perfect' : 'result-bad';
        resEl.text(text).addClass(`${cssClass} show`);
        
        this.playSound(cssClass);

        const color = success ? '#4ade80' : '#f87171';
        // 如果有自定义标题则使用，否则默认为"连打挑战"
        const displayTitle = this.title ? this.title : "连打挑战";
        ChatMessage.create({
            content: `<div style="text-align:center; padding:5px; border:1px solid #444; background:#222; color:${color}; font-weight:bold; font-family:'Signika';">
                ${game.user.name} ${displayTitle}: ${text}
            </div>`
        });

        setTimeout(() => {
            $('#qte-overlay').removeClass('active');
            setTimeout(() => {
                $('#qte-overlay').remove();
                this.isActive = false;
            }, 300);
        }, 1500);
    }

    /* ======================================================================
       区域 B: 序列模式 (Sequence Mode) 逻辑
       ====================================================================== */

    static playNextSequence() {
        if (this.currentIndex >= this.sequence.length) {
            this.finishSequence();
            return;
        }
        const data = this.sequence[this.currentIndex];
        
        // 重置 DOM
        $('#qte-overlay').remove();
        this.createSequenceDOM(data);
        
        // 绑定事件与计时
        this.boundHandleKey = (e) => this.handleSequenceKey(e, data);
        document.addEventListener('keydown', this.boundHandleKey);
        
        this.startTime = Date.now();
        this.timeoutId = setTimeout(() => {
            this.resolveSequenceStep(false, '超时', 'result-bad', data);
        }, data.duration);
    }

    static createSequenceDOM(data) {
        const isSpace = data.keyDisplay === 'SPACE';
        const targetScale = 1 - (data.hitTime / data.duration);
        const targetSizePx = 300 * targetScale; 

        // 随机屏幕位置 (20%~80%)
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
        requestAnimationFrame(() => { $('#qte-overlay').addClass('active'); });
    }

    static handleSequenceKey(event, data) {
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;

        // 拦截按键，防止干扰 FVTT
        event.preventDefault(); 
        event.stopPropagation(); 

        const pressedKey = event.code;

        if (pressedKey === data.targetKey) {
            const elapsed = Date.now() - QTEOverlay.startTime;
            const diff = Math.abs(elapsed - data.hitTime);
            
            const halfWindow = data.windowSize / 2;
            const perfectWindow = halfWindow * 0.4;

            if (diff <= perfectWindow) {
                QTEOverlay.resolveSequenceStep(true, "完美!!", "result-perfect", data, diff);
            } else if (diff <= halfWindow) {
                QTEOverlay.resolveSequenceStep(true, "精彩", "result-good", data, diff);
            } else {
                QTEOverlay.resolveSequenceStep(false, "太早/太晚", "result-bad", data, diff);
            }
        } else {
            QTEOverlay.resolveSequenceStep(false, "按键错误", "result-bad", data);
        }
    }

    static resolveSequenceStep(success, text, cssClass, data, diff = 0) {
        document.removeEventListener('keydown', QTEOverlay.boundHandleKey);
        clearTimeout(QTEOverlay.timeoutId);
        $('.qte-approach-ring').css('animation-play-state', 'paused');

        QTEOverlay.results.push({
            key: data.keyDisplay,
            success: success,
            ratingText: text,
            ratingClass: cssClass,
            diff: diff
        });

        const resEl = $('#qte-result-text');
        resEl.text(text).addClass(`${cssClass} show`);
        QTEOverlay.playSound(cssClass);

        setTimeout(() => {
            $('#qte-overlay').removeClass('active');
            setTimeout(() => {
                $('#qte-overlay').remove();
                QTEOverlay.currentIndex++;
                QTEOverlay.playNextSequence();
            }, 200);
        }, 800);
    }

    static finishSequence() {
        QTEOverlay.isActive = false;
        
        let perfects = 0; let goods = 0; let fails = 0;
        let rows = '';
        
        QTEOverlay.results.forEach(r => {
            if (r.ratingClass === 'result-perfect') perfects++;
            else if (r.ratingClass === 'result-good') goods++;
            else fails++;

            const color = r.success ? (r.ratingClass === 'result-perfect' ? '#fbbf24' : '#4ade80') : '#f87171';
            const diffText = r.success ? `${Math.round(r.diff)}ms` : '-';
            
            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <td style="padding: 4px; font-weight:bold;">[${r.key}]</td>
                    <td style="padding: 4px; color:${color};">${r.ratingText}</td>
                    <td style="padding: 4px; text-align:right; color:#888;">${diffText}</td>
                </tr>
            `;
        });

        // 默认基础标题
        let baseTitle = this.title ? this.title : "挑战"; 
        // 计算评价标题
        let totalScoreTitle = `${baseTitle} 失败`;
        let totalScoreColor = "#f87171";
        const totalCount = QTEOverlay.results.length;
        const failRatio = fails / totalCount;
        
        if (failRatio <= 0.3) { 
            if (fails === 0) {
                if (perfects === totalCount) {
                    totalScoreTitle = `${baseTitle} 完美达成!!`;
                    totalScoreColor = "#ffd700";
                } else {
                    totalScoreTitle = `${baseTitle} 全部成功!`;
                    totalScoreColor = "#4ade80";
                }
            } else {
                totalScoreTitle = `${baseTitle} 成功`;
                totalScoreColor = "#fbbf24";
            }
        }

        // 发送战报
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