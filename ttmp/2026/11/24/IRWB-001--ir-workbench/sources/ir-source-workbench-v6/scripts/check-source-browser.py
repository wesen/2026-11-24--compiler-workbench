"""Optional browser integration checks; requires local Playwright + Chromium.
Loads exact standalone HTML via set_content (works in managed environments that block file navigation).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import yaml
import os
root=Path(__file__).resolve().parent.parent
html=(root/'output/source-workbench.html').read_text()
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'],headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
    errors=[];remote=[];console_errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda req:remote.append(req.url) if req.url.startswith(('http://','https://')) else None)
    page.on('console',lambda msg:console_errors.append(msg.text) if msg.type=='error' else None)
    page.set_content(html,wait_until='load',timeout=60000)
    editor=page.get_by_label('Editable TypeScript program')
    compile_btn=page.get_by_role('button',name='Compile source',exact=True)
    def wait():
        page.wait_for_function("!document.querySelector('.compile-button').disabled",timeout=30000)
    def compile_code(code=None):
        if code is not None:editor.fill(code)
        compile_btn.click();wait()
    def text():return page.locator('.source-run-status').inner_text()
    def counts():return page.locator('.source-result-meta').inner_text()
    def check(name,condition):
        assert condition, f'{name}: {text()} | {counts()}'
        results.append(name); print(name,flush=True)
    wait();original=editor.input_value();check('Initial program is actual building.ts',original==(root/'src/programs/building.ts').read_text());check('Cold build succeeded', 'Compiled building.ts' in text() and '59 executed' in counts());check('Real rendered model',page.locator('.mesh-canvas').count()==1)
    check('Editor has syntax highlighting',page.locator('.source-editor-color .tok-keyword').count()>0 and page.locator('.source-editor-color .tok-string').count()>0)
    check('Highlighted source is lossless',page.locator('.source-editor-color').text_content()==original+'\n')
    check('Single inspector with all 59 compact pass rows',page.locator('.embedded-inspector .invocation').count()==59 and page.locator('.inspector').count()==1)
    check('Pass details below dependency route',page.locator('.inspector').bounding_box()['y']>page.locator('.ir-chain').bounding_box()['y'])
    check('Side-by-side list and pass details',page.locator('.sidebar').bounding_box()['x']<page.locator('.inspector').bounding_box()['x'])
    check('Compact invocation rows',page.locator('.invocation').first.bounding_box()['height']<=32)
    check('Overview has recorded cache explanation',page.locator('.pass-reason').count()==1)
    page.screenshot(path=root/'output/browser-source-first.png',full_page=True)
    page.get_by_role('button',name='Focus passes',exact=True).click();check('Focus passes hides source but preserves IR route',not page.locator('.source-workspace').is_visible() and page.locator('.ir-chain').is_visible())
    check('Focus workspace fits viewport',page.locator('.embedded-inspector .workspace').bounding_box()['y']+page.locator('.embedded-inspector .workspace').bounding_box()['height']<=1000)
    page.screenshot(path=root/'output/browser-focus-passes.png')
    first=page.locator('.invocation').first;task=first.get_attribute('data-task');first.click();check('Clicking pass updates right-hand details',page.locator('.selected-title').inner_text()==task.replace('programs/building/',''))
    check('Selected pass is included in actual IR route',page.locator('.chain-node.active').count()==1 and page.locator('.chain-node.active').get_attribute('title')==task)
    page.get_by_role('button',name='Final artifact',exact=True).click();page.get_by_role('button',name='Show source & model',exact=True).click()
    compile_code();check('Warm rebuild all 59 cached','0 executed' in counts() and '59 reused' in counts())
    compile_code(original.replace('floors = 2','floors = 3'));check('Structural source edit compiled','Compiled building.ts' in text());page.get_by_role('tab',name='IR data',exact=True).click();data=yaml.safe_load(page.locator('.inspector-content pre.yaml').first.text_content());check('Three floors produce 103 occurrences',len(data['occurrences'])==103)
    compile_code(original.replace("'triangles', 0.006","'quality', 0.006"));page.get_by_role('tab',name='IR data',exact=True).click();data=yaml.safe_load(page.locator('.inspector-content pre.yaml').first.text_content());check('Policy edit chooses actual high-quality mesh',data['selectedLOD']=='divisor-1')
    page.get_by_role('tab',name='Pass code',exact=True).click();check('Pass source is actual generic scene compiler',page.get_by_label('Source file',exact=True).input_value()=='src/pipelines/scene.ts');check('Pass code range visible',page.locator('.code-pass-range').count()>1)
    page.get_by_role('button',name='Compiler runtime',exact=True).click();check('Compiler runtime source accessible',page.get_by_label('Source file',exact=True).input_value()=='src/core/runtime.ts');page.screenshot(path=root/'output/browser-compiler-source.png',full_page=True)
    page.get_by_role('tab',name='Executed source',exact=True).click();check('Executed source matches edited code',"'quality', 0.006" in page.locator('.source-source-snapshot').inner_text())
    page.get_by_role('tab',name='IR data',exact=True).click();check('YAML uses highlighted keys',page.locator('.inspector-content pre.yaml .tok-key').count()>0)
    with page.expect_download() as event:page.get_by_role('button',name='Download IR YAML',exact=True).click()
    yaml_value=yaml.safe_load(Path(event.value.path()).read_text())
    with page.expect_download() as event:page.get_by_role('button',name='Export trace',exact=True).click()
    trace=json.loads(Path(event.value.path()).read_text());run=trace['runs'][-1];ref=run['roots'][-1];expected=next(a['value'] for a in trace['artifacts'] if a['id']==ref['artifact'] and a['revision']==ref['revision']);check('Downloaded YAML round-trips to exact committed artifact',yaml_value==expected)
    page.get_by_role('tab',name='Pass code',exact=True).click();check('Compiler code has syntax highlighting',page.locator('.code-text .tok-keyword').count()>0)
    page.get_by_label('Find in source file').fill('register');check('Code search retains highlighted tokens',page.locator('.code-text .tok-keyword').count()>0 and page.locator('.code-text mark').count()>0)
    page.get_by_role('tab',name='Query',exact=True).click();check('Query results use YAML',page.locator('.query-output pre.yaml').count()==1)
    page.get_by_role('tab',name='Why / cache',exact=True).click();check('Cache reasoning stays in same inspector',page.locator('.cache-explanation').count()==1)
    page.get_by_role('tab',name='Graphs',exact=True).click();check('Graphs accessible in same inspector',page.locator('.graph-svg').count()==1)
    page.get_by_role('tab',name='Compare',exact=True).click();check('Comparisons accessible in same inspector',page.get_by_label('Comparison run').count()==1)
    compile_code('export default (');check('Invalid source diagnostics shown','Source error:' in text() and 'TS' in text());check('Invalid source not presented as compiled geometry',page.locator('.mesh-canvas').count()==0)
    compile_code(original);check('Source recovery succeeds','Compiled building.ts' in text());
    for label,filename in [('Pavilion','pavilion.ts'),('CAD bracket','bracket.ts'),('Four-bar linkage','linkage.ts'),('Mechanical door','door.ts')]:
        page.get_by_role('button',name=label,exact=True).click();wait();check(f'{label} source and compile',editor.input_value()==(root/'src/programs'/filename).read_text() and 'Compiled '+filename in text())
    check('Door has motion playback',page.get_by_role('button',name='Play assembly').count()==1);page.get_by_label('Assembly motion sample').fill('10');check('Motion frame updates','Frame 11/65' in page.locator('.source-preview .view-status').last.inner_text());page.screenshot(path=root/'output/browser-door.png',full_page=True)
    with page.expect_download() as event:page.get_by_role('button',name='Download .ts',exact=True).click()
    check('Downloaded actual edited program',Path(event.value.path()).read_text()==editor.input_value())
    with page.expect_download() as event:page.get_by_role('button',name='Save source set',exact=True).click()
    check('Source set contains all five modules',len(json.loads(Path(event.value.path()).read_text()))==5)
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path=root/'output/browser-mobile.png',full_page=True)
    check('Responsive mobile layout',page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+2'))
    check('No external network requests',not remote);check('No unhandled page or console errors',not errors and not console_errors)
    browser.close()
(root/'output/browser-results.json').write_text(json.dumps({'passed':len(results),'checks':results},indent=2)+'\n')
print(f'{len(results)} browser checks passed')
