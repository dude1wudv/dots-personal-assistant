import asyncio
import httpx


class Runtime:
    def __init__(self, url, token):
        self.client = httpx.AsyncClient(base_url=url, headers={'Authorization': f'Bearer {token}'}, timeout=90)

    async def request(self, method, params=None):
        response = await self.client.post('/rpc', json={'method': method, 'params': params or {}})
        response.raise_for_status()
        payload = response.json()
        if 'error' in payload:
            raise RuntimeError(payload['error'].get('message', 'Codex 请求失败'))
        return payload['result']

    async def resolve(self, approval_id, result):
        response = await self.client.post('/resolve', json={'approval_id': approval_id, 'result': result})
        response.raise_for_status()
        return response.json()

    async def browser(self, action, arguments):
        response = await self.client.post('/browser', json={'action': action, 'arguments': arguments})
        response.raise_for_status()
        return response.json()

    async def files(self, path=''):
        response = await self.client.get('/files', params={'path': path})
        response.raise_for_status()
        return response.json()

    async def consume(self, callback, stop):
        epoch, cursor = None, 0
        while not stop.is_set():
            try:
                response = await self.client.get('/events', params={'after': cursor, 'epoch': epoch or ''})
                response.raise_for_status()
                result = response.json()
                if epoch != result['epoch']:
                    epoch, cursor = result['epoch'], 0
                    await callback('runtime/restarted', {'epoch': epoch}, None, None)
                for event in result['events']:
                    await callback(event['method'], event['params'], event.get('approval_id'), f"{epoch}:{event['seq']}")
                    cursor = event['seq']
            except (httpx.HTTPError, OSError, ValueError):
                await asyncio.sleep(3)
            try:
                await asyncio.wait_for(stop.wait(), timeout=0.5)
            except TimeoutError:
                pass
