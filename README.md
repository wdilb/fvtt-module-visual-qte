# Visual QTE - Fvtt QTE 模块

一个为 Foundry Virtual Tabletop 设计的简单的QTE模块。

## 🚀 使用方法

### 基础使用

1. 以 GM 身份登录游戏
2. 在场景控制栏的令牌工具中找到 QTE 按钮（⏱️ 图标）
3. 点击按钮打开配置窗口，设置连击次数和难度
4. 点击触发，所有玩家将同时开始 QTE 挑战

### 宏命令调用

```javascript
// 获取 API 实例
const qte = game.modules.get("visual-qte")?.api;

// 触发 QTE 事件
qte.trigger({
    count: 5,        // 5 连击
    duration: 2000,  // 速度 2000ms
    gmPlay: true,    // GM 也参与游戏
    windowSize: 300, // 判定宽容度 (毫秒)
    // --- 目标设置 (可选) ---
    // 如果留空 []，则广播给所有人
    // 如果填入玩家 ID，则只发给这些人 (例如: ["User1ID", "User2ID"])
    // 获取 ID 的方法：在左侧玩家列表右键点击玩家名字 -> Copy ID
    targetIds: [] 
});

// 或者直接打开配置窗口
qte.openDialog();
```

## 🎨 自定义选项

### 音效自定义

将自定义音效文件放置在模块的sounds/目录下：

perfect.wav - 完美判定音效

good.wav - 精彩判定音效

bad.wav - 失误判定音效
