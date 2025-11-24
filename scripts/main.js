/**
 * ============================================================================
 * 模块名称: Visual QTE (视觉系快速反应事件)
 * 功能描述: 为 Foundry VTT 提供高互动性的 QTE 系统
 *           包含 [精准点击] 和 [疯狂连打] 两种模式
 *           支持音效、动画反馈、自定义难度及战报统计
 * 作者: Tiwelee (Refactored)
 * 版本: 1.0
 * ============================================================================
 */

// ============================================================================
// 模块常量定义
// ============================================================================

/**
 * 模块唯一标识符
 * @constant {string}
 */
const MODULE_ID = 'visual-qte';

/**
 * Socket 通信实例，用于客户端与服务器间通信
 * @type {object}
 */
let qteSocket;

/**
 * 音效资源配置
 * 包含三种反馈音效：完美、良好、失误
 * @constant {object}
 */
const SOUNDS = {
    PERFECT: `modules/${MODULE_ID}/sounds/perfect.wav`,  // 完美表现音效
    GOOD:    `modules/${MODULE_ID}/sounds/good.wav`,     // 良好表现音效  
    BAD:     `modules/${MODULE_ID}/sounds/bad.wav`       // 失误表现音效
};

// ============================================================================
// 1. 核心逻辑 API - VisualQTE 类
// ============================================================================

/**
 * VisualQTE 静态类
 * 
 * 负责业务逻辑的核心处理、数据生成以及 Socket 通信的分发
 * 该类与 UI 解耦，可供宏命令直接调用
 * 
 * @static
 */
class VisualQTE {

    /**
     * 触发 QTE 事件的主入口方法
     * 
     * 根据配置生成数据，并通过 Socket 分发给客户端
     * 支持两种模式：序列模式(精准点击) 和 连打模式(疯狂连打)
     * 
     * @param {Object} config - 配置参数对象
     * @param {string} [config.mode='sequence'] - QTE 模式: 'sequence'(精准点击) | 'mash'(疯狂连打)
     * @param {number} [config.count=3] - [序列模式] 连击次数
     * @param {number} [config.duration=2500] - [序列模式] 单次判定时长(毫秒)
     * @param {number} [config.windowSize=300] - [序列模式] 判定宽容度(毫秒)
     * @param {number} [config.mashDecay=30] - [连打模式] 每秒衰减速度
     * @param {number} [config.mashDuration=10] - [连打模式] 限时(秒)
     * @param {number} [config.mashPower=6] - [连打模式] 每次按键增加的进度值
     * @param {boolean} [config.gmPlay=true] - GM 是否参与 (仅广播模式有效)
     * @param {Array<string>} [config.targetIds=[]] - 指定目标玩家ID，为空则广播所有人
     * @param {string} [config.title=""] - QTE 事件标题，用于战报显示
     * 
     * @example
     * // 触发一个序列模式的 QTE
     * VisualQTE.trigger({
     *     mode: 'sequence',
     *     count: 5,
     *     duration: 3000,
     *     title: "魔法封印解除"
     * });
     */
    static trigger(config = {}) {
        // 1. 环境检查 - 确保 Socket 系统已就绪
        if (!qteSocket) {
            return ui.notifications.error("Visual-QTE | Socketlib 未加载，无法运行。");
        }

        // 2. 合并默认参数，确保所有配置项都有合理的默认值
        const data = foundry.utils.mergeObject({
            title: "",           // 默认标题为空字符串
            mode: 'sequence',    // 默认序列模式
            count: 3,            // 默认3次连击
            duration: 2500,      // 默认2.5秒判定时长
            windowSize: 300,     // 默认300毫秒宽容度
            mashDecay: 30,       // 默认每秒衰减30点
            mashDuration: 10,    // 默认10秒时限
            mashPower: 6,        // 默认每次按键增加6点进度
            gmPlay: true,        // 默认GM参与
            targetIds: []        // 默认空数组表示广播所有人
        }, config);

        // 3. 序列模式数据预处理 - 预先生成随机按键序列
        if (data.mode === 'sequence') {
            data.sequence = [];
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '; // 26个字母 + 空格

            for (let i = 0; i < data.count; i++) {
                // 随机按键生成逻辑
                const randomChar = chars.charAt(Math.floor(Math.random() * chars.length));
                const keyDisplay = randomChar === ' ' ? 'SPACE' : randomChar;  // 空格键显示为"SPACE"
                const keyCode = randomChar === ' ' ? 'Space' : `Key${randomChar}`; // 对应的键盘码
                
                // 随机判定时间点 (总时长的 30% ~ 70% 区间)
                // 这样避免按键出现在开始或结束的太边缘位置
                const minRatio = 0.3;
                const maxRatio = 0.7;
                const randomRatio = Math.random() * (maxRatio - minRatio) + minRatio;
                const targetTime = data.duration * randomRatio;

                // 构建单个按键数据对象
                data.sequence.push({
                    id: i,                           // 序列ID
                    keyDisplay: keyDisplay,          // 显示文本
                    targetKey: keyCode,              // 目标按键代码
                    duration: data.duration,         // 总持续时间
                    hitTime: targetTime,             // 最佳命中时间点
                    windowSize: data.windowSize      // 判定窗口大小
                });
            }
        }

        // 4. Socket 数据分发策略
        if (data.targetIds && data.targetIds.length > 0) {
            // --- 定向发送模式 ---
            // 仅发送给列表中的指定玩家ID
            qteSocket.executeForUsers("startQTESession", data.targetIds, data);
            ui.notifications.info(`QTE [${data.mode}] 已发送给 ${data.targetIds.length} 位指定玩家。`);
        } else {
            // --- 全员广播模式 ---
            qteSocket.executeForEveryone("startQTESession", data);
            ui.notifications.info(`QTE [${data.mode}] 已广播给所有人。`);
        }
    }

