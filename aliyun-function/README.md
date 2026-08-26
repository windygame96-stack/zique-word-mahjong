# 阿里云联机后端

此目录用于阿里云函数计算，处理 `/api/game`，并把房间状态保存到表格存储。

部署配置：

- 运行时：Node.js 20
- 处理程序：`index.handler`
- HTTP 触发器：无需认证
- 函数角色：授予目标表格存储实例的读写权限
- 环境变量：`OTS_ENDPOINT`、`OTS_INSTANCE`、`OTS_TABLE=zique_rooms`
- 可选环境变量：`ALLOWED_ORIGINS`

数据表：

- 表名：`zique_rooms`
- 主键：`code`，字符串
- 最大版本数：1
- 数据生命周期：30 天

代码通过函数角色提供的临时凭证访问表格存储，不保存阿里云 AccessKey。
