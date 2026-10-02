# 绒点 / Dots

单一主人自托管的私人 AI 伙伴：React + TypeScript + Capacitor Android、FastAPI、Codex app-server、隔离浏览器/终端。保留原创毛绒伙伴绒绒，不含 Grok 的品牌、角色、私有素材或客户端代码。

## 当前功能

- 聊天、流式事件、公开思考摘要与真实工具进度、授权卡片、停止、附件、云电脑与文件。
- 独立 Bot：名字、工作指令、配色、记忆；旧账号、旧聊天和默认绒绒不变。
- 私人多 Bot 群聊：2–4 位伙伴、各自的真实运行时线程、共享本群公开消息并串行回复。不是一个模型假扮多人，不是对外多人社交服务。
- Bot 模板：预览/编辑 JSON、导入为新伙伴、保存到本地文件。只允许名字、指令、配色；不导出记忆、聊天、文件、任务、凭据或授权。工作指令是自由文本，导出前仍须人工移除私人内容。不会自动发布到公网。
- 例行任务、技能/工具、手机语音输入/播报、可选后台通知。运行时自动保存记忆和安排任务仍须授权。
- 黑白灰界面、局部角色动画、减少动画支持与页面隐藏时暂停动画。
- 消息发送即时回显并显示待确认/失败状态；服务事件确认后去重。回复仅渐进呈现实际收到的内容，按自然句段分块，保留代码、链接、列表和表格。

所有 Bot 共用同一主人的私人云电脑/文件工作区；独立记忆不是不同账号之间的安全隔离。群聊轮流执行，遇到等待授权会暂停；失败、停止或服务重启不会静默启动后续成员。原始推理不展示；DeepSeek 不信任网关标为 summary 的内容。

## 源码

| 路径 | 内容 |
| --- | --- |
| `src/`, `public/` | Web UI、协议与原创素材 |
| `android/` | Capacitor 宿主、Keystore 会话保存、语音/文件/后台插件 |
| `server/` | 单一主人认证、SQLite、Bot/群聊、任务与授权、模型代理 |
| `runtime/` | Codex app-server、MCP 浏览器、文件与命令隔离 |
| `deploy/` | 容器、网络、代理、初始化与签名工具 |
| `tests/` | 使用临时目录和合成数据的隔离测试 |

公开仓库从干净的初始历史建立，不含原工作区 Git 历史、私人账号配置、数据库、日志、截图录屏、生产导出、APK 或签名材料。包名 `com.microedulab.dots` 是产品标识，不是账户凭据；独立分发建议改用自己的 applicationId，不能用自行签名的包覆盖别人的正式安装。

## 本地开发