    /**
     * 打开 QTE 配置对话框的快捷方法
     * 
     * 提供给 GM 用户快速访问配置界面的入口
     * 
     * @static
     */
    static openDialog() {
        new QTEDialog().render(true);
    }
}

// ============================================================================
// 2. 初始化与钩子函数
// ============================================================================

/**
 * Socketlib 就绪钩子
 * 
 * 在 Socketlib 系统初始化完成后注册模块和通信函数
 * 同时将 API 暴露到全局 game 对象，方便宏命令调用
 */
Hooks.once("socketlib.ready", () => {
    // 注册模块与 Socket 函数
    qteSocket = socketlib.registerModule(MODULE_ID);
    qteSocket.register("startQTESession", QTEOverlay.startSession); 

    // 将 API 暴露到全局 game 对象，方便宏调用
    game.modules.get(MODULE_ID).api = VisualQTE;

    console.log(`${MODULE_ID} | 初始化完成，API 已就绪。`);
});

/**
 * 场景控制按钮钩子
 * 
 * 在 Token 控制层添加 QTE 触发按钮，方便 GM 快速使用
 * 支持 Foundry VTT v12 和 v13 的不同控制结构
 */
Hooks.on('getSceneControlButtons', (controls) => {
    // 权限检查 - 只有 GM 才能看到和使用此按钮
    if (!game.user.isGM) return;
    
    // --- 定义按钮配置 ---
    const qteTool = {
        name: 'trigger-qte',              // 工具唯一标识
        title: 'QTE 事件配置',            // 鼠标悬停提示
        icon: 'fas fa-stopwatch',         // FontAwesome 图标
        visible: true,                    // 始终可见
        button: true,                     // 显示为按钮形式
        onChange: () => {                 // 点击回调函数
            if (VisualQTE) VisualQTE.openDialog();
        }
    };

    // --- 步骤 1: 查找 Token 控制层级 ---
    let tokenLayer = null;

    // V13 模式: controls 是对象，直接通过属性访问
    if (controls.tokens) {
        tokenLayer = controls.tokens;
    } 
    // V12 模式: controls 是数组，通过查找 name 访问
    else if (Array.isArray(controls)) {
        tokenLayer = controls.find(c => c.name === 'token');
    }

    // --- 步骤 2: 注入按钮到控制层 ---
    if (tokenLayer) {
        const tools = tokenLayer.tools;

        // V13 判断: 如果 tools 不是数组 (是对象或 Map)
        if (tools && !Array.isArray(tools)) {
            // 如果是 Map 类型 (V13 可能使用 JS Map)
            if (tools instanceof Map) {
                if (!tools.has('trigger-qte')) {
                    tools.set('trigger-qte', qteTool);
                }
            } 
            // 如果是普通 Object 类型
            else {
                tokenLayer.tools['trigger-qte'] = qteTool;
            }
        } 
        // V12 判断: 如果 tools 是数组
        else if (Array.isArray(tools)) {
            if (!tools.some(t => t.name === 'trigger-qte')) {
                tools.push(qteTool);
            }
        }
    } else {
        console.warn("Visual-QTE | 无法找到 Token 控制层级，按钮添加失败。");
    }
});

