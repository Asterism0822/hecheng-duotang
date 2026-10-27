# 合成多糖

一个照着《合成大西瓜》做的网页版合成小游戏。零依赖，`node server.mjs` 就能跑，
也可以直接丢进任意静态托管。

**线上地址：<https://asterism0822.github.io/hecheng-duotang/>**（GitHub Pages，手机流量直接可玩）

水果用文字代替，从小到大 9 级：

```
可鸭 → 土豆 → 照明 → 主播 → 小猫 → 糖琨 → 糖入 → 草木 → 麦
```

这九个词没有任何含义，只是占位用的标签；你可以在「设置」里把它们逐个换成自己的图片。

![游戏画面](tools/shot-play.png)

## 功能

| 需求 | 实现位置 |
| --- | --- |
| 合成玩法、死亡判定（堆过红线 2.2 秒） | `public/physics.js` |
| 主动结束游戏 | 底部「结束游戏」按钮，需点两次确认，可「继续游戏」撤回 |
| 游戏记录，仅自己可见 | 结算时自动记入浏览器 `localStorage`，「游戏记录」里能看局数、最高、平均和每一局 |
| 记录入口好找 | 开始页、底部工具栏、结算页三处 |
| 自定义贴图，仅自己可见 | 「设置 → 自定义贴图」，同样只写进本机 |
| 亮色界面 | 白底 + 柔和彩色光晕，棋盘也是浅色 |

其他细节：

- 手机、平板、桌面都能玩：按住左右拖动瞄准，松手落下；桌面也支持 `←` `→` + 空格。
- 合成有音效（可在设置里关掉）、粒子与轻微震屏。
- 两个「麦」撞在一起会一起消失，额外加 120 分。
- 同一局「继续游戏」之后再次结算，只会更新那条记录，不会多出一条。

## 跑起来

需要 Node.js 18 或更新（`node -v` 看一下）。项目没有任何第三方依赖，不用 `npm install`。

```bash
cd merge-duotang
node server.mjs
```

或者直接双击 `start.bat`（会自动开浏览器）。

启动后终端会打印两个地址：

```
本机：   http://127.0.0.1:3000
局域网： http://10.x.x.x:3000
```

同一个 WiFi 下的手机、同事的电脑打开「局域网」那条就能玩。

> 手机打不开、但电脑自己访问正常的话，多半是 Windows 防火墙拦了。两种情况：
>
> 1. 有两条 Block 规则：`Get-NetFirewallRule -DisplayName "Node.js JavaScript Runtime"`
>    如果看到 `动作=Block`，说明以前在「允许 Node 访问网络」的弹窗上点过取消。删掉它们
>    再放行端口即可，仓库里的 `tools/fix-firewall.ps1` 就是干这个的（右键「以管理员身份运行」）。
> 2. 没有规则、只是被默认策略拦住：控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙 → 勾上 Node.js，
>    或者用管理员命令行执行
>    `netsh advfirewall firewall add rule name="duotang" dir=in action=allow protocol=TCP localport=3000`。
>
> 放行之后还是连不上，那就是这台 WiFi 开了客户端隔离（学校 / 公司网络很常见），
> 换手机热点或走内网穿透。

改端口：`PORT=8080 node server.mjs`（Windows PowerShell 用 `$env:PORT=8080; node server.mjs`）。

## 线上部署（GitHub Pages）

当前就是这套：仓库 <https://github.com/Asterism0822/hecheng-duotang>，
Pages 用「分支 + `/docs`」发布，地址 <https://asterism0822.github.io/hecheng-duotang/>。

改完页面后发布一次：

```bash
node tools/build-docs.mjs        # 把 public/ 同步到 docs/
git add -A
git commit -m "更新一下"
git push
```

推送后 GitHub 会自动重新构建，大约半分钟后生效。`docs/` 是构建产物，别手改。

## 其他部署方式

整个游戏是纯前端：没有接口、没有数据库，服务器只负责把 `public/` 发出去。所以放哪儿都行：

1. **Netlify / Vercel / 对象存储**：把 `docs/`（或 `public/`）目录整个传上去即可。
2. **自己的服务器 / VPS**：`node server.mjs` 常驻（`pm2 start server.mjs` 或 systemd），
   前面挂个 Nginx 反代到 3000；也可以 `docker build -t duotang . && docker run -p 3000:3000 duotang`。
3. **本机 + 内网穿透**（临时）：`cloudflared tunnel --url http://localhost:3000`，关掉就失效。

## 数据与隐私

- **游戏记录**：每局结束自动写进 `localStorage`，最多保留 50 条，只有这台设备能看到。
- **自定义贴图**：图片缩到 192×192 后同样存进 `localStorage`，从不发往任何服务器。
- 清浏览器数据、换浏览器、换设备，这两样都会没有。服务器上不存任何玩家数据。

## 测试

```bash
npm test                     # 跑下面前三个
node test/physics.test.mjs   # 合成、堆叠、越线判负、随机投放不炸
node test/server.test.mjs    # 静态服务、404、目录穿越、旧接口已下线
node tools/check-dom.mjs     # 元素 id、合成链、改名是否彻底
node tools/balance.mjs       # 模拟玩家，看不同容器尺寸大概多久会死（调参用）
```

## 目录

```
merge-duotang/
├─ server.mjs              # 纯静态服务器（Node 内置模块，零依赖）
├─ start.bat               # Windows 双击启动
├─ public/
│  ├─ index.html
│  ├─ style.css            # 亮色主题
│  ├─ game.js              # 渲染、输入、结算、游戏记录、设置
│  └─ physics.js           # 圆形物理 + 合成规则（不依赖 DOM，可单测）
├─ test/                   # 物理 / 服务器测试
└─ tools/                  # 开发期小工具（截图、诊断、静态检查）
```

## 调参

想改手感，看 `public/physics.js` 顶部：

- `GRAVITY`：重力，越大掉得越快
- `LEVELS`：每级的名字、半径、颜色
- `OVERFLOW_LIMIT`：越线多久算死（秒）
- `dropWeights`：只掉前几个小水果，权重在这里

想改配色，看 `public/style.css` 顶部的 CSS 变量（背景、主色、圆角、阴影）。

## 已知限制

- 记录只在本机，换设备就看不到；也没有任何跨设备同步。
- 分数是本机计算的，愿意改浏览器存储就能改，自己玩没必要防。
