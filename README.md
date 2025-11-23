一个为 Foundry Virtual Tabletop 设计的简单的QTE模块。

🚀 使用方法
基础使用
以GM身份登录游戏

在场景控制栏的令牌工具中找到QTE按钮（⏱️图标）

点击按钮打开配置窗口，设置连击次数和难度

点击触发，所有玩家将同时开始QTE挑战

宏命令调用：

// 获取API实例

const qte = game.modules.get("visual-qte")?.api;

// 触发QTE事件

qte.trigger({
    count: 5,        // 5连击
    duration: 2000,  // 速度 2000ms
    gmPlay: true     // GM也参与游戏
});

// 或者直接打开配置窗口

qte.openDialog();

🎨 自定义选项
音效自定义
将自定义音效文件放置在模块的sounds/目录下：

perfect.wav - 完美判定音效

good.wav - 精彩判定音效

bad.wav - 失误判定音效
