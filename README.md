# Map of Us · 微信小程序

记录两个人去过的地方的情侣回忆地图。微信原生小程序，直接对接 **你服务器上已有的 PHP + MySQL 后端**（ql.hlat.xyz）。

- 地图首页：小程序 `<map>` 组件高亮「点亮」的省份，城市用爱心标记，点开进详情
- 时间线：纪念日 + 每段旅程（按时间排列，tone 渐变封面、标签）
- 城市详情：标题、引语、季节/天气/地标、标签、照片（tone 占位）、手记
- 顶部「在一起第 N 天」：从「第 100 天」纪念日自动反推起点

## 后端（已存在，无需重新部署）

线上接口（已配 HTTPS 证书）：

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | https://ql.hlat.xyz/api/journeys.php | 全部旅程 + 纪念日 | 你原有 |
| GET | https://ql.hlat.xyz/api/provinces.php | 已点亮省份的多边形（地图高亮用） | 本次新增 |

数据库 `ql_hlat_xyz` 已有表：`journeys` / `journey_photos` / `journey_notes` / `journey_tags` / `anniversaries`（结构见 `php/schema.reference.sql`），并已有 5 段旅程示例数据。

### 本次对服务器做的改动

仅新增了地图高亮所需的省份多边形接口，**没有改动你已有的任何文件 / 数据**：

- 新增 `/www/wwwroot/ql.hlat.xyz/api/provinces.php`
- 新增 `/www/wwwroot/ql.hlat.xyz_private/china-provinces.json`（中国省份 GeoJSON，放在网站私有目录，不对外暴露）

`provinces.php` 复用了已有的 `_private/db.php` 连接，从 `journeys` 表取出去过的省份，
在 GeoJSON 里匹配对应省份的轮廓（数据库省名不带「省/市/自治区」后缀，用前缀匹配），
抽稀到每环 ≤160 点、过滤掉细碎岛屿后返回，整包约 25KB。

## 小程序端

```
miniprogram/
├── app.js/json/wxss        全局配置（apiBase = https://ql.hlat.xyz/api）
├── pages/
│   ├── index/   地图首页：省份高亮 + 城市爱心标记 + 统计 + 在一起天数
│   ├── timeline/ 时间线：纪念日 + 旅程卡片
│   └── detail/   城市详情：照片/手记/标签/天气/地标
├── utils/
│   ├── api.js   接口封装（journeys.php / provinces.php）
│   └── util.js  tone→渐变、日期格式化
└── assets/      爱心 marker 图标（脚本生成，见 tools/gen-heart.js）
```

### 在微信开发者工具里运行

1. 打开微信开发者工具 → 导入项目 → 选择本目录 `map-of-us-mp/`。
2. AppID 已填好：`wxdf663f2649d53f09`（`project.config.json`）。
3. 开发阶段：详情 → 本地设置 → 勾选「不校验合法域名、TLS 版本以及 HTTPS 证书」，即可直接联网调试。
4. 正式发布前：登录小程序管理后台 → 开发管理 → 开发设置 → 服务器域名，把
   `https://ql.hlat.xyz` 加入 **request 合法域名**（域名需已 ICP 备案）。

## 关于照片

`journey_photos.image_url` 目前为空，小程序会用每张照片的 `tone` 渐变作占位。
等你把照片传到服务器（例如 `https://ql.hlat.xyz/uploads/xxx.jpg`）并写进
`image_url`，小程序会自动显示真实图片，无需改代码。