// ============================================================================
// 3. 配置界面 (Application V2)
// ============================================================================

/**
 * QTE 配置对话框类
 * 
 * 基于 Foundry VTT Application V2 系统构建的配置界面
 * 提供序列模式和连打模式的参数配置
 * 
 * @extends {ApplicationV2}
 */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class QTEDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * 应用默认配置
     * @static
     */
    static DEFAULT_OPTIONS = {
        tag: "form",                         // 根元素标签
        id: "qte-config-dialog",            // 唯一ID
        classes: ["qte-config-window"],     // CSS 类名
        window: {
            icon: "fas fa-stopwatch",       // 窗口图标
            title: "QTE 事件配置",          // 窗口标题
            resizable: false                // 禁止调整大小
        },
        form: {
            handler: QTEDialog.formHandler, // 表单提交处理器
            closeOnSubmit: true             // 提交后关闭窗口
        }
    };

    /**
     * 模板部件配置
     * @static
     */
    static PARTS = {
        form: {
            template: `modules/${MODULE_ID}/templates/qte-dialog.hbs`  // Handlebars 模板路径
        }
    };

    /**
     * 准备数据上下文
     * 
     * 为模板提供渲染所需的数据
     * 包括玩家列表、默认模式等
     * 
     * @param {object} options - 应用选项
     * @returns {object} 模板数据上下文
     */
    async _prepareContext(options) {
        // 获取所有活跃的非GM玩家
        const players = game.users.filter(u => u.active && !u.isSelf).map(u => ({
            id: u.id,           // 玩家ID
            name: u.name,       // 玩家名称
            color: u.color,     // 玩家颜色
            active: true        // 活跃状态
        }));

        return {
            players,                    // 玩家列表
            mode: 'sequence'            // 默认选中序列模式
        };
    }

    /**
     * 渲染后 DOM 监听器绑定
     * 
     * 处理模式切换时的界面动态效果
     * 
     * @param {object} context - 模板数据上下文
     * @param {object} options - 渲染选项
     */
    _onRender(context, options) {
        // 在 V2 中，this.element 是根 HTML 元素
        // 由于我们定义了 tag: 'form'，所以 this.element 就是那个 <form>
        const html = $(this.element);

        // 获取关键DOM元素
        const modeSelect = html.find('#qte-mode-select');
        const seqSettings = html.find('#setting-sequence');
        const mashSettings = html.find('#setting-mash');

        // 模式切换事件监听
        modeSelect.on('change', (ev) => {
            const mode = ev.target.value;
            
            // 重新计算窗口位置的回调函数
            const resize = () => this.setPosition({ height: "auto" });

            if (mode === 'mash') {
                // 切换到连打模式：隐藏序列设置，显示连打设置
                seqSettings.hide();
                mashSettings.slideDown(200, resize);
            } else {
                // 切换到序列模式：隐藏连打设置，显示序列设置
                mashSettings.hide();
                seqSettings.slideDown(200, resize);
            }
        });
    }

    /**
     * 表单提交处理器
     * 
     * 处理配置表单的提交，解析数据并触发对应的 QTE 事件
     * 
     * @static
     * @param {Event} event - 提交事件
     * @param {HTMLFormElement} form - 表单元素
     * @param {FormDataExtended} formData - 表单数据
     */
    static async formHandler(event, form, formData) {
        // 将表单数据转换为普通对象
        const data = formData.object;

        // 提取基础配置
        const gmPlay = data.gmPlay;
        const mode = data.mode;
        const title = data.customTitle;

        // 解析目标玩家ID列表
        // 表单中 targets.玩家ID 格式的字段表示选中状态
        const targetIds = [];
        for (let [key, value] of Object.entries(data)) {
            if (key.startsWith('targets.') && value === true) {
                targetIds.push(key.split('.')[1]);  // 提取玩家ID
            }
        }
        
        // 如果GM参与且不在目标列表中，自动添加GM
        if (targetIds.length > 0 && gmPlay && !targetIds.includes(game.user.id)) {
            targetIds.push(game.user.id);
        }

        // 根据模式调用对应的触发方法
        if (mode === 'sequence') {
            VisualQTE.trigger({ 
                title, 
                mode: 'sequence',
                count: parseInt(data.count), 
                duration: parseInt(data.difficulty),
                windowSize: parseInt(data.windowSize),
                gmPlay, 
                targetIds
            });
        } else {
            VisualQTE.trigger({
                title, 
                mode: 'mash',
                mashDecay: parseInt(data.mashDecay),
                mashDuration: parseInt(data.mashDuration),
                mashPower: parseInt(data.mashPower),
                gmPlay, 
                targetIds
            });
        }
    }
}

