# SkadiPet · clever-the-skadi

基于 **Spine 3.8** 模型（浊心斯卡蒂）的 Windows 桌宠，填入任意 **OpenAI 兼容 API** 即可对话。

模型来源：[isHarryh/Ark-Models · 1012_skadi2_iteration#2](https://github.com/isHarryh/Ark-Models/tree/main/models/1012_skadi2_iteration%232)

## 功能

- **桌宠显示**：透明无边框窗口、始终置顶、空白区域鼠标穿透、可拖动
- **对话**：左键点击模型弹出对话框 → 输入文字提问 → 思考中显示省略号 → 流式展示回复；右键菜单可清空记录
- **动作**：右键模型或打开设置可切换 **站立 / 走路 / 卧倒**；走路时模型在屏幕上往返行走、到边界自动折返
- **设置**（右键 → 设置…）：
  - API 设置：接口地址（如 `https://api.openai.com/v1`、`https://api.deepseek.com/v1`）、API Key、模型名称、人设提示词、温度，支持「测试连接」
  - 模型动作：当前动作、三种动作对应的动画名（从模型真实动画列表中选择）、走路速度、模型缩放
  - 对话框：背景颜色、文字颜色、背景透明度、字体大小、自动隐藏秒数
- 重复启动自动聚焦已有桌宠（单实例）

## 使用

1. 双击 `release/SkadiPet.exe` 启动（首次启动会解压，稍等几秒）
2. 右键桌宠 → **设置…** → 填写 API 地址 / Key / 模型名 → 「测试连接」→ 保存并应用
3. 左键点击桌宠开始对话

配置保存在 `%APPDATA%\SkadiPet\config.json`。

## 开发

```bash
npm install        # 安装依赖
npm start          # 编译渲染层并启动（开发模式）
npm run dist       # 打包 portable exe 到 release/SkadiPet.exe
```

成品 exe 不入 git，发布时作为附件挂在 GitHub Release（tag v1）下。

技术栈：Electron + pixi.js 7 + pixi-spine 4（内置 Spine 3.8 runtime）+ esbuild + electron-builder。
渲染页面由主进程内置的 127.0.0.1 静态服务提供（规避 file:// 限制），LLM 请求由主进程代理（规避 CORS）。

## 目录结构

```
main/          Electron 主进程（窗口 / 托盘逻辑 / LLM 流式代理 / 走路循环 / 配置）
src/           渲染层源码（pixi-spine 加载渲染、气泡与交互）
static/        页面与样式（index.html / settings.html / css）
assets/models  Spine 模型（.skel / .atlas / .png）
test/          开发调试工具（CDP 截图、mock LLM 服务器）
```
