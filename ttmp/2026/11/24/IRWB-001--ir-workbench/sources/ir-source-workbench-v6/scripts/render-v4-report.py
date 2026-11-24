"""Render the release's Markdown report to a searchable, paginated PDF.

This is documentation tooling only. The TypeScript build and workbench do not
depend on Python. Usage: python scripts/render-v4-report.py [markdown] [pdf].
"""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    Preformatted, KeepTogether, PageBreak,
)

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs/v4-report.md'
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'output/ir-source-workbench-v4-report.pdf'

FONT_ROOT = Path('/usr/share/fonts/truetype/dejavu')
for name, filename in [('Body', 'DejaVuSans.ttf'), ('BodyBold', 'DejaVuSans-Bold.ttf'),
                       ('BodyItalic', 'DejaVuSans-Oblique.ttf'), ('Mono', 'DejaVuSansMono.ttf')]:
    path = FONT_ROOT / filename
    if path.exists(): pdfmetrics.registerFont(TTFont(name, str(path)))
if 'Body' in pdfmetrics.getRegisteredFontNames():
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBold')
else:
    # Helvetica/Courier are PDF standard fonts on systems without DejaVu.
    for name, standard in [('Body','Helvetica'), ('BodyBold','Helvetica-Bold'), ('BodyItalic','Helvetica-Oblique'), ('Mono','Courier')]:
        pdfmetrics.registerFont(pdfmetrics.Font(name, standard, 'WinAnsiEncoding'))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBold')

INK = colors.HexColor('#162c3b')
MUTED = colors.HexColor('#536776')
ACCENT = colors.HexColor('#126c78')
RULE = colors.HexColor('#d9e3e8')
PALE = colors.HexColor('#f3f6f8')
PAGE_W, PAGE_H = 595.2756, 841.8898
MARGIN = 49
WIDTH = PAGE_W - 2 * MARGIN
STYLES = {
    'body': ParagraphStyle('BodyTextCustom', fontName='Body', fontSize=9.4, leading=14.0, textColor=INK, spaceAfter=6.0),
    'h1': ParagraphStyle('ReportTitle', fontName='BodyBold', fontSize=24, leading=29, textColor=INK, spaceBefore=14, spaceAfter=17, keepWithNext=True),
    'h2': ParagraphStyle('SectionTitle', fontName='BodyBold', fontSize=15, leading=20, textColor=ACCENT, spaceBefore=16, spaceAfter=9, keepWithNext=True),
    'h3': ParagraphStyle('SubsectionTitle', fontName='BodyBold', fontSize=11.1, leading=15.5, textColor=INK, spaceBefore=11, spaceAfter=6, keepWithNext=True),
    'bullet': ParagraphStyle('ListText', fontName='Body', fontSize=9.4, leading=14, textColor=INK, leftIndent=12, firstLineIndent=-10, spaceAfter=5),
    'cell': ParagraphStyle('CellText', fontName='Body', fontSize=8.0, leading=11.5, textColor=INK, spaceAfter=0, splitLongWords=True),
    'thead': ParagraphStyle('TableHead', fontName='BodyBold', fontSize=8, leading=11.5, textColor=colors.white),
    'code': ParagraphStyle('CodeText', fontName='Mono', fontSize=7.3, leading=10.2, textColor=INK, backColor=PALE, borderPadding=8, spaceBefore=4, spaceAfter=10),
    'caption': ParagraphStyle('CaptionText', fontName='BodyItalic', fontSize=8, leading=11.5, textColor=MUTED, spaceAfter=9),
}

def inline(text: str) -> str:
    """Escape all markup; recognize the small Markdown inline vocabulary used here."""
    escaped = html.escape(text)
    escaped = re.sub(r'`([^`]+)`', lambda m: '<font name="Mono" size="8.1">'+m[1]+'</font>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', escaped)
    escaped = re.sub(r'\*([^*]+)\*', r'<i>\1</i>', escaped)
    escaped = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1', escaped)
    return escaped