// ============================================================================
// 4. 客户端游戏引擎 - QTEOverlay 类
// ============================================================================

/**
 * 客户端静态引擎类
 * 
 * 负责渲染 UI、动画循环、输入监听及结果判定
 * 处理玩家端的全部交互逻辑
 * 
 * @static
 */
class QTEOverlay {
    // ========================= 通用状态变量 =========================
    
    /** @static @type {boolean} 当前是否有活跃的 QTE 会话 */
    static isActive = false;
    
    /** @static @type {string} 当前 QTE 模式 ('sequence' 或 'mash') */
    static mode = null;
    
    /** @static @type {string} QTE 事件标题，用于战报显示 */
    static title = ""; 

    // ====================== 序列模式专用变量 =======================
    
    /** @static @type {Array} 按键序列数据 */
    static sequence = [];
    
    /** @static @type {number} 当前进行到的序列索引 */
    static currentIndex = 0;
    
    /** @static @type {Array} 结果记录数组 */
    static results = [];
    
    /** @static @type {number} 超时定时器ID */
    static timeoutId = null;
    
    /** @static @type {number} 序列开始时间戳 */
    static startTime = 0;

    // ======================= 连打模式专用变量 ======================
    
    /** @static @type {number} 当前进度值 (0-100) */
    static mashProgress = 50;
    
    /** @static @type {number} 每秒衰减速度 */
    static mashDecay = 20;
    
    /** @static @type {number} 每次按键增加的进度值 */
    static mashPower = 6;
    
    /** @static @type {number} 动画循环ID */
    static mashLoopId = null;
    
    /** @static @type {number} 上一帧时间戳 */
    static lastFrameTime = 0;
    
    /** @static @type {number} 连打结束时间戳 */
    static mashEndTime = 0;

    /** @static @type {Function} 绑定的按键处理函数引用 */
    static boundHandleKey = null;

    // ======================= 核心入口方法 =======================

    /**
     * 客户端接收 Socket 信号的统一入口
     * 
     * 处理服务器发送的 QTE 开始指令，初始化对应模式
     * 
     * @static
     * @param {object} data - QTE 配置数据
     */
    static startSession(data) {
        // 权限检查：如果是广播模式且 GM 不参与，则忽略
        if (game.user.isGM && !data.gmPlay) return;
        
        // 防重复触发检查
        if (QTEOverlay.isActive) return;
        
        // 初始化通用状态
        QTEOverlay.isActive = true;
        QTEOverlay.mode = data.mode;
        QTEOverlay.title = data.title || ""; 

        // 模式分发逻辑
        if (data.mode === 'sequence') {
            // 序列模式初始化
            QTEOverlay.sequence = data.sequence;
            QTEOverlay.currentIndex = 0;
            QTEOverlay.results = [];
            QTEOverlay.playNextSequence();
        } else if (data.mode === 'mash') {
            // 连打模式初始化
            QTEOverlay.startMash(data);
        }
    }

