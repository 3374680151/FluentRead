'use strict';
/**
 * @file scripts/testing/manga-quality-corpus.cjs
 * 文件职责：校验漫画回归场景的真实文字、重复次数和无字区域，汇总实际 OCR 的质量失败。
 * 主要内容：共享锚点规范化、source truth 一致性、全页多余字符库存、负区域与无字页误报检查。
 * 模块边界：只处理夹具声明与生产返回值，不执行 OCR、不重写识别结果，也不访问模型或浏览器。
 */
const assert = require('node:assert/strict');

function normalizeOcrAnchor(value) {return value.normalize('NFKC').toLocaleUpperCase('en-US').replace(/[^\p{L}\p{N}]/gu,'');}
function countAnchorOccurrences(text, anchor) {if(!anchor)return 0;let count=0;for(let index=text.indexOf(anchor);index>=0;index=text.indexOf(anchor,index+1))count++;return count;}
function validBox(box,width,height) {return box&&['x0','y0','x1','y1'].every(key=>Number.isFinite(box[key]))&&box.x0>=0&&box.y0>=0&&box.x0<box.x1&&box.y0<box.y1&&box.x1<=width&&box.y1<=height;}
function intersects(a,b) {return Math.min(a.x1,b.x1)>Math.max(a.x0,b.x0)&&Math.min(a.y1,b.y1)>Math.max(a.y0,b.y0);}

function validateQualityFixtureExpectations(fixture) {
    assert.ok(Array.isArray(fixture.expectedSource)&&fixture.expectedSource.every(text=>typeof text==='string'&&text.trim()),'Quality scenes declare exact source text, or an empty array for a wordless page');
    assert.ok(fixture.expectedNoText===undefined||typeof fixture.expectedNoText==='boolean','Wordless expectation is explicit');
    assert.ok(Array.isArray(fixture.expectedAnchors)&&fixture.expectedAnchors.every(anchor=>typeof anchor==='string'&&normalizeOcrAnchor(anchor)),'Quality scenes declare normalized OCR anchors');
    assert.equal(new Set(fixture.expectedAnchors.map(normalizeOcrAnchor)).size,fixture.expectedAnchors.length,'Quality anchor keys are distinct after normalization');
    if(fixture.expectedNoText) {
        assert.deepEqual(fixture.expectedSource,[],'Wordless source cannot invent expected dialogue');
        assert.deepEqual(fixture.expectedAnchors,[],'Wordless source cannot invent positive anchors');
        assert.deepEqual(fixture.regions||[],[],'Wordless source cannot declare text regions');
    } else assert.ok(fixture.expectedAnchors.length>0&&fixture.expectedSource.length>0,'Text-bearing scenes declare source and anchors');
    if(fixture.anchorOccurrences) {
        assert.ok(typeof fixture.anchorOccurrences==='object'&&!Array.isArray(fixture.anchorOccurrences)&&Object.keys(fixture.anchorOccurrences).length===fixture.expectedAnchors.length,'Each declared OCR anchor has an explicit occurrence count');
        const source=normalizeOcrAnchor(fixture.expectedSource.join(' '));
        for(const anchor of fixture.expectedAnchors) {
            const count=fixture.anchorOccurrences[anchor];
            assert.ok(Number.isInteger(count)&&count>=1&&count<=50,'Declared anchor occurrence counts are bounded positive integers');
            assert.equal(countAnchorOccurrences(source,normalizeOcrAnchor(anchor)),count,'Occurrence metadata agrees with source text, including overlapping matches');
        }
    }
    const forbidden=fixture.forbiddenRegions||[],ids=new Set();
    assert.ok(Array.isArray(forbidden),'Negative regions form an explicit array');
    for(const region of forbidden) {
        assert.ok(typeof region.id==='string'&&region.id.trim()&&!ids.has(region.id),'Negative region identifiers are unique');ids.add(region.id);
        assert.ok(validBox(region.bbox,fixture.width,fixture.height),'Negative regions remain inside the source image');
        assert.ok(!(fixture.regions||[]).some(text=>intersects(text.bbox,region.bbox)),'A negative region contains no declared source text');
    }
    if(fixture.readingOrder) {
        assert.ok(Array.isArray(fixture.readingOrder)&&fixture.readingOrder.length>=2&&new Set(fixture.readingOrder).size===fixture.readingOrder.length,'A declared paragraph order uses distinct text region IDs');
        assert.ok(fixture.readingOrder.every(id=>(fixture.regions||[]).some(region=>region.id===id&&region.vertical)),'Vertical paragraph order references actual vertical source regions');
    }
}

