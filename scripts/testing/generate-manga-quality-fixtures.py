#!/usr/bin/env python3
"""生成六种安全、文字可核对的漫画/图片翻译夹具；只需现有 Pillow 和显式本机字体。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import unicodedata
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageFont


ENGLISH_FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
JAPANESE_FONT_NAME = "ヒラギノ角ゴシック W4.ttc"


def normalize_anchor(text: str) -> str:
    """与浏览器质量门禁一致：NFKC、大写，只保留 Unicode 字母和数字。"""
    return "".join(char for char in unicodedata.normalize("NFKC", text).upper()
                   if unicodedata.category(char)[0] in {"L", "N"})


def japanese_font() -> Path:
    for path in Path("/System/Library/Fonts").glob("*.ttc"):
        if unicodedata.normalize("NFC", path.name) == JAPANESE_FONT_NAME:
            return path
    raise FileNotFoundError(f"Pass --japanese-font; expected {JAPANESE_FONT_NAME}")


class Page:
    def __init__(self, name: str, size: tuple[int, int], language: str, scene: str, color=(226, 230, 234)):
        self.image = Image.new("RGB", size, color)
        self.draw = ImageDraw.Draw(self.image)
        self.record = {"name": name, "file": f"{name}.png", "mime": "image/png", "width": size[0],
                       "height": size[1], "sourceLanguage": language, "scene": scene, "regions": [],
                       "protectedProbes": [], "tileBoundaryCrossings": []}

    def panel(self, box, fill=(240, 242, 244)):
        self.draw.rectangle(box, fill=fill, outline=(35, 42, 49), width=6)

    def balloon(self, box, dark=False):
        self.draw.ellipse(box, fill=(12, 16, 23) if dark else "white", outline="white" if dark else (35, 42, 49), width=5)

    def robot(self, x, y, scale=1, color=(92, 126, 146)):
        """简单几何机器人，避免使用第三方漫画、人物肖像或成人素材。"""
        d = self.draw
        d.rounded_rectangle((x-48*scale,y-50*scale,x+48*scale,y+24*scale), radius=14*scale, fill=color, outline=(35,42,49), width=4)
        for dx in [-20,20]:
            d.ellipse((x+(dx-5)*scale,y-22*scale,x+(dx+5)*scale,y-12*scale),fill=(15,25,35))
        d.line((x-14*scale,y+3*scale,x+14*scale,y+3*scale),fill=(15,25,35),width=3)
        d.rounded_rectangle((x-40*scale,y+32*scale,x+40*scale,y+100*scale),radius=10*scale,fill=color,outline=(35,42,49),width=4)
        d.line((x-22*scale,y+101*scale,x-30*scale,y+140*scale),fill=(35,42,49),width=8)
        d.line((x+22*scale,y+101*scale,x+30*scale,y+140*scale),fill=(35,42,49),width=8)

    def line(self, text, x, y, font, *, anchor=None, translation="", fill=(15,20,25), stroke=0):
        """x/y 是实际字形外框左上角，manifest 不依赖字体的 ascent 偏移。"""
        raw = self.draw.textbbox((0,0),text,font=font,stroke_width=stroke)
        position=(x-raw[0],y-raw[1])
        self.draw.text(position,text,font=font,fill=fill,stroke_width=stroke,stroke_fill="white" if stroke else fill)
        bbox=self.draw.textbbox(position,text,font=font,stroke_width=stroke)
        self.record["regions"].append({"id":f"line-{len(self.record['regions'])+1}","text":text,
            "anchor":anchor or text,"translation":translation,"bbox":{"x0":bbox[0],"y0":bbox[1],"x1":bbox[2],"y1":bbox[3]},"vertical":False})
        return bbox

    def vertical(self, text, x, y, font, *, translation="", advance=54):
        boxes=[]
        for index, char in enumerate(text):
            raw=self.draw.textbbox((0,0),char,font=font)
            position=(x-raw[0],y+index*advance-raw[1])
            self.draw.text(position,char,font=font,fill=(15,20,25))
            boxes.append(self.draw.textbbox(position,char,font=font))
        box={"x0":min(b[0] for b in boxes),"y0":min(b[1] for b in boxes),"x1":max(b[2] for b in boxes),"y1":max(b[3] for b in boxes)}
        self.record["regions"].append({"id":f"line-{len(self.record['regions'])+1}","text":text,
            "anchor":text,"translation":translation,"bbox":box,"vertical":True,"characterAdvance":advance})

    def protect(self, x, y):
        self.record["protectedProbes"].append({"x":x,"y":y,"rgb":list(self.image.getpixel((x,y)))})


def generate(output: Path, english: Path, japanese: Path) -> dict:
    output.mkdir(parents=True,exist_ok=True)
    en=lambda size:ImageFont.truetype(str(english),size=size)
    ja=lambda size:ImageFont.truetype(str(japanese),size=size)
    pages=[]

    p=Page("english-bubbles-caption",(1000,1400),"en","three separated speech balloons and one outside single-line caption")
    p.panel((24,24,976,680));p.panel((24,710,976,1376))
    p.balloon((55,130,485,420));p.balloon((530,150,945,445));p.balloon((200,785,805,1090))
    p.line("Morning at the quiet station.",62,65,en(32),anchor="quiet station",translation="安静车站的早晨。")
    p.line("THE TRAIN",145,215,en(38),translation="这班火车")
    p.line("LEAVES AT NINE",105,280,en(36),anchor="LEAVES AT NINE",translation="九点出发。")
    p.line("I WILL BRING",590,235,en(36),translation="我会带上")
    p.line("THE RED MAP",595,295,en(36),translation="那张红色地图。")
    p.line("WE CAN READ",360,875,en(40),translation="我们可以")
    p.line("ON THE WAY",375,940,en(40),translation="在路上读书。")
    p.robot(220,520,0.8);p.robot(760,1180,0.8);p.protect(220,500);pages.append(p)

    p=Page("japanese-vertical-columns",(1000,1400),"ja","Japanese vertical dialogue; right column precedes left column")
    p.panel((24,24,976,1376));p.balloon((180,90,820,780))
    p.vertical("明日は図書館へ",590,190,ja(44),translation="明天去图书馆。")
    p.vertical("一緒に行こう",410,190,ja(44),translation="一起去吧。")
    p.record["readingOrder"]=["line-1","line-2"]
    p.record["regions"][0]["anchor"]="図書館";p.record["regions"][1]["anchor"]="一緒"
    p.robot(500,1050,1.2);p.protect(500,1020);pages.append(p)

    p=Page("japanese-horizontal-mixed",(1000,1300),"ja","horizontal Japanese dialogue and Japanese/Latin mixed lettering")
    p.panel((24,24,976,1276));p.balloon((60,115,940,440));p.balloon((80,610,920,990))
    p.line("BOOK CLUB 2026",275,52,en(38),anchor="BOOK CLUB",translation="2026读书会")
    p.line("今日は図書館へ行こう。",180,215,ja(44),anchor="図書館",translation="今天去图书馆吧。")
    p.line("新しい本を見つけたよ。",180,285,ja(44),anchor="新しい本",translation="我找到了一本新书。")
    p.line("読書メモ NOTE 07",250,700,ja(44),anchor="NOTE 07",translation="读书笔记07")
    p.line("また明日ここで会おう。",180,780,ja(44),anchor="また明日",translation="明天再在这里见。")
    p.robot(500,1090,0.75);p.protect(500,1065);pages.append(p)

    p=Page("long-strip-tile-boundary",(960,3600),"en","long webtoon with uncropped caption crossing the original 1536px detector edge",color=(214,220,226))
    for top,bottom in [(24,1100),(1120,2350),(2370,3576)]:p.panel((24,top,936,bottom),fill=(225,229,233))
    p.line("A LONG QUIET JOURNEY",135,100,en(45),anchor="QUIET JOURNEY",translation="漫长而安静的旅程。")
    p.line("Every small word matters.",160,770,en(38),anchor="small word matters",translation="每一个小词都很重要。")
    boundary=p.line("BOUNDARY TEXT STAYS COMPLETE",85,1515,en(37),anchor="BOUNDARY TEXT STAYS COMPLETE",translation="边界处的文字保持完整。")
    p.record["tileBoundaryCrossings"].append({"axis":"y","position":1536,"regionId":"line-3"})
    assert boundary[1]<1536<boundary[3],"The boundary fixture must actually cross y=1536"
    p.line("Read beyond the next panel.",130,2200,en(38),anchor="next panel",translation="继续读到下一格。")
    p.line("THE LAST LINE IS STILL HERE",105,3210,en(37),anchor="LAST LINE IS STILL HERE",translation="最后一行仍在这里。")
    p.robot(480,400,1.2);p.robot(480,1850,1.2);p.robot(480,2780,1.2);p.protect(480,1800);pages.append(p)

    p=Page("dark-reverse-dialogue",(1000,1200),"en","white dialogue on black balloons without light connected-component crops",color=(24,31,45))
    p.panel((24,24,976,1176),fill=(34,43,61));p.balloon((80,95,920,490),dark=True);p.balloon((90,630,910,1050),dark=True)
    p.line("TURN ON",365,210,en(44),fill="white",translation="打开")
    p.line("THE SMALL LAMP",260,285,en(44),anchor="SMALL LAMP",fill="white",translation="那盏小灯。")
    p.line("WE CAN SEE",315,750,en(44),fill="white",translation="我们能看见")
    p.line("THE STARS TONIGHT",230,830,en(44),anchor="STARS TONIGHT",fill="white",translation="今晚的星星。")
    p.draw.ellipse((475,535,525,585),fill=(254,222,100));p.protect(500,560);pages.append(p)

    p=Page("textured-title-repair",(1000,1400),"en","title and dialogue on nonuniform hatching; protected probes lie outside source text masks",color=(225,217,198))
    p.panel((24,24,976,1376),fill=(224,218,202))
    for offset in range(-1400,1000,24):
        p.draw.line((offset,24,offset+1352,1376),fill=(160,164,152),width=2)
    for y in range(40,1376,30):p.draw.line((24,y,976,y),fill=(194,190,173),width=1)
    p.line("READING",215,120,en(86),anchor="READING",translation="阅读",stroke=3)
    p.line("ADVENTURE",145,235,en(86),anchor="ADVENTURE",translation="探险",stroke=3)
    p.line("The path continues",200,625,en(46),anchor="path continues",translation="道路仍在延伸，",stroke=3)
    p.line("beyond the old bridge.",140,705,en(46),anchor="old bridge",translation="通向古桥的另一端。",stroke=3)
    p.draw.rounded_rectangle((740,1080,880,1220),radius=12,fill=(88,119,156),outline=(35,42,49),width=5)
    p.protect(810,1150);p.protect(500,500);pages.append(p)

    records=[]
    for p in pages:
        for region in p.record["regions"]:
            b=region["bbox"]
            assert 0<=b["x0"]<b["x1"]<=p.image.width and 0<=b["y0"]<b["y1"]<=p.image.height,(p.record["name"],region)
        path=output/p.record["file"];p.image.save(path,format="PNG",optimize=False)
        p.record["sha256"]=hashlib.sha256(path.read_bytes()).hexdigest()
        p.record["bytes"]=path.stat().st_size
        p.record["expectedSource"]=[r["text"] for r in p.record["regions"]]
        p.record["expectedAnchors"]=[r["anchor"] for r in p.record["regions"]]
        source=normalize_anchor(" ".join(p.record["expectedSource"]))
        anchors=p.record["expectedAnchors"]
        normalized=[normalize_anchor(anchor) for anchor in anchors]
        assert all(normalized) and len(set(normalized))==len(normalized),(p.record["name"],"anchors must be distinct and nonempty")
        occurrences={anchor:sum(source.startswith(needle,index) for index in range(len(source)))
                     for anchor,needle in zip(anchors,normalized)}
        assert all(count==1 for count in occurrences.values()),(p.record["name"],occurrences)
        # 保留字符串数组以兼容已有读取器；次数约束可发现瓦片重叠造成的重复文字。
        p.record["anchorOccurrences"]=occurrences
        records.append(p.record)

    fonts=[{"purpose":purpose,"path":str(path),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()} for purpose,path in [("English",english),("Japanese",japanese)]]
    manifest={"version":1,"generator":"scripts/testing/generate-manga-quality-fixtures.py","seed":1068,"pillowVersion":PIL.__version__,
              "anchorNormalization":{"unicode":"NFKC","case":"upper","keepCategories":["Letter","Number"],"countOverlaps":True},
              "fonts":fonts,"notes":["All panels, geometry and words are original deterministic test material.",
              "Expected source and translations are ground truth; anchors are checks, not fabricated OCR output.",
              "Use actual extension OCR to measure recognition separately from controlled OCR geometry/rendering tests.",
              "PNG bytes are reproducible with the recorded Pillow version and identical font files."],"fixtures":records}
    (output/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")

    # 预览不参与 OCR，标签与缩略图不会污染每张原始输入。
    sheet=Image.new("RGB",(1200,1050),"white");draw=ImageDraw.Draw(sheet)
    for i,p in enumerate(pages):
        thumb=p.image.copy();thumb.thumbnail((360,440))
        x=20+(i%3)*400;y=35+(i//3)*520
        draw.text((x,y-24),p.record["name"],font=en(17),fill="black")
        sheet.paste(thumb,(x+(360-thumb.width)//2,y))
    sheet.save(output/"contact-sheet.png",format="PNG",optimize=False)
    cards="\n".join(f'<article><h2>{html.escape(r["name"])}</h2><p>{html.escape(r["scene"])}</p><img src="{r["file"]}" alt="{html.escape(r["name"])}"></article>' for r in records)
    (output/"gallery.html").write_text('<!doctype html><meta charset="utf-8"><title>FluentRead #1068 corpus</title><style>body{font:16px system-ui;background:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}article{background:white;padding:16px}h2{font-size:18px}img{width:100%;height:auto}</style><h1>FluentRead #1068 deterministic manga corpus</h1><p>Six independent OCR inputs. Ground truth: manifest.json.</p><main>'+cards+'</main>')
    return manifest


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir",type=Path,required=True)
    parser.add_argument("--english-font",type=Path,default=ENGLISH_FONT)
    parser.add_argument("--japanese-font",type=Path)
    args=parser.parse_args()
    result=generate(args.output_dir,args.english_font,args.japanese_font or japanese_font())
    print(json.dumps({"fixtures":len(result["fixtures"]),"outputDir":str(args.output_dir.resolve())},ensure_ascii=False))