    // ======================================================================
    // 区域 A: 连打模式 (Mash Mode) 逻辑
    // ======================================================================

    /**
     * 启动连打模式
     * 
     * 初始化连打模式数据，创建UI，绑定事件并启动游戏循环
     * 
     * @static
     * @param {object} data - 连打模式配置数据
     */
    static startMash(data) {
        // 1. 初始化连打数据
        this.mashProgress = 50;                     // 初始进度50%
        this.mashDecay = data.mashDecay;            // 衰减速度
        this.mashPower = data.mashPower;            // 按键力量
        this.mashEndTime = Date.now() + (data.mashDuration * 1000);  // 计算结束时间
        
        // 2. 创建连打模式UI
        this.createMashDOM(data);

        // 3. 绑定空格键监听
        this.boundHandleKey = (e) => this.handleMashKey(e);
        document.addEventListener('keydown', this.boundHandleKey);

        // 4. 启动游戏循环
        this.lastFrameTime = Date.now();
        this.gameLoop();
    }

    /**
     * 创建连打模式DOM结构
     * 
     * 构建包含进度条、计时器、提示文本的UI界面
     * 
     * @static
     * @param {object} data - 配置数据
     */
    static createMashDOM(data) {
        const html = `
            <div id="qte-overlay">
                <div class="qte-mash-wrapper">
                    <!-- 提示文本 -->
                    <div class="qte-mash-prompt">PRESS SPACE!</div>

                    <!-- 倒计时显示 -->
                    <div class="qte-timer">--.--s</div>
                    
                    <!-- 进度条区域 -->
                    <div class="qte-mash-row">
                        <!-- 左侧玩家图标 -->
                        <div class="mash-icon player"><i class="fas fa-fist-raised"></i></div>
                        
                        <!-- 进度条轨道 -->
                        <div class="qte-progress-track">
                            <div class="qte-progress-fill" style="width: 50%;"></div>
                        </div>
                        
                        <!-- 右侧敌人图标 -->
                        <div class="mash-icon enemy"><i class="fas fa-skull"></i></div>
                    </div>
                </div>
                
                <!-- 结果显示区域 -->
                <div id="qte-result-text" class="qte-result"></div>
            </div>
        `;
        
        // 添加到页面并触发入场动画
        $('body').append(html);
        requestAnimationFrame(() => $('#qte-overlay').addClass('active'));
    }

    /**
     * 处理连打模式按键输入
     * 
     * 监听空格键按下，更新进度并触发视觉反馈
     * 
     * @static
     * @param {KeyboardEvent} e - 键盘事件对象
     */
    static handleMashKey(e) {
        // 防止重复触发和系统快捷键干扰
        if (e.repeat) return; 
        e.preventDefault(); 
        e.stopPropagation();

        // 只响应空格键
        if (e.code === 'Space') {
            // 1. 增加进度值
            this.mashProgress += this.mashPower;
            
            // 2. 即时胜利判定（避免帧延迟）
            if (this.mashProgress >= 100) {
                this.mashProgress = 100;
                $('.qte-progress-fill').css('width', '100%'); // 视觉补满
                this.endMash(true, "突破成功!");
                return;
            }

            // 3. 更新进度条视觉
            const fill = $('.qte-progress-fill');
            fill.css('width', `${this.mashProgress}%`);
            
            // 4. 高光闪烁反馈
            fill.removeClass('flash');
            void fill[0].offsetWidth; // 强制重绘技巧
            fill.addClass('flash');

            // 5. 轨道抖动效果
            const track = $('.qte-progress-track');
            track.removeClass('shake-pulse');
            void track[0].offsetWidth; // 强制重绘
            track.addClass('shake-pulse');

            // TODO：可在此处添加按键音效
        }
    }

