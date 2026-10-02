import asyncio
import base64
import ipaddress
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException
from playwright.async_api import async_playwright


class Browser:
    def __init__(self, workspace: Path, gate):
        self.workspace, self.gate = workspace, gate
        self.playwright = self.context = self.page = None
        self.lock = asyncio.Lock()

    async def start(self):
        if self.context:
            return
        self.playwright = await async_playwright().start()
        self.context = await self.playwright.chromium.launch_persistent_context(
            os.environ.get('BROWSER_PROFILE', '/home/dot/browser'), headless=True,
            viewport={'width': 1280, 'height': 900},
            proxy={'server': os.environ.get('BROWSER_PROXY', 'http://egress:3128')},
            args=['--disable-dev-shm-usage', '--disable-gpu'],
            accept_downloads=True,
        )
        self.context.set_default_timeout(15000)
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        self.context.on('page', self._new_page)

    async def _new_page(self, page):
        self.page = page

    def validate_url(self, url):
        parsed = urlsplit(url)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            raise HTTPException(400, '只允许不含凭据的公网HTTP(S)地址')
        hostname = parsed.hostname.lower().rstrip('.')
        if hostname in ('localhost', 'api', 'runtime', 'egress', 'sub2api') or hostname.endswith(('.localhost', '.local', '.internal')):
            raise HTTPException(403, '禁止访问内部网络')
        try:
            address = ipaddress.ip_address(hostname)
            if not address.is_global:
                raise HTTPException(403, '禁止访问内部网络')
        except ValueError:
            pass
        return url

    async def snapshot(self):
        result = await self.page.evaluate('''() => {
            const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"]')]
                .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').slice(0,180);
            return {text: (document.body?.innerText || '').slice(0,18000), elements: elements.map((e,i) => {
                e.setAttribute('data-dots-node', String(i));
                return {id:i,tag:e.tagName.toLowerCase(),type:e.type||null,label:(e.innerText||e.getAttribute('aria-label')||e.placeholder||e.name||'').slice(0,140),href:e.getAttribute('href')||null};
            })};
        }''')
        return {'url': self.page.url, 'title': await self.page.title(), **result}

    async def action(self, action, arguments, require_approval=False):
        if action not in {'navigate', 'snapshot', 'screenshot', 'click', 'click_position', 'fill', 'press', 'scroll', 'wait', 'back', 'download'}:
            raise HTTPException(400, '未知浏览器动作')
        if action == 'navigate':
            self.validate_url(arguments.get('url', ''))
        if require_approval and action in {'navigate', 'back', 'click', 'click_position', 'fill', 'press', 'download'}:
            public = {k: v for k, v in arguments.items() if k != 'value'}
            if not await self.gate(action, public):
                return {'declined': True, 'message': '用户拒绝或授权已过期，请勿绕过审批'}
        async with self.lock:
            await self.start()
            try:
                if action == 'navigate':
                    await self.page.goto(arguments['url'], wait_until='domcontentloaded', timeout=45000)
                elif action == 'click':
                    await self.page.locator(f'[data-dots-node="{int(arguments["id"])}"]').click()
                elif action == 'click_position':
                    await self.page.mouse.click(max(0, min(1279, int(arguments['x']))), max(0, min(899, int(arguments['y']))))
                elif action == 'fill':
                    await self.page.locator(f'[data-dots-node="{int(arguments["id"])}"]').fill(str(arguments['value'])[:10000])
                elif action == 'press':
                    await self.page.keyboard.press(str(arguments.get('key', 'Enter'))[:50])
                elif action == 'scroll':
                    await self.page.mouse.wheel(0, max(-1500, min(1500, int(arguments.get('y', 700)))))
                elif action == 'wait':
                    await asyncio.sleep(max(0, min(10, float(arguments.get('seconds', 2)))))
                elif action == 'back':
                    await self.page.go_back(wait_until='domcontentloaded')
                elif action == 'download':
                    async with self.page.expect_download(timeout=30000) as info:
                        await self.page.locator(f'[data-dots-node="{int(arguments["id"])}"]').click()
                    download = await info.value
                    folder = self.workspace / 'downloads'
                    folder.mkdir(exist_ok=True)
                    name = Path(download.suggested_filename).name
                    await download.save_as(str(folder / name))
                    return {'path': f'downloads/{name}', 'name': name}
                if action == 'screenshot':
                    image = await self.page.screenshot(type='png')
                    return {'image': base64.b64encode(image).decode(), 'url': self.page.url, 'width': 1280, 'height': 900}
                return await self.snapshot()
            except Exception as error:
                return {'error': str(error)[:500], 'url': self.page.url}

    async def close(self):
        if self.context:
            await self.context.close()
        if self.playwright:
            await self.playwright.stop()
