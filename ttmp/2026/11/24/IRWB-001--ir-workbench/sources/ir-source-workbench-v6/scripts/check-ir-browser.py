"""Optional real-browser acceptance suite for the v6 standalone workbench.

Run locally after `npm run build:source`, with Playwright and Chromium installed.
This script has not been run in the restricted authoring environment. The Node
component suite uses real compilers with DOM/Worker doubles and does not establish
browser rendering. A blocked launch is recorded explicitly, never as success.
"""
from pathlib import Path
import json
import os

root = Path(__file__).resolve().parent.parent
output = root / 'output/browser-v6-results.json'
checks = []


def check(label, condition):
    assert condition, label
    checks.append(label)
    print(label, flush=True)


try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('CHROMIUM'):
            options['executable_path'] = os.environ['CHROMIUM']
        browser = pw.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
        page.goto((root / 'output/source-workbench.html').as_uri(), wait_until='load')
        lab = page.get_by_label('IR manipulation laboratory', exact=True)

        def ready():
            page.wait_for_function("document.querySelector('.ir-lab-actions .compile-strategy') && !document.querySelector('.ir-lab-actions .compile-strategy').disabled", timeout=120000)

        def button(label):
            return lab.get_by_role('button', name=label, exact=True)

        def tab(label):
            return lab.get_by_role('tab', name=label, exact=True)

        ready()
        check('v6 opens directly on the IR manipulation lab', 'v6' in page.title() and lab.is_visible())
        for name, path in [
            ('Symbolic expressions', 'expressions'), ('Scene sharing', 'scenes'),
            ('Mesh alternatives', 'meshes'), ('Constraint systems', 'constraints')
        ]:
            button(name).click()
            ready()
            check(f'{name} produces real edit steps', lab.locator('.ir-step').count() > 2)
            check(f'{name} has no compilation error', 'bad' not in lab.locator('.ir-lab-status').get_attribute('class'))
            button('Example & compiler code').click()
            check(f'{name} shows exact authored code', lab.get_by_label('Source file', exact=True).input_value() == f'src/ir-examples/{path}.ts')
            check(f'{name} source is highlighted', lab.locator('.tok-keyword').count() > 0)
            button('IR explorer').click()

        lab.locator('.ir-step').filter(has_text='Redundant equation removal').first.click()
        tab('Pattern & match').click()
        button('Find matches').click()
        check('constraint patterns can rerun their registered domain predicate', lab.locator('.ir-pattern-query-status').count() == 1 and lab.locator('.ir-pattern-query-result .ir-query-error').count() == 0)

        button('Scene sharing').click()
        ready()
        button('Entity lineage').click()
        check('entity lineage resolves exact revisions', lab.locator('.ir-lineage-status').count() == 1)
        button('Swap revisions').click()
        check('inverse lineage queries origins', lab.get_by_label('Lineage direction', exact=True).input_value() == 'inverse' and lab.locator('.ir-lineage-status').count() == 1)
        lab.get_by_label('Run twice to inspect cache reuse', exact=True).check()
        button('Run pipeline').click()
        ready()
        button('Compiler passes').click()
        check('warm compilation shows real reused passes', lab.locator('.compact-status.cached').count() > 0)
        tab('Contracts').click()
        check('reused passes retain semantic contract evidence', lab.locator('.contract-summary').count() > 0)

        button('Mesh alternatives').click()
        ready()
        button('IR explorer').click()
        check('alternative edits are not drawn as a fictitious linear chain', lab.locator('.ir-inspector > .ir-chain .chain-arrow').count() == 0)
        page.screenshot(path=str(root / 'output/v6-ir-desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        check('mobile page has no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        page.screenshot(path=str(root / 'output/v6-ir-mobile.png'), full_page=True)
        check('offline workbench makes no remote requests', not requests)
        check('workbench has no uncaught browser errors', not errors)
        output.write_text(json.dumps({'status': 'passed', 'checks': checks, 'browserErrors': errors, 'remoteRequests': requests}, indent=2) + '\n')
        browser.close()
except Exception as error:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'status': 'failed' if checks else 'blocked', 'checks': checks, 'reason': str(error)}, indent=2) + '\n')
    raise