    /**
     * 连打模式游戏循环
     * 
     * 处理进度衰减、倒计时更新和胜负判定
     * 使用 requestAnimationFrame 实现平滑动画
     * 
     * @static
     */
    static gameLoop() {
        // 安全检查：确保仍在活跃状态
        if (!this.isActive || this.mode !== 'mash') return;

        const now = Date.now();
        const deltaTime = (now - this.lastFrameTime) / 1000;  // 计算帧间隔（秒）
        this.lastFrameTime = now;

        // --- 倒计时更新逻辑 ---
        const remaining = Math.max(0, (this.mashEndTime - now) / 1000);
        const timerEl = $('.qte-timer');
        timerEl.text(remaining.toFixed(2) + 's'); // 保留2位小数显示
        
        // 少于3秒时添加紧急样式
        if (remaining <= 3) timerEl.addClass('urgent');

        // 1. 计算自然衰减
        this.mashProgress -= this.mashDecay * deltaTime;

        // 2. 更新UI进度条
        $('.qte-progress-fill').css('width', `${Math.max(0, this.mashProgress)}%`);

        // 3. 胜负判定逻辑
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

        // 4. 继续下一帧循环
        this.mashLoopId = requestAnimationFrame(() => this.gameLoop());
    }

    /**
     * 结束连打模式
     * 
     * 清理资源、显示结果、发送战报
     * 
     * @static
     * @param {boolean} success - 是否成功
     * @param {string} text - 结果描述文本
     */
    static endMash(success, text) {
        // 1. 停止游戏循环和事件监听
        cancelAnimationFrame(this.mashLoopId);
        document.removeEventListener('keydown', this.boundHandleKey);

        // --- 安全拦截器：防止QTE结束后按键干扰游戏 ---
        const blocker = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener('keydown', blocker, true);
        
        // 1.5秒后移除拦截器（与UI消失时间同步）
        setTimeout(() => {
            document.removeEventListener('keydown', blocker, true);
        }, 1500);

        // 2. 显示结果文本
        const resEl = $('#qte-result-text');
        const cssClass = success ? 'result-perfect' : 'result-bad';
        resEl.text(text).addClass(`${cssClass} show`);
        
        // 3. 播放对应音效
        this.playSound(cssClass);

        // 4. 发送聊天战报
        const color = success ? '#4ade80' : '#f87171';
        const displayTitle = this.title ? this.title : "连打挑战"; // 使用自定义标题或默认标题
        ChatMessage.create({
            content: `<div style="text-align:center; padding:5px; border:1px solid #444; background:#222; color:${color}; font-weight:bold; font-family:'Signika';">
                ${game.user.name} ${displayTitle}: ${text}
            </div>`
        });

        // 5. 延迟移除UI并重置状态
        setTimeout(() => {
            $('#qte-overlay').removeClass('active');
            setTimeout(() => {
                $('#qte-overlay').remove();
                this.isActive = false;
            }, 300);
        }, 1500);
    }

    // ======================================================================
    // 区域 B: 序列模式 (Sequence Mode) 逻辑
    // ======================================================================

    /**
     * 播放下一个序列项目
     * 
     * 序列模式的核心循环方法，逐个显示按键提示
     * 
     * @static
     */
    static playNextSequence() {
        // 检查序列是否已完成
        if (this.currentIndex >= this.sequence.length) {
            this.finishSequence();
            return;
        }
        
        // 获取当前序列数据
        const data = this.sequence[this.currentIndex];
        
        // 清理旧DOM并创建新提示
        $('#qte-overlay').remove();
        this.createSequenceDOM(data);
        
        // 绑定按键监听和启动超时计时
        this.boundHandleKey = (e) => this.handleSequenceKey(e, data);
        document.addEventListener('keydown', this.boundHandleKey);
        
        this.startTime = Date.now();
        this.timeoutId = setTimeout(() => {
            this.resolveSequenceStep(false, '超时', 'result-bad', data);
        }, data.duration);
    }