def table(rows: list[list[str]]) -> Table:
    count = max(map(len, rows))
    ratios = {2:[.29,.71],3:[.22,.37,.41],4:[.27,.19,.19,.35],5:[.30,.175,.175,.175,.175]}.get(count,[1/count]*count)
    widths = [WIDTH * x for x in ratios]
    content=[]
    for idx,row in enumerate(rows):
        padded=row+['']*(count-len(row))
        content.append([Paragraph(inline(x), STYLES['thead' if idx==0 else 'cell']) for x in padded])
    result=Table(content,colWidths=widths,repeatRows=1,hAlign='LEFT')
    result.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),ACCENT), ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),
        ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('LINEBELOW',(0,0),(-1,0),.5,ACCENT),('LINEBELOW',(0,1),(-1,-1),.3,RULE),
    ]))
    return result

def render(text: str):
    lines=text.splitlines(); story=[]; idx=0
    while idx<len(lines):
        line=lines[idx].rstrip()
        if not line: idx+=1; continue
        if line.startswith('```'):
            idx+=1; code=[]
            while idx<len(lines) and not lines[idx].startswith('```'):
                raw=lines[idx].expandtabs(2)
                # Prefer explicit line breaks in source; wrap unusually long literal lines.
                while len(raw)>98:
                    split=raw.rfind(' ',0,98)
                    if split<30:split=98
                    code.append(raw[:split]);raw='  '+raw[split:].lstrip()
                code.append(raw);idx+=1
            story.append(Preformatted('\n'.join(code),STYLES['code']))
            idx+=1;continue
        if line.startswith('|'):
            rows=[]
            while idx<len(lines) and lines[idx].strip().startswith('|'):
                parts=[p.strip() for p in lines[idx].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[:\- ]+',p or '-') for p in parts):rows.append(parts)
                idx+=1
            if rows:story.extend([table(rows),Spacer(1,10)])
            continue
        heading=re.match(r'^(#{1,3}) (.*)$',line)
        if heading:
            story.append(Paragraph(inline(heading[2]),STYLES['h'+str(len(heading[1]))]));idx+=1;continue
        if line=='---':story.append(Spacer(1,9));idx+=1;continue
        bullet=re.match(r'^(?:- |\d+\. )(.*)$',line)
        if bullet:
            content=bullet[1];idx+=1
            while idx<len(lines) and lines[idx].startswith('  ') and not lines[idx].lstrip().startswith(('-', '```')):
                content+=' '+lines[idx].strip();idx+=1
            marker='- ' if line.startswith('- ') else re.match(r'^\d+\.',line)[0]+' '
            story.append(Paragraph(inline(marker+content),STYLES['bullet']));continue
        paragraph=[line];idx+=1
        while idx<len(lines) and lines[idx].strip() and not re.match(r'^(#|```|\||- |\d+\. )',lines[idx]):
            paragraph.append(lines[idx].strip());idx+=1
        story.append(Paragraph(inline(' '.join(paragraph)),STYLES['body']))
    return story

def page(canvas,doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE);canvas.setLineWidth(.6)
    canvas.line(MARGIN,PAGE_H-35,PAGE_W-MARGIN,PAGE_H-35)
    canvas.setFillColor(MUTED);canvas.setFont('Body',7.3)
    canvas.drawString(MARGIN,PAGE_H-26,'IR WORKBENCH / V4')
    canvas.drawRightString(PAGE_W-MARGIN,PAGE_H-26,'Strategy IR - implementation report')
    canvas.line(MARGIN,36,PAGE_W-MARGIN,36)
    canvas.drawString(MARGIN,24,'Self-contained TypeScript compiler framework')
    canvas.drawRightString(PAGE_W-MARGIN,24,str(doc.page))
    canvas.restoreState()

OUTPUT.parent.mkdir(parents=True,exist_ok=True)
doc=BaseDocTemplate(str(OUTPUT),pagesize=(PAGE_W,PAGE_H),leftMargin=MARGIN,rightMargin=MARGIN,topMargin=49,bottomMargin=50,
                    title='IR Workbench v4 - Strategy IR implementation report',author='IR Workbench project',pageCompression=1)
doc.addPageTemplates([PageTemplate(id='report',frames=[Frame(MARGIN,50,WIDTH,PAGE_H-99,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=page)])
doc.build(render(SOURCE.read_text()))
print(OUTPUT)
