"""Render the complete Markdown guide as a searchable, bookmarked PDF.

The guide's tables remain text, code remains monospaced text, and the contents
page is generated from actual pagination. No browser or network is required.
"""
from __future__ import annotations
import hashlib
import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph
from reportlab.platypus import Spacer, Table, TableStyle, Preformatted, KeepTogether, PageBreak, ActionFlowable
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs/v6-user-guide.md'
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'output/ir-workbench-v6-user-guide.pdf'
FONT_ROOT = Path('/usr/share/fonts/truetype/dejavu')
for name, file in [('Body', 'DejaVuSans.ttf'), ('BodyBold', 'DejaVuSans-Bold.ttf'),
                   ('BodyItalic', 'DejaVuSans-Oblique.ttf'), ('Mono', 'DejaVuSansMono.ttf')]:
    path = FONT_ROOT / file
    if path.exists(): pdfmetrics.registerFont(TTFont(name, str(path)))
    else:
        standard = {'Body': 'Helvetica', 'BodyBold': 'Helvetica-Bold',
                    'BodyItalic': 'Helvetica-Oblique', 'Mono': 'Courier'}[name]
        pdfmetrics.registerFont(pdfmetrics.Font(name, standard, 'WinAnsiEncoding'))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBold')

INK = colors.HexColor('#173344')
MUTED = colors.HexColor('#526d7a')
ACCENT = colors.HexColor('#126d73')
RULE = colors.HexColor('#d1dfe4')
PALE = colors.HexColor('#f1f6f7')
PAGE_W, PAGE_H = 595.2756, 841.8898
MARGIN = 50
WIDTH = PAGE_W - MARGIN * 2
STYLES = {
    'body': ParagraphStyle('GuideBody', fontName='Body', fontSize=9.5, leading=14.3, textColor=INK, spaceAfter=7, allowWidows=0, allowOrphans=0),
    'h2': ParagraphStyle('GuideChapter', fontName='BodyBold', fontSize=19, leading=25, textColor=ACCENT, spaceBefore=3, spaceAfter=17, keepWithNext=True),
    'h3': ParagraphStyle('GuideSection', fontName='BodyBold', fontSize=11.4, leading=16, textColor=INK, spaceBefore=15, spaceAfter=9, keepWithNext=True),
    'bullet': ParagraphStyle('GuideBullet', fontName='Body', fontSize=9.5, leading=14.3, textColor=INK, leftIndent=13, firstLineIndent=-11, spaceAfter=5, allowWidows=0, allowOrphans=0),
    'cell': ParagraphStyle('GuideCell', fontName='Body', fontSize=8.2, leading=12.0, textColor=INK, splitLongWords=True, spaceAfter=0),
    'thead': ParagraphStyle('GuideTableHeader', fontName='BodyBold', fontSize=8.2, leading=12.0, textColor=colors.white, spaceAfter=0),
    'code': ParagraphStyle('GuideCode', fontName='Mono', fontSize=7.5, leading=11, textColor=INK, backColor=PALE, borderPadding=9, spaceBefore=5, spaceAfter=12),
    'callout': ParagraphStyle('GuideCallout', fontName='Body', fontSize=9.3, leading=14.2, textColor=INK, backColor=PALE, borderPadding=10, spaceBefore=8, spaceAfter=12),
    'eyebrow': ParagraphStyle('GuideEyebrow', fontName='BodyBold', fontSize=10, leading=15, textColor=ACCENT, spaceAfter=18),
    'cover': ParagraphStyle('GuideCover', fontName='BodyBold', fontSize=35, leading=44, textColor=INK, spaceAfter=25),
    'sub': ParagraphStyle('GuideSubtitle', fontName='Body', fontSize=15, leading=23, textColor=MUTED, spaceAfter=18),
    'caption': ParagraphStyle('GuideCaption', fontName='Body', fontSize=9, leading=14, textColor=MUTED, spaceAfter=10),
}