    /**
     * 创建序列模式DOM结构
     * 
     * 构建包含收缩圆环、目标圆环和按键提示的UI
     * 
     * @static
     * @param {object} data - 序列项目数据
     */
    static createSequenceDOM(data) {
        const isSpace = data.keyDisplay === 'SPACE';
        
        // 计算目标圆环尺寸（基于命中时间比例）
        const targetScale = 1 - (data.hitTime / data.duration);
        const targetSizePx = 300 * targetScale; 

        // 随机屏幕位置 (20%~80% 范围内)
        const minPos = 20; const maxPos = 80;
        const randTop = Math.floor(Math.random() * (maxPos - minPos) + minPos);
        const randLeft = Math.floor(Math.random() * (maxPos - minPos) + minPos);
        const containerStyle = `top: ${randTop}%; left: ${randLeft}%; transform: translate(-50%, -50%); position: absolute;`;

        const html = `
            <div id="qte-overlay">
                <div class="qte-container" style="${containerStyle}">
                    <!-- 收缩圆环动画 -->
                    <div class="qte-approach-ring" style="animation: shrinkRing ${data.duration}ms linear forwards;"></div>
                    
                    <!-- 目标圆环（固定尺寸） -->
                    <div class="qte-target-ring" style="width: ${targetSizePx}px; height: ${targetSizePx}px;"></div>
                    
                    <!-- 按键提示（空格键特殊样式） -->
                    <div class="qte-key-prompt ${isSpace ? 'space' : ''}">${data.keyDisplay}</div>
                    
                    <!-- 结果显示区域 -->
                    <div id="qte-result-text" class="qte-result"></div>
                </div>
            </div>
        `;

        $('body').append(html);
        requestAnimationFrame(() => { $('#qte-overlay').addClass('active'); });
    }

    /**
     * 处理序列模式按键输入
     * 
     * 监听特定按键，计算时机精度并给出评价
     * 
     * @static
     * @param {KeyboardEvent} event - 键盘事件
     * @param {object} data - 序列项目数据
     */
    static handleSequenceKey(event, data) {
        // 防止重复触发和系统快捷键
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
        event.preventDefault(); 
        event.stopPropagation(); 

        const pressedKey = event.code;

        // 检查按键是否正确
        if (pressedKey === data.targetKey) {
            const elapsed = Date.now() - QTEOverlay.startTime;
            const diff = Math.abs(elapsed - data.hitTime); // 计算时间差
            
            // 判定窗口计算
            const halfWindow = data.windowSize / 2;
            const perfectWindow = halfWindow * 0.4; // 完美窗口为总窗口的40%

            // 三级精度判定
            if (diff <= perfectWindow) {
                QTEOverlay.resolveSequenceStep(true, "完美!!", "result-perfect", data, diff);
            } else if (diff <= halfWindow) {
                QTEOverlay.resolveSequenceStep(true, "精彩", "result-good", data, diff);
            } else {
                QTEOverlay.resolveSequenceStep(false, "太早/太晚", "result-bad", data, diff);
            }
        } else {
            // 按键错误处理
            QTEOverlay.resolveSequenceStep(false, "按键错误", "result-bad", data);
        }
    }

    /**
     * 解析序列步骤结果
     * 
     * 记录结果、显示反馈、推进到下一步
     * 
     * @static
     * @param {boolean} success - 是否成功
     * @param {string} text - 评价文本
     * @param {string} cssClass - CSS样式类
     * @param {object} data - 序列数据
     * @param {number} [diff=0] - 时间差（毫秒）
     */
    static resolveSequenceStep(success, text, cssClass, data, diff = 0) {
        // 清理事件和定时器
        document.removeEventListener('keydown', QTEOverlay.boundHandleKey);
        clearTimeout(QTEOverlay.timeoutId);
        $('.qte-approach-ring').css('animation-play-state', 'paused'); // 暂停动画

        // 记录结果
        QTEOverlay.results.push({
            key: data.keyDisplay,    // 按键显示文本
            success: success,        // 成功状态
            ratingText: text,        // 评价文本
            ratingClass: cssClass,   // 评价样式类
            diff: diff               // 时间差
        });

        // 显示结果反馈
        const resEl = $('#qte-result-text');
        resEl.text(text).addClass(`${cssClass} show`);
        QTEOverlay.playSound(cssClass);

        // 延迟推进到下一步
        setTimeout(() => {
            $('#qte-overlay').removeClass('active');
            setTimeout(() => {
                $('#qte-overlay').remove();
                QTEOverlay.currentIndex++;
                QTEOverlay.playNextSequence();
            }, 200);
        }, 800);
    }