需要 Node.js 22+、pnpm 9、Python 3.12+；Android 构建需要 JDK 17+、Android SDK 35 和已接受的 SDK licenses。

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器只监听本机，`/api` 转发到 `127.0.0.1:8091`。后端需要单独配置运行时及主人账号，UI 不内置测试登录/虚假数据。

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r server/requirements.txt -r runtime/requirements.txt pytest
python -m pytest tests -q
pnpm test
pnpm build
```

Windows 使用 `.venv\Scripts\python.exe`。测试使用临时目录，不能用生产状态目录运行测试。

## Android

前台 API 和后台通知必须使用相同的 HTTPS origin；不接受路径、HTTP 或宽泛明文网络权限。正式构建强制要求显式配置，且拒绝 `example.com` 示例域名；请先把以下示例替换为自己的实际服务域名。`.env` 只被 Vite 自动加载，Gradle 读取进程环境，所以请显式导出：

```sh
export VITE_DOTS_API_ORIGIN=https://dots.example.com
pnpm build
pnpm android:sync
# 设置 ANDROID_HOME / JAVA_HOME，或在不受版本控制的 android/local.properties 设置 sdk.dir
./android/gradlew -p android :app:assembleRelease
```

PowerShell：`$env:VITE_DOTS_API_ORIGIN='https://dots.example.com'`，使用 `android\gradlew.bat`。

输出 `android/app/build/outputs/apk/release/app-release-unsigned.apk`。使用自己的签名密钥签名后安装；升级必须保持 applicationId、签名及递增 versionCode。正式包不开放 WebView 调试，不提供默认账号或密钥。`deploy/sign-apk.sh` 是服务器签名工具，其密钥/密码仅存服务器；不要将任何签名目录加入 Git。

## 自托管部署

部署为高级运维操作，请先通读 `deploy/compose.yml`、Dockerfile、隔离与 egress 配置。不要在已有服务器上盲目执行初始化脚本。

1. 为 Dots 准备独立 Linux 主机/容器环境，安装 Docker Compose。`deploy/bootstrap.sh` **需要 root，会创建 512MiB/6GiB loopback 文件系统、挂载并修改 `/etc/fstab`**，只用于已明确规划的首次初始化；不要将其作为升级步骤。也可以自行创建同等目录和用户权限。
2. 状态位于 `/opt/dots/state`；工作区、运行时 home、浏览器 profile 位于 `/opt/dots/computer`；秘密位于 `/opt/dots/secrets`。UID/GID 与 Compose/Dockerfile 一致。
3. 通过服务器上权限为 `0600` 的两行临时文件输入自有用户名和至少12字符密码，运行 `python3 deploy/provision-owner.py /安全路径/临时文件 /opt/dots/secrets/owner.json`。工具生成加盐 scrypt 摘要并删除临时明文，不覆盖现有账号。
4. 初始化脚本生成独立 `RUNTIME_TOKEN` / `AGENT_TOKEN` 到服务器的 `runtime.env`。请勿将这些值复制到仓库、终端记录或浏览器构建变量。
5. 仅在服务器创建 `model.json`，字段为 `base_url`、`api_key`、`model_mapping`。上游应支持 Responses API；公开模型别名见 `runtime/models.json`、`server/app.py`，部署者可通过 mapping 对接自己有权使用的模型。代码中的模型名不表示提供模型权重、账号或免费 API。
6. 使用 Sub2API 时，`deploy/provision-model.py` 可在显式给出 `--key-id`、`--group-id` 后从自己的数据库读取已有自用 key；也可指定 `--db-container` / `--base-url`。它不创建或修改上游 key。不要在无关数据库上运行。
7. 设置 `DOTS_UPSTREAM_NETWORK` 为自己的上游网络，默认名称 `dots-upstream` 必须预先存在。网络应允许 API 访问自己的上游，并保持运行时只经受限 egress 联网。不得为图省事关闭 SSRF/授权/工作区限制。
8. 用审阅后的固定提交构建：

```sh
export DOTS_SHA=$(git rev-parse HEAD)
export DOTS_UPSTREAM_NETWORK=dots-upstream
docker compose -f deploy/compose.yml build
docker compose -f deploy/compose.yml up -d
```

9. 为 Caddy 服务配置 `DOTS_DOMAIN`，参考 `deploy/dots.caddy`；先 validate 再 reload。不要直接替换已有服务的配置。API 端口只绑定 `127.0.0.1:8091`，由 HTTPS 反代访问；只信任受控反代设置的客户端 IP 头。
10. 检查 `/health`、容器健康与权限边界；升级前确认无执行中任务，并在服务器备份 SQLite/状态。数据库新增列和表不删除旧聊天；旧镜像不等于数据库回滚。严禁 `down -v` 或清空数据来排障。

`DOTS_CORS_ORIGINS` 可配置精确额外 Web origins；原生 `https://localhost`、`capacitor://localhost` 以及本机开发入口被明确允许。使用额外 origin 时将该环境变量传给 API 容器，不使用 `*`。

## 安全与许可

- 仅供单一主人私有部署，不提供多租户隔离保证。不要开放给不可信用户。
- 网站、附件、其他 Bot 的输出均是非可信上下文，不能代替主人授权。账号登录、付款、发布、隐私上传必须由主人决定。
- 原创项目代码与绒绒素材按 MIT 许可发布，见 `LICENSE`；不授予第三方品牌权利，也不意味着本项目属于或获得 xAI/Grok 背书。
- React、Capacitor、Vite、Lucide、FastAPI、Playwright、Codex、Gradle 等依赖/工具分别遵循其上游许可；本仓库不包含其账号、模型权重或私有服务。Gradle wrapper/生成的 Android 框架文件保留原有版权标头。
- 依赖版本见 pnpm 锁文件、requirements 与 Gradle 配置。发布不等于完成所有依赖漏洞审计；部署者应持续更新和审查。
