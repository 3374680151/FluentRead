/**
 * @file web/vite.config.client.ts
 *
 * 文件职责：FluentRead Web 客户端共享模块的构建配置。
 * 主要内容：以库模式把 web/src/client/vocabulary.ts（词书领域层再导出）打包为
 * ES Module 产物 web/public/assets/vendor/fr-vocabulary.js，供 study.html、learn.html
 * 以原生 <script type="module"> 直接导入；把仓库根目录注册为 '@' 别名，与 src 代码
 * 内部既有导入路径保持一致。
 * 模块边界：只服务于 web/ 客户端 bundle 的构建，不影响 WXT 扩展、userscript、
 * 服务端打包与文档构建；产物为构建输出（web/public/assets/vendor/ 已加入 .gitignore）。
 */

import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
    resolve: {alias: {'@': fileURLToPath(new URL('..', import.meta.url))}},
    // 静态资源只使用 web/public 自身的页面资产；关闭 vite 默认 publicDir，避免拷贝扩展 public/。
    publicDir: false,
    build: {
        // 绝对路径输出：vite 默认 root 是执行目录（pnpm 脚本在仓库根），相对 outDir 会落到扩展的 public/。
        outDir: fileURLToPath(new URL('./public/assets/vendor', import.meta.url)),
        emptyOutDir: true,
        lib: {
            entry: fileURLToPath(new URL('./src/client/vocabulary.ts', import.meta.url)),
            formats: ['es'],
            fileName: () => 'fr-vocabulary.js',
        },
        target: 'es2020',
    },
});