def inline(text: str, table_cell=False):
    text = text.replace('\\|', '|')
    escaped = html.escape(text)
    # Repository links are readable source references in a portable PDF.
    escaped = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: m[1] if m[2].startswith('#') else m[1] + ' (' + m[2] + ')', escaped)
    size = '7.6' if table_cell else '8.4'
    code=[]
    def capture_code(match):
        code.append('<font name="Mono" size="'+size+'">'+match[1]+'</font>')
        return f'GUIDECODETOKEN{len(code)-1}END'
    escaped = re.sub(r'`([^`]+)`', capture_code, escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', escaped)
    escaped = re.sub(r'\*([^*]+)\*', r'<i>\1</i>', escaped)
    for i,value in enumerate(code):escaped=escaped.replace(f'GUIDECODETOKEN{i}END',value)
    return escaped

def split_row(line: str):
    # GFM escaped union pipes belong inside cells, not at column boundaries.
    return [part.strip().replace('\\|', '|') for part in re.split(r'(?<!\\)\|', line.strip().strip('|'))]

def make_table(rows):
    count = max(map(len, rows))
    ratios = {2:[.32,.68], 3:[.24,.27,.49], 4:[.25,.25,.25,.25]}.get(count,[1/count]*count)
    if rows[0][0] == 'New verification group': ratios = [.30,.10,.60]
    content=[]
    for n,row in enumerate(rows):
        padded=row+['']*(count-len(row))
        content.append([Paragraph(inline(cell,True),STYLES['thead' if n==0 else 'cell']) for cell in padded])
    t=Table(content,colWidths=[WIDTH*x for x in ratios],repeatRows=1,hAlign='LEFT',splitByRow=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),ACCENT),('VALIGN',(0,0),(-1,-1),'TOP'),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),
        ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
        ('LINEBELOW',(0,0),(-1,0),.5,ACCENT),('LINEBELOW',(0,1),(-1,-1),.3,RULE)
    ]))
    _,height=t.wrap(WIDTH,10000)
    return KeepTogether([t]) if height<380 else t

def heading(text, level):
    p=Paragraph(inline(text),STYLES['h2' if level==0 else 'h3'])
    p.guide_level=level
    p.guide_title=re.sub(r'[`*]','',text)
    p.guide_key='section-'+hashlib.sha256(text.encode()).hexdigest()[:16]
    return p

class ChapterMarker(ActionFlowable):
    def __init__(self,title):self.title=title
    def apply(self,doc):doc.chapter=self.title

def body(text):
    lines=text.splitlines()
    first=next(i for i,l in enumerate(lines) if l.startswith('## 1. '))
    lines=lines[first:]
    output=[];i=0;chapters=0
    while i<len(lines):
        line=lines[i].rstrip()
        if not line:i+=1;continue
        if line.startswith('## '):
            output.extend([ChapterMarker(line[3:]),PageBreak()])
            output.append(heading(line[3:],0));chapters+=1;i+=1;continue
        if line.startswith('### '):output.append(heading(line[4:],1));i+=1;continue
        if line.startswith('```'):
            i+=1;code=[]
            while i<len(lines) and not lines[i].startswith('```'):
                code.append(lines[i].expandtabs(2));i+=1
            if any(len(l)>100 for l in code):raise ValueError('Code line exceeds printable width')
            block=Preformatted('\n'.join(code),STYLES['code'])
            if output and getattr(output[-1],'guide_level',None)==1:
                section=output.pop();output.append(KeepTogether([section,block]))
            else:output.append(KeepTogether([block]))
            i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                row=split_row(lines[i])
                if not all(re.fullmatch(r'[:\- ]+',x or '-') for x in row):rows.append(row)
                i+=1
            if rows:
                table=make_table(rows)
                if output and getattr(output[-1],'guide_level',None)==1:
                    section=output.pop()
                    content=table._content if isinstance(table,KeepTogether) else [table]
                    output.append(KeepTogether([section,*content]))
                else:output.append(table)
                output.append(Spacer(1,11))
            continue
        if line=='---':output.append(Spacer(1,8));i+=1;continue
        bullet=re.match(r'^(- |\d+\. )(.*)',line)
        if bullet:
            marker=bullet[1];text=bullet[2];i+=1
            while i<len(lines) and lines[i].startswith('  ') and not lines[i].lstrip().startswith(('-', '```')):
                text+=' '+lines[i].strip();i+=1
            output.append(Paragraph(inline(marker+text),STYLES['bullet']));continue
        if line.startswith('> '):output.append(Paragraph(inline(line[2:]),STYLES['callout']));i+=1;continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|```|\||- |\d+\. |>)',lines[i]):
            paragraph.append(lines[i].strip());i+=1
        output.append(Paragraph(inline(' '.join(paragraph)),STYLES['body']))
    return output

class GuideDocument(BaseDocTemplate):
    def beforeDocument(self):self.chapter='User guide'
    def afterFlowable(self,flowable):
        if not hasattr(flowable,'guide_level'):return
        level=flowable.guide_level;title=flowable.guide_title;key=flowable.guide_key
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(title,key,level,closed=level>0)
        if level==0:
            self.chapter=title
            self.notify('TOCEntry',(0,title,self.page,key))

def page(canvas,doc):
    canvas.saveState()
    if doc.page>1:
        canvas.setStrokeColor(RULE);canvas.setLineWidth(.6)
        canvas.line(MARGIN,PAGE_H-34,PAGE_W-MARGIN,PAGE_H-34)
        canvas.setFillColor(MUTED);canvas.setFont('Body',7)
        canvas.drawString(MARGIN,PAGE_H-25,'IR WORKBENCH / V6')
        title=doc.chapter
        while pdfmetrics.stringWidth(title,'Body',7)>330:title=title[:-2]
        canvas.drawRightString(PAGE_W-MARGIN,PAGE_H-25,title)
    canvas.setStrokeColor(RULE);canvas.line(MARGIN,36,PAGE_W-MARGIN,36)
    canvas.setFillColor(MUTED);canvas.setFont('Body',7.2)
    canvas.drawString(MARGIN,24,'Reusable compiler framework | TypeScript | Release 0.6.0')
    canvas.drawRightString(PAGE_W-MARGIN,24,str(doc.page))
    canvas.restoreState()

toc=TableOfContents()
toc.levelStyles=[ParagraphStyle('GuideTOC',fontName='Body',fontSize=10.4,leading=16.5,textColor=INK,spaceBefore=9,leftIndent=0,firstLineIndent=0,rightIndent=26)]
toc.dotsMinLevel=0
story=[Spacer(1,50),Paragraph('IR WORKBENCH',STYLES['eyebrow']),
       Paragraph("A user's guide<br/>to reusable compilers",STYLES['cover']),
       Paragraph('Programs, strategies, semantic contracts<br/>and inspectable chains of IR',STYLES['sub']),
       Spacer(1,20),Paragraph('ARCHITECTURE · WALKTHROUGHS · API REFERENCE',STYLES['eyebrow']),
       Paragraph('A practical guide to the complete TypeScript framework, from the first compilation to native representation adapters, checked rewrites, optimization choices and explainable cache reuse.',STYLES['body']),
       Spacer(1,34),make_table([['Release','Guide companions'],['0.6.0 · 24 November 2026','Five executable TypeScript tutorials'],['371 automated regressions','Complete workspace and offline workbench']]),
       Spacer(1,23),Paragraph('This edition expands the original implementation report into a complete user manual. Source, tests, examples, generated evidence and the documentation build are included in the workspace.',STYLES['caption']),
       PageBreak(),Paragraph('Contents',STYLES['h2']),
       Paragraph('Read Chapters 1-3 for the conceptual model and worked examples. Chapters 4-7 are the API and execution reference. Chapters 8-11 cover the workbench, extension, troubleshooting and release evidence. PDF bookmarks include the subsections.',STYLES['body']),
       Spacer(1,10),toc,Spacer(1,26),Paragraph('The five tutorials under src/guide/ are complete programs. Chapter fragments are deliberately focused and use the imports and surrounding definitions explained nearby.',STYLES['caption'])]
story.extend(body(SOURCE.read_text()))
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
document=GuideDocument(str(OUTPUT),pagesize=(PAGE_W,PAGE_H),leftMargin=MARGIN,rightMargin=MARGIN,topMargin=51,bottomMargin=50,
                       title="IR Workbench v6: A user's guide to reusable compilers",author='IR Workbench project',pageCompression=1)
document.addPageTemplates([PageTemplate(id='guide',frames=[Frame(MARGIN,50,WIDTH,PAGE_H-101,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=page)])
document.multiBuild(story)
print(OUTPUT)
