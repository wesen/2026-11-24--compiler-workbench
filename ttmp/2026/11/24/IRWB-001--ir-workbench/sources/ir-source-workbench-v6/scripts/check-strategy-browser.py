"""Real-browser v4 acceptance suite (optional local Playwright + Chromium).

Run after npm run build:source. This suite is separate from the automated Node
component tests: it checks rendering/layout, real Web Workers, downloads and
offline behavior. A blocked browser launch is reported as blocked, never passed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from copy import deepcopy
import json
import os
import yaml

root = Path(__file__).resolve().parent.parent
results = []
output = root / 'output/browser-v4-results.json'


def nodes(plan):
    def visit(node):
        yield node
        kind = node['kind']
        children = (node['steps'] if kind in ('sequence', 'parallel') else
                    [b['strategy'] for b in node['branches']] if kind == 'fork' else
                    [node['candidates']] if kind == 'chooseBest' else
                    [node['then'], node['else']] if kind == 'conditional' else
                    [node['body']] if kind in ('repeatUntilStable', 'forEach', 'scope') else
                    [node['body'], node['fallback']] if kind == 'attempt' else [])
        for child in children:
            yield from visit(child)
    return list(visit(plan['root']))


try:
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                                         args=['--no-sandbox'], headless=True)
        except Exception as error:
            output.write_text(json.dumps({'status': 'blocked', 'passed': 0,
                                          'reason': str(error), 'checks': []}, indent=2) + '\n')
            raise
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        errors, requests, console_errors = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http://', 'https://')) else None)
        page.set_content((root / 'output/source-workbench.html').read_text(), wait_until='load', timeout=60000)

        def ready():
            page.wait_for_function("!document.querySelector('.compile-button').disabled", timeout=60000)

        def status():
            return page.locator('.source-run-status').inner_text()

        def check(label, condition):
            assert condition, f'{label}: {status()}'
            results.append(label)
            print(label, flush=True)

        def button(label):
            return page.get_by_role('button', name=label, exact=True)

        def tab(label):
            return page.get_by_role('tab', name=label, exact=True)

        def download(label):
            with page.expect_download() as event:
                button(label).click()
            return Path(event.value.path()).read_text()

        def trace():
            return json.loads(download('Export trace'))

        def edit_plan(plan):
            button('Edit strategy').click()
            page.get_by_label('Editable strategy YAML').fill(yaml.safe_dump(plan, sort_keys=False, width=100000))

        ready()
        source = page.get_by_label('Editable TypeScript program')
        original = source.input_value()
        check('v4 title and actual authored source', 'v4' in page.title() and original == (root/'src/programs/building.ts').read_text())
        check('Initial strategy compilation succeeded', 'Compiled building.ts' in status())
        check('Real geometry preview exists', page.locator('.mesh-canvas').count() == 1)
        check('TypeScript highlighting is lossless', page.locator('.source-editor-color').text_content() == original + '\n')
        baseline = trace()
        execution = baseline['runs'][-1]['extensions']['strategy.execution']
        original_plan = execution['plan']
        check('Exact plan and dynamic execution export together', execution['status'] == 'succeeded' and len(execution['records']) > len(nodes(original_plan)))
        check('Every planned node is visible', page.locator('.strategy-node').count() == len(nodes(original_plan)))
        check('Compact plan nodes', page.locator('.strategy-node').first.bounding_box()['height'] <= 36)
        check('Plan sidebar and step detail share a row', page.locator('.strategy-sidebar').bounding_box()['x'] < page.locator('.strategy-detail').bounding_box()['x'])
        check('Unchosen branches are explicit', page.locator('.strategy-node[data-status="skipped"]').count() > 0)
        for node in nodes(original_plan):
            page.locator(f'.strategy-node[data-node-id="{node["id"]}"]').click()
        check('Every nested node can be inspected without a browser error', not errors)
        page.locator('.strategy-node[data-node-id="scene/choose"]').click()
        check('Choice node shows recorded selection evidence', 'selection' in page.locator('.strategy-detail-content').inner_text().lower() or 'candidate' in page.locator('.strategy-detail-content').inner_text().lower())
        page.locator('.strategy-node[data-node-id="scene/tessellate"]').click()
        tab('Executions').click()
        check('A forEach body shows separate dynamic executions', page.locator('.strategy-execution').count() == 8)
        tab('Implementation').click()
        check('Actual strategy generator source is available', page.get_by_label('Source file', exact=True).input_value() == 'src/pipelines/strategy.ts')
        button('Interpreter').click()
        check('Actual interpreter source is available', page.get_by_label('Source file', exact=True).input_value() == 'src/strategy/interpreter.ts')
        check('Implementation syntax highlighting is active', page.locator('.code-text .tok-keyword').count() > 0)
        tab('Plan YAML').click()
        check('Plan view is highlighted YAML', page.locator('.strategy-detail-content pre.yaml .tok-key').count() > 0)
        check('Downloaded plan is exact executable IR', yaml.safe_load(download('Download plan YAML')) == original_plan)
        button('Focus passes').click()
        check('Focused strategy view hides source and model', not page.locator('.source-workspace').is_visible())
        bounds = page.locator('.strategy-workspace').bounding_box()
        check('Focused strategy view fits the desktop viewport', bounds['y'] + bounds['height'] <= 1001)
        page.screenshot(path=root/'output/browser-v4-strategy.png')
        button('Show source & model').click()

        button('Compile source').click()
        ready()
        check('Unchanged compilation reuses compiler cache', '0 executed' in page.locator('.source-result-meta').inner_text())
        edited = deepcopy(original_plan)
        next(n for n in nodes(edited) if n['id'] == 'scene/choose')['objective']['metric'] = 'surfaceErrorBound'
        edit_plan(edited)
        plan_editor = page.get_by_label('Editable strategy YAML')
        check('YAML editor highlighting is lossless', page.locator('.strategy-editor-color').text_content() == plan_editor.input_value() + '\n')
        button('Validate draft').click()
        check('Edited optimization plan validates', 'Valid plan:' in page.locator('.strategy-message').inner_text())
        button('Compile this draft').click()
        ready()
        edited_trace = trace()
        edited_run = edited_trace['runs'][-1]
        check('The executed plan retains the edited objective', next(n for n in nodes(edited_run['extensions']['strategy.execution']['plan']) if n['id'] == 'scene/choose')['objective']['metric'] == 'surfaceErrorBound')
        button('Compiler passes').click()
        tab('IR data').click()
        data = yaml.safe_load(page.locator('.inspector-content pre.yaml').first.text_content())
        check('Edited strategy changes the actual selected mesh', data['selectedLOD'] == 'divisor-1')
        check('Pass sidebar remains compact', page.locator('.invocation').first.bounding_box()['height'] <= 34)
        check('Pass details remain below the IR route', page.locator('.inspector').bounding_box()['y'] > page.locator('.ir-chain').bounding_box()['y'])
        tab('Pass code').click()
        check('Selected pass opens its actual implementation', page.get_by_label('Source file', exact=True).input_value() == 'src/pipelines/scene.ts')
        button('Strategy interpreter').click()
        check('Pass source browser also links the strategy interpreter', page.get_by_label('Source file', exact=True).input_value() == 'src/strategy/interpreter.ts')
        button('Strategy plan').click()
        button('Edit strategy').click()
        plan_editor = page.get_by_label('Editable strategy YAML')
        before_runs = len(edited_trace['runs'])
        plan_editor.fill('id: duplicate\nid: duplicate\n')
        button('Compile this draft').click()
        check('Invalid YAML is rejected without executing', 'Duplicate mapping key' in page.locator('.strategy-message').inner_text() and len(trace()['runs']) == before_runs)
        invalid = deepcopy(original_plan)
        next(n for n in nodes(invalid) if n['kind'] == 'apply')['algorithm']['version'] = '999'
        plan_editor.fill(yaml.safe_dump(invalid, sort_keys=False, width=100000))
        button('Validate draft').click()
        check('Unknown algorithm versions are diagnosed', 'registered' in page.locator('.strategy-message').inner_text() or 'version' in page.locator('.strategy-message').inner_text())
        button('Regenerate default plan').click()
        ready()
        button('Compile strategy').click()
        ready()
        check('Default strategy can be restored and compiled', 'Compiled building.ts' in status())
        imported = deepcopy(original_plan)
        imported['description'] = 'Round-trip imported plan'
        page.get_by_label('Import strategy plan file').set_input_files({'name': 'strategy.yaml', 'mimeType': 'application/yaml', 'buffer': yaml.safe_dump(imported, sort_keys=False, width=100000).encode()})
        page.wait_for_function("document.querySelector('.strategy-message').textContent.includes('Imported strategy.yaml')")
        check('YAML file import opens a valid draft', 'Imported strategy.yaml' in page.locator('.strategy-message').inner_text())
        button('Apply draft').click()
        check('Imported plan is applied visibly', 'Draft plan' == page.get_by_label('Inspected strategy plan').locator('option:checked').inner_text())

        for label, filename in [('Pavilion','pavilion.ts'), ('CAD bracket','bracket.ts'), ('Four-bar linkage','linkage.ts'), ('Mechanical door','door.ts')]:
            button(label).click()
            ready()
            check(f'{label} executes through Strategy IR', 'Compiled ' + filename in status() and page.locator('.strategy-node').count() > 0 and source.input_value() == (root/'src/programs'/filename).read_text())
        check('Door still includes motion playback', button('Play assembly').count() == 1)
        page.get_by_label('Assembly motion sample').fill('10')
        check('Door motion frame updates', 'Frame 11/65' in page.locator('.source-preview .view-status').last.inner_text())
        button('Mesh cleanup lab').click()
        ready()
        check('Cleanup lab shows exact read-only implementation', source.input_value() == (root/'src/strategy-examples/cleanup.ts').read_text() and not source.is_editable())
        page.locator('.strategy-node[data-node-id="cleanup/step"]').click()
        tab('Executions').click()
        check('Cleanup exposes four real iterations', page.locator('.strategy-execution').count() == 4)
        page.locator('.strategy-execution').last.click()
        check('Final cleanup iteration is inspectable', 'iteration 4' in page.locator('.strategy-execution.selected').inner_text())
        cleanup_trace = trace()
        cleanup_plan = cleanup_trace['runs'][-1]['extensions']['strategy.execution']['plan']
        too_short = deepcopy(cleanup_plan)
        next(n for n in nodes(too_short) if n['kind'] == 'repeatUntilStable')['maxIterations'] = 1
        edit_plan(too_short)
        button('Compile this draft').click()
        ready()
        check('Iteration-budget failure is shown with trace', 'Strategy failed' in status() and page.locator('.strategy-node[data-status="failed"]').count() > 0)
        check('Failed strategy never displays stale geometry', page.locator('.mesh-canvas').count() == 0)
        history = page.get_by_label('Compilation history')
        previous = next(o['value'] for o in history.locator('option').evaluate_all('(nodes) => nodes.map(n => ({value:n.value,text:n.textContent}))') if 'succeeded' in o['text'])
        history.select_option(previous)
        check('Historical successful plan and model remain available', page.locator('.mesh-canvas').count() == 1)
        page.screenshot(path=root/'output/browser-v4-cleanup.png', full_page=True)
        button('Building').click()
        ready()
        source.fill('export default (')
        button('Compile source').click()
        ready()
        check('Invalid TypeScript reports syntax diagnostics', 'Source error:' in status() and 'TS' in status())
        check('Invalid source hides stale output', page.locator('.mesh-canvas').count() == 0)
        source.fill(original)
        button('Compile source').click()
        ready()
        check('Source compilation recovers', 'Compiled building.ts' in status())
        check('Downloaded source is the authored file', download('Download .ts') == original)
        check('Source-set export contains the five authored modules', len(json.loads(download('Save source set'))) == 5)
        page.set_viewport_size({'width': 390, 'height': 844})
        check('Mobile page has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'))
        page.screenshot(path=root/'output/browser-v4-mobile.png', full_page=True)
        check('No external network requests', not requests)
        check('No browser or console errors', not errors and not console_errors)
        browser.close()
except Exception as error:
    if results:
        output.write_text(json.dumps({'status': 'failed', 'passed': len(results), 'checks': results, 'error': str(error)}, indent=2) + '\n')
    raise
else:
    output.write_text(json.dumps({'status': 'passed', 'passed': len(results), 'checks': results}, indent=2) + '\n')
    print(f'{len(results)} real-browser v4 checks passed')
