# 自动发布安装包

`.github/workflows/release-packages.yml` 在推送 `vX.Y.Z` 标签后，校验版本、执行完整确定性测试及严格覆盖率、构建各端产物，并将完整附件上传到同名 GitHub Release。标签必须指向 `main` 历史中的提交，并与根 `package.json.version` 完全一致。

修改版本号只触发普通 CI，**推送标签才会发布安装包**。无需个人访问令牌；只有最终发布 job 使用仓库自带的 `GITHUB_TOKEN` 写入 Release，构建和测试 job 仅有读取权限。

## 交付内容

| 目标 | Release 附件 | 版本与安装边界 |
| --- | --- | --- |
| Chrome | `fluent-read-X.Y.Z-chrome.zip` | 保留现有公开身份 key；解压加载或准备既有商店条目的更新 |
| Edge | `fluent-read-X.Y.Z-edge.zip` | 独立 Edge MV3 构建，不混入 Chrome OAuth 配置 |
| Firefox | `fluent-read-X.Y.Z-firefox.zip` 与 `fluent-read-X.Y.Z-sources.zip` | 未经 Mozilla 签名，用于提交审核或开发测试；普通正式版安装仍需签名 |
| Thunderbird | `fluent-read-X.Y.Z-thunderbird.xpi` | 从同一次 Firefox 构建生成，未签名 |
| Zotero | `fluent-read-X.Y.Z-zotero.xpi` | 校验并保留 Zotero 自身 manifest 版本 |
| Obsidian | `fluent-read-X.Y.Z-obsidian.zip` | 含 `main.js` 和 `manifest.json`，解压至 Obsidian 插件目录；保留独立插件版本 |
| 油猴标准版 | `fluent-read-U.V.W-userscript.user.js` | `U.V.W` 来自 `userscriptVersion`，继续使用现有脚本依赖和更新渠道 |
| 油猴 standalone 版 | `fluent-read-U.V.W-userscript-standalone.user.js` | 独立脚本版本，配套资源如有则另附 ZIP |
| Safari | `fluent-read-X.Y.Z-safari-webextension-unsigned.zip` | 网页扩展资源包，仍需 Apple 工具包装和签名，不是已签名 Safari App |

附件另含 `release-manifest.json` 和 `SHA256SUMS.txt`。清单记录源提交、目标、实际内部版本、未签名状态、文件大小和 SHA-256；校验和同时覆盖安装包与清单自身。发布说明包括安装边界及 GitHub 自动生成的变更记录。

Zotero、Obsidian、油猴版本目前独立维护。根版本标签表示整组产物的快照，不会将所有组件强行改成同一版本。如需让插件自身识别更新，发版前应显式更新相应 manifest 或 `userscriptVersion`。

此流程发布 GitHub 下载附件。Chrome Web Store、Edge Add-ons、Firefox AMO、Greasy Fork 和 Apple App Store 的账号认证、审核与分发需要各自接入。Greasy Fork 专用源码要求提交过且一致的固定依赖资源；保持现有保护，本流程发布标准版和 standalone 安装脚本，不自动改写托管资源。Zotero 的 `updates.json` 也不会在此流程中自动启用。

## 发版步骤

1. 在正常 PR 中更新根 `package.json.version`，按需更新独立组件版本，合入 `main`。
2. 获取最新 `main`，核对提交，然后创建并推送对应标签。例如版本已更新至 `0.0.41` 时：

```sh
git fetch origin
git tag -a v0.0.41 origin/main -m 'FluentRead 0.0.41'
git push origin refs/tags/v0.0.41
```

3. 在 Actions 查看 `Release packages`。测试及所有构建成功后，流程先创建草稿并上传全部附件，再发布完整 Release；途中失败保留草稿，不提前公开残缺版本。
4. 从 Release 下载全部附件，使用 `shasum -a 256 -c SHA256SUMS.txt`（Linux 也可用 `sha256sum -c`）校验。

不要移动已经发布的标签。重跑会核对相同来源、附件名称、字节大小和摘要：完整且一致的公开版本直接成功，不覆盖公开附件；同一构建的未完成草稿仅补齐缺失附件。若重新构建产生不同字节，或存在其他来源的同名 Release，流程失败并要求维护者检查，避免静默替换已分发内容。

## 演练与维护

在 Actions 手动运行 `Release packages`，会使用所选 ref 的版本做完整测试、构建、汇总，生成保留三天的 `release-packages` 下载附件，**不会创建或发布 Release**。修改此流水线、发布脚本或其测试的 PR，也会执行各端打包演练与发布夹具测试；PR 中不运行完整覆盖率，由现有 `Extension quality` 执行受影响测试门禁。

实际推送标签及手动演练会额外运行全套确定性 Vitest/严格覆盖率，其中已包含 Zotero 和发布夹具测试，避免重复运行。构建包括现有清单、脚本、集成验证及 Edge 包逐文件比较。这些不替代真实浏览器、商店审核或 Apple 原生签名验收。

本地定向验证发布脚本（标签需与当前源码版本一致）：

```sh
node --test --test-concurrency=1 tests/release*.test.mjs
node scripts/release/manifest.mjs --check --tag v0.0.40
```

打包器只收集已构建且通过相应验证的产物，例如 `node scripts/release/bundle.mjs --target chrome`；不会自动构建或发布。临时目录统一为 `reports/release/`，已加入 Git 忽略并从 Firefox 源码 ZIP 排除，避免本地再次打包时夹带旧安装包。

相关官方说明：[GitHub 事件与标签过滤](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[GitHub Release 创建](https://cli.github.com/manual/gh_release_create)、[Firefox 签名与分发](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)。
