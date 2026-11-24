"""Optional real-browser v5 contract acceptance suite.

Run locally after `npm run build:source`, with Playwright and Chromium installed.
This suite was not executed in the restricted authoring environment. Its Node
component counterparts verify behavior, but do not prove rendering or Workers.
Browser launch failures are recorded as blocked, never as a passing test.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os

root = Path(__file__).resolve().parent.parent
output = root / 'output/browser-v5-results.json'
checks = []

try:
    with sync_playwright() as pw:
        try:
            options = {'headless': True}
            if os.environ.get('CHROMIUM'):
                options['executable_path'] = os.environ['CHROMIUM']
            browser = pw.chromium.launch(**options)
        except Exception as error:
            output.write_text(json.dumps({'status': 'blocked', 'checks': [], 'reason': str(error)}, indent=2) + '\n')
            raise
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
        page.goto((root / 'output/source-workbench.html').as_uri(), wait_until='load')

        def ready():
            page.wait_for_function("!document.querySelector('.compile-button').disabled", timeout=120000)

        def button(label):
            return page.get_by_role('button', name=label, exact=True)

        def tab(label):
            return page.get_by_role('tab', name=label, exact=True)

        def check(label, condition):
            assert condition, label
            checks.append(label)
            print(label, flush=True)

        ready()
        check('v5 opens with actual authored source', 'v5' in page.title() and page.get_by_label('Editable TypeScript program').input_value() == (root/'src/programs/building.ts').read_text())
        button('Compiler passes').click()
        tab('Contracts').click()
        check('Actual final pass has accepted contract evidence', 'accepted' in page.locator('.contract-summary').inner_text())
        check('Contract inspector is below the IR chain', page.locator('.inspector').bounding_box()['y'] > page.locator('.ir-chain').bounding_box()['y'])
        page.get_by_label('Contract evidence section').select_option('interface')
        check('Named typed ports and YAML declarations are visible', 'Named inputs' in page.locator('.contract-content').inner_text() and page.locator('.contract-content .tok-key').count() > 0)
        page.get_by_label('Contract evidence section').select_option('analyses')
        check('Property facts have exact evidence', button('Explain property').count() > 0)
        button('Explain property').first.click()
        check('Property explanation includes checker evidence', 'checker' in page.locator('.contract-explanation').inner_text())
        page.get_by_label('Contract evidence section').select_option('implementation')
        check('Actual contract source can be inspected', page.get_by_label('Source file', exact=True).count() == 1 and page.locator('.code-text .tok-keyword').count() > 0)
        button('Compile source').click()
        ready()
        tab('Contracts').click()
        check('Cached pass still has current contract verification', 'compiler reused the pass output' in page.locator('.contract-summary').inner_text())
        button('Contract lab').click()
        ready()
        check('Seventh example exposes actual lab code', page.get_by_label('Editable TypeScript program').input_value() == (root/'src/contract-examples/lab.ts').read_text() and not page.get_by_label('Editable TypeScript program').is_editable())
        lab = page.get_by_label('Contract lab scenario')
        for scenario in ['invalid-divisor', 'bad-transform', 'false-preservation', 'effect-violation']:
            lab.select_option(scenario)
            ready()
            check(f'{scenario} fails without stale geometry', page.locator('.source-run-status.bad').count() == 1 and page.locator('.source-preview .mesh-canvas').count() == 0)
            tab('Contracts').click()
            check(f'{scenario} exposes its rejected contract', 'did not accept' in page.locator('.contract-summary').inner_text())
        lab.select_option('resource-bound')
        ready()
        page.get_by_label('Live volume limit').fill('1')
        button('Set limit & compile').click()
        ready()
        check('Changed resource rejects cached geometry', page.locator('.source-run-status.bad').count() == 1 and page.locator('.source-preview .mesh-canvas').count() == 0)
        page.get_by_label('Live volume limit').fill('10')
        button('Set limit & compile').click()
        ready()
        check('Restored resource accepts cached geometry', '0 executed' in page.locator('.source-result-meta').inner_text() and page.locator('.source-preview .mesh-canvas').count() == 1)
        lab.select_option('resource-derived')
        ready()
        button('Compile source').click()
        ready()
        check('Unchanged computational resource permits reuse', '0 executed' in page.locator('.source-result-meta').inner_text())
        page.get_by_label('Live volume limit').fill('20')
        button('Set limit & compile').click()
        ready()
        check('Changed body resource recomputes its mesh', '1 executed' in page.locator('.source-result-meta').inner_text())
        button('Compile source').click()
        ready()
        check('New resource-derived mesh is reusable', '0 executed' in page.locator('.source-result-meta').inner_text())
        lab.select_option('commit-effect')
        ready()
        check('Declared effect commits after acceptance', 'Live mock export count: 1' in page.locator('.contract-lab-controls').inner_text())
        lab.select_option('rollback-effect')
        ready()
        page.get_by_label('Contract evidence section').select_option('effects')
        check('Rejected output discards staged effects', 'Live mock export count: 1' in page.locator('.contract-lab-controls').inner_text() and 'staged, not committed' in page.locator('.contract-content').inner_text())
        lab.select_option('verified-cleanup')
        ready()
        check('Successful lab history remains inspectable', page.locator('.source-preview .mesh-canvas').count() == 1)
        tab('Contracts').click()
        page.get_by_label('Contract evidence section').select_option('effects')
        check('Cleanup correspondence is inspectable', 'mesh-entities' in page.locator('.contract-content').inner_text())
        button('Focus passes').click()
        check('Focus mode hides source and model', not page.locator('.source-workspace').is_visible())
        page.screenshot(path=root/'output/browser-v5-contracts.png')
        page.set_viewport_size({'width': 390, 'height': 844})
        check('Mobile has no horizontal page overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'))
        page.screenshot(path=root/'output/browser-v5-mobile.png', full_page=True)
        check('Offline execution makes no network requests', not requests)
        check('No JavaScript page errors', not errors)
        browser.close()
except Exception as error:
    if checks:
        output.write_text(json.dumps({'status': 'failed', 'checks': checks, 'error': str(error)}, indent=2) + '\n')
    raise
else:
    output.write_text(json.dumps({'status': 'passed', 'checks': checks}, indent=2) + '\n')