    /**
     * 完成整个序列模式
     * 
     * 统计结果、生成战报、发送到聊天
     * 
     * @static
     */
    static finishSequence() {
        QTEOverlay.isActive = false;
        
        // 统计各类评价数量
        let perfects = 0; let goods = 0; let fails = 0;
        let rows = '';
        
        // 构建结果表格行
        QTEOverlay.results.forEach(r => {
            if (r.ratingClass === 'result-perfect') perfects++;
            else if (r.ratingClass === 'result-good') goods++;
            else fails++;

            // 根据成功状态选择颜色
            const color = r.success ? (r.ratingClass === 'result-perfect' ? '#fbbf24' : '#4ade80') : '#f87171';
            const diffText = r.success ? `${Math.round(r.diff)}ms` : '-'; // 成功时显示时间差
            
            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <td style="padding: 4px; font-weight:bold;">[${r.key}]</td>
                    <td style="padding: 4px; color:${color};">${r.ratingText}</td>
                    <td style="padding: 4px; text-align:right; color:#888;">${diffText}</td>
                </tr>
            `;
        });

        // 计算总体评价
        let baseTitle = this.title ? this.title : "挑战"; 
        let totalScoreTitle = `${baseTitle} 失败`;
        let totalScoreColor = "#f87171";
        const totalCount = QTEOverlay.results.length;
        const failRatio = fails / totalCount;
        
        // 多级评价逻辑
        if (failRatio <= 0.3) { 
            if (fails === 0) {
                if (perfects === totalCount) {
                    totalScoreTitle = `${baseTitle} 完美达成!!`;
                    totalScoreColor = "#ffd700"; // 金色
                } else {
                    totalScoreTitle = `${baseTitle} 全部成功!`;
                    totalScoreColor = "#4ade80"; // 绿色
                }
            } else {
                totalScoreTitle = `${baseTitle} 成功`;
                totalScoreColor = "#fbbf24"; // 黄色
            }
        }

        // 构建聊天战报HTML
        const chatContent = `
            <div style="font-family: 'Signika', sans-serif; background: #222; color: #eee; padding: 10px; border: 2px solid #444; border-radius: 8px;">
                <!-- 标题区域 -->
                <div style="text-align:center; border-bottom: 2px solid ${totalScoreColor}; margin-bottom: 10px; padding-bottom: 5px;">
                    <h2 style="margin:0; color:${totalScoreColor}; text-shadow: 0 0 10px ${totalScoreColor};">${totalScoreTitle}</h2>
                    <span style="font-size:12px; color:#aaa;">${game.user.name} 的成绩单</span>
                </div>
                
                <!-- 详细结果表格 -->
                <table style="width:100%; font-size:14px; border-collapse: collapse;">
                    ${rows}
                </table>
                
                <!-- 统计摘要 -->
                <div style="margin-top: 10px; font-size: 12px; text-align: center; color: #888;">
                    完美: ${perfects} | 精彩: ${goods} | 失误: ${fails}
                </div>
            </div>
        `;

        // 发送战报到聊天
        ChatMessage.create({ user: game.user.id, content: chatContent });
    }

    /**
     * 播放音效辅助函数
     * 
     * 根据评价等级播放对应的音效反馈
     * 使用 Foundry VTT 的音频系统
     * 
     * @static
     * @param {string} cssClass - 评价对应的CSS类名
     */
    static playSound(cssClass) {
        let src = SOUNDS.BAD; // 默认失误音效
        if (cssClass === 'result-perfect') src = SOUNDS.PERFECT;
        else if (cssClass === 'result-good') src = SOUNDS.GOOD;
        
        // 使用 Foundry 音频系统播放
        foundry.audio.AudioHelper.play({src: src, volume: 0.8, loop: false}, false);
    }
}