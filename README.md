# 字雀 · 文字麻将

一个适合 2—4 位朋友在线玩的汉字牌桌。摸字、出牌，用手里的字组成一句至少四个字的话即可胡牌。

## 已有功能

- 免注册轻登录，昵称和头像颜色保存在当前设备
- 四位房号与邀请链接
- 2—4 人实时房间、摸牌、出牌、胡牌、再来一局
- 刷新或短暂断线后自动找回牌桌
- 手机和桌面端响应式界面

## 项目结构

- `app/`：React/vinext 全栈版本
- `github-pages/`：GitHub Pages 静态前端入口
- `aliyun-function/`：阿里云函数计算 + 表格存储联机后端
- `.github/workflows/pages.yml`：GitHub Pages 自动发布流程

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

构建完整版本：

```bash
npm run build
```

构建 GitHub Pages 前端：

```bash
VITE_ZIQUE_API_BASE=https://your-api.example.com npm run build:pages
```

## GitHub Pages

仓库变量 `ZIQUE_API_BASE` 用于指定联机 API 地址。工作流会在 `main` 分支更新时构建并发布静态前端。

## 阿里云后端

部署说明见 [`aliyun-function/README.md`](aliyun-function/README.md)。函数通过阿里云函数角色取得临时凭证，不需要把 AccessKey 写进代码或 GitHub。

## 当前验证

- GitHub Pages 静态前端构建通过
- 阿里云后端双人完整牌局测试通过
- 后端生产依赖安全审计为 0 个已知漏洞
