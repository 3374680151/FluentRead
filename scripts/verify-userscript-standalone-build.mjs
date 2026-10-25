import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifact = resolve(root, '.output/userscript-standalone/fluent-read.user.js');
const source = readFileSync(artifact, 'utf8');
const metadataEnd = source.indexOf('// ==/UserScript==');
if (metadataEnd < 0) throw new Error('Standalone userscript metadata is missing');
const metadata = source.slice(0, metadataEnd);
const {userscriptVersion} = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const assertions = [
    [source.startsWith('// ==UserScript==\n'), 'Metadata must be the first bytes'],
    [metadata.includes(`// @version      ${userscriptVersion}`), 'Standalone version is stale'],
    [metadata.includes('// @inject-into  content'), 'GM APIs require content-world injection'],
    [metadata.includes('// @grant        GM.xmlHttpRequest'), 'Safari request grant is missing'],
    [metadata.includes('// @grant        GM_xmlhttpRequest'), 'Classic request grant is missing'],
    [metadata.includes('// @grant        GM.openInTab') && metadata.includes('// @grant        GM_openInTab'), 'Settings tab grants are missing'],
    [!/^\/\/ @require\s/gmu.test(metadata), 'Standalone installation must not need remote JavaScript'],
    [source.includes('fluentread-userscript-settings'), 'Full Options route is missing'],
    [!source.includes('fluent-read-writing-assistant'), 'Writing assistant runtime must be excluded'],
    [source.includes('__FLUENTREAD_BROWSER_CAPABILITY_BUILD__:userscript:mv2__'), 'Userscript browser capability marker is missing'],
    [source.includes('pako 2.1.0 —'), 'Bundled gzip fallback or license notice is missing'],
    [source.includes('@vue/runtime-dom 3.5.13 —'), 'Bundled Vue or license notice is missing'],
    [source.includes('element-plus 2.9.3 —'), 'Bundled UI or license notice is missing'],
];
for (const [passed, message] of assertions) {
    if (!passed) throw new Error(message);
}
const bytes = Buffer.byteLength(source);
// Full Options adds its navigation, settings forms, and CSS to the direct-install build.
// This build is hosted outside Greasy Fork, whose separate rules cap scripts at 2 MB.
// Current main eec7c7517 measures 3,611,259 bytes locally; the three completed
// selection prompts add 430 bytes. Release tooling adds no runtime bytes.
// Allow the previously measured 1,825-byte Ubuntu/Node 22 build difference,
// then round 3,613,514 up to the next 1 KB; the PR packaging run verifies it.
const maxBytes = 3_614_000;
if (bytes > maxBytes) throw new Error(`Standalone userscript grew past ${maxBytes.toLocaleString('en-US')} bytes: ${bytes}`);
console.log(`Verified ${artifact} (${bytes.toLocaleString()} bytes; no @require)`);
