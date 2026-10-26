/**
 * @file web/vite.config.ts
 *
 * 文件职责：FluentRead Web 真站服务端的构建配置。
 * 主要内容：以 SSR 模式把 web/server.ts 打包为 Node ESM 产物，输出到 web/dist；
 * 把仓库根目录注册为 '@' 别名，与 src 代码内部既有的导入路径保持一致。
 * 模块边界：只服务于 web/ 集成的构建，不影响 WXT 扩展、userscript 与文档构建。
 */

import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
    resolve: {alias: {'@': fileURLToPath(new URL('..', import.meta.url))}},
    // 真站静态资源只使用 web/public；关闭 vite 默认 publicDir，避免把扩展的 public/ 资产拷进产物。
    publicDir: false,
    build: {outDir: 'dist', emptyOutDir: true},
});
