# 猫爪 (CatPaw / CatVodOpen) Node.js 视频源仓库 (49 源合集)

本仓库已为您整理并预编译好上传压缩包中的 **49 个猫爪 (CatPaw / CatVodOpen / catBridge) JS 视频源**，同时配置了 **GitHub Actions 自动打包工作流**。

## 一、生成的源链接格式 (`index.js.md5`)

将本文件夹上传至您的 GitHub 仓库后，根据您使用的客户端壳子选择以下对应的链接格式（请将 `<用户名>` 和 `<仓库名>` 替换为您自己的 GitHub 账号与仓库名）：

### 1. 猫爪 (CatPaw) / JSTV / MiraPlay / MorePlay (CatPawOpen-FW) 公开仓库直链
- **GitHub Raw 官方直链**：
  ```text
  https://raw.githubusercontent.com/<用户名>/<仓库名>/main/dist/index.js.md5
  ```
  *(根目录同样保留了副本，因此 `https://raw.githubusercontent.com/<用户名>/<仓库名>/main/index.js.md5` 也可直接使用)*

- **国内免翻加速直链（推荐国内网络环境使用）**：
  ```text
  https://ghfast.top/https://raw.githubusercontent.com/<用户名>/<仓库名>/main/dist/index.js.md5
  ```

### 2. 原版 CatVodOpen (V1.1.3 及以上版本，强制要求私有仓库 + Token)
- **GitHub 私有仓库协议链接**：
  ```text
  github://<您的GitHub_Token>@github.com/<用户名>/<仓库名>/dist/index.js.md5
  ```

## 二、目录结构说明

```text
├── .github/workflows/
│   └── build.yml            # GitHub Actions 自动打包工作流（修改 src 后自动重算 MD5）
├── dist/                    # 已预编译好的成品目录（可直接被客户端拉取）
│   ├── index.js             # 49 个源打包合并后的单文件 Node.js 产物
│   ├── index.js.md5         # index.js 的 32 位小写 MD5 校验值（无换行符）
│   ├── index.config.js      # 49 个源的站点配置表
│   ├── index.config.js.md5  # index.config.js 的 32 位小写 MD5 校验值
│   └── package.json         # CommonJS 模块声明
├── src/
│   ├── spider/video/        # 存放全部 49 个单文件 JS 猫爪爬虫源
│   ├── util/req.js          # 内置 HTTP/HTTPS 请求客户端（支持自动解压与自签名证书）
│   ├── router.js            # 自动生成的 Fastify 路由注册表
│   ├── index.config.js      # 自动生成的 ES Module 站点配置
│   └── index.js             # Fastify 兼容服务端与 start/stop 入口
├── build.js                 # 自动扫描 src/spider/video/*.js 并打包生成 dist 与 MD5 的构建脚本
├── webpack.config.cjs       # Webpack 打包配置
└── package.json             # Node.js 工程配置
```

## 三、后续如何增删或修改 JS 源？

1. 直接在 GitHub 网页端进入 `src/spider/video/` 目录，上传新的 `.js` 猫爪源文件，或修改现有文件并点击 **Commit changes**。
2. 提交后，仓库顶部的 **Actions** 会自动运行 `Build CatPaw index.js.md5` 工作流：
   - 自动扫描 `src/spider/video/` 下的所有 `.js` 源；
   - 自动更新 `src/router.js` 和 `src/index.config.js`；
   - 重新打包生成 `dist/index.js` 并重新计算 32 位 MD5 写入 `dist/index.js.md5`。
3. 在猫爪 / CatVodOpen 客户端中点击刷新配置，客户端检测到 `index.js.md5` 数值变化后会自动拉取最新 `index.js`。