function evaluateQualityFixture(fixture,{texts,lines}) {
    assert.ok(Array.isArray(texts)&&texts.every(text=>typeof text==='string'),'Actual text transport is an array');
    assert.ok(Array.isArray(lines),'Actual offscreen OCR layout was captured, including empty pages');
    const recognized=normalizeOcrAnchor(texts.join(' '));
    const anchors=fixture.expectedAnchors.map(anchor=>{
        const occurrences=countAnchorOccurrences(recognized,normalizeOcrAnchor(anchor));
        const sourceOccurrences=countAnchorOccurrences(normalizeOcrAnchor(fixture.expectedSource.join(' ')),normalizeOcrAnchor(anchor));
        const expectedOccurrences=fixture.anchorOccurrences?.[anchor]??(sourceOccurrences===1?1:undefined);
        return {anchor,occurrences,expectedOccurrences,found:occurrences>0&&(expectedOccurrences===undefined||occurrences===expectedOccurrences)};
    });
    const qualityFailures=anchors.filter(anchor=>!anchor.found).map(({anchor,occurrences,expectedOccurrences})=>({type:expectedOccurrences!==undefined&&occurrences>expectedOccurrences?'duplicate-anchor':'ocr-anchor',anchor,occurrences,expectedOccurrences,
        reason:occurrences===0?'Actual production OCR does not contain the normalized expected anchor':'Actual production OCR anchor count differs from the source-declared count'}));
    const negativeDetections=[];
    const sourceTexts=[];
    for(const [lineIndex,line] of lines.entries()) {
        assert.ok(typeof line.sourceText==='string','Actual offscreen lines retain their recognized source text, independently of translated output');
        sourceTexts.push(line.sourceText);
        // 实际物理行框优先；段落外接框可能跨过受保护画面，不能据此制造误报。
        const boxes=Array.isArray(line.sourceBoxes)&&line.sourceBoxes.length?line.sourceBoxes:[line.bbox];
        assert.ok(boxes.every(box=>validBox(box,fixture.width,fixture.height)),'Actual OCR source boxes are valid image coordinates');
        for(const region of fixture.forbiddenRegions||[]) {
            const overlaps=boxes.filter(box=>intersects(box,region.bbox));
            if(overlaps.length)negativeDetections.push({regionId:region.id,lineIndex,sourceText:line.sourceText??line.text,sourceBoxes:overlaps});
        }
    }
    for(const detection of negativeDetections)qualityFailures.push({type:'artwork-ocr-false-positive',...detection,reason:'Actual production OCR source box intersects a declared wordless artwork region'});
    // 不依赖送翻译的子集：数字、ID 或无需改写的行仍属于实际 OCR 产物。
    // 库存只额外检查多字，无法证明没有缺字或顺序正确；锚点、阅读顺序与负区域保持独立门禁。
    const inventory=value=>{const counts=new Map();for(const character of normalizeOcrAnchor(value))counts.set(character,(counts.get(character)||0)+1);return counts;};
    const expected=inventory(fixture.expectedSource.join(' ')),actual=inventory(sourceTexts.join(' '));
    const excess=[...actual].filter(([character,count])=>count>(expected.get(character)||0)).map(([character,count])=>({character,expected:expected.get(character)||0,actual:count,excess:count-(expected.get(character)||0)}));
    const sourceCharacterInventory={expected:Object.fromEntries(expected),actual:Object.fromEntries(actual),excess,scope:'Normalized Unicode character counts detect additions; they do not prove complete recognition, text order, or artwork provenance'};
    if(excess.length)qualityFailures.push({type:'unexpected-ocr-characters',excess,reason:'Actual offscreen source text contains more normalized characters than declared source truth'});
    if(fixture.expectedNoText&&(texts.some(text=>text.trim())||lines.length))qualityFailures.push({type:'wordless-page-text',paragraphs:texts.length,lines:lines.length,reason:'The source page contains no text and must not produce translated dialogue'});
    return {anchors,negativeDetections,sourceCharacterInventory,qualityFailures};
}

module.exports={normalizeOcrAnchor,countAnchorOccurrences,validateQualityFixtureExpectations,evaluateQualityFixture};
