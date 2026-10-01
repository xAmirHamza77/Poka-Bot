import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import httpx
from pydantic import ValidationError
from app.services.remote_computer_provider import RemoteComputerProvider
from app.schemas.contracts import AppSettingsSchema
from app.services.storage_service import StorageService

spec=importlib.util.spec_from_file_location('windows_agent',Path(__file__).resolve().parents[2]/'windows-agent/agent.py')
agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
TOKEN='test-token-for-agent-authentication-123456789'

class Driver:
    available=True
    def ready(self):return self.available
    def size(self):return (1440,900)
    def screenshot(self):return 1440,900,'test-jpeg'
    def input(self,event):return {'accepted':True,'type':event['type']}

class WindowsAgentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.driver=Driver();self.app=agent.create_app(self.temp.name,TOKEN,self.driver)
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://agent',headers={'Authorization':'Bearer '+TOKEN})
    async def asyncTearDown(self):await self.client.aclose();self.temp.cleanup()
    async def create(self):
        result=await self.client.post('/computers',json={'computer_id':'computer-bot.1','bot_id':'bot.1'});self.assertEqual(result.status_code,200)
        return 'computer-bot.1'
    async def test_authentication_required_on_every_route(self):
        for method,url in [('GET','/health'),('POST','/computers'),('DELETE','/computers/id')]:
            result=await self.client.request(method,url,headers={'Authorization':'Bearer incorrect'});self.assertEqual(result.status_code,401)
            self.assertNotIn(TOKEN,result.text)
    async def test_lifecycle_input_frames_and_locked_session(self):
        key=await self.create()
        self.assertEqual((await self.client.post(f'/computers/{key}/screenshot')).status_code,409)
        await self.client.post(f'/computers/{key}/start')
        self.assertEqual((await self.client.post(f'/computers/{key}/screenshot')).json()['width'],1440)
        self.assertTrue((await self.client.post(f'/computers/{key}/input',json={'event':{'type':'click','x':10,'y':20}})).json()['accepted'])
        await self.client.post(f'/computers/{key}/pause')
        self.assertEqual((await self.client.post(f'/computers/{key}/input',json={'event':{'type':'key'}})).status_code,409)
        self.assertEqual((await self.client.post(f'/computers/{key}/screenshot')).status_code,200)
        await self.client.post(f'/computers/{key}/start');self.driver.available=False
        self.assertFalse((await self.client.get('/health')).json()['desktop_available'])
        self.assertEqual((await self.client.post(f'/computers/{key}/screenshot')).status_code,409)
        self.assertEqual((await self.client.post(f'/computers/{key}/input',json={'event':{'type':'type','text':'hello'}})).status_code,409)
        self.assertEqual((await self.client.post(f'/computers/{key}/reset')).json()['generation'],2)
    async def test_files_are_confined_and_survive_restart(self):
        key=await self.create();await self.client.post(f'/computers/{key}/start')
        workspace=self.app.state.runtime.workspace(key);(workspace/'hello.txt').write_text('hi')
        result=await self.client.post(f'/computers/{key}/files',json={'path':'/workspace'})
        self.assertEqual(result.json()['entries'][0]['name'],'hello.txt')
        self.assertEqual((await self.client.post(f'/computers/{key}/files',json={'path':'/workspace/../..'})).status_code,400)
        self.assertEqual((await self.client.post(f'/computers/{key}/files',json={'path':self.temp.name})).status_code,400)
        restarted=agent.WindowsRuntime(self.temp.name,self.driver);self.assertEqual(restarted.status(key)['state'],'stopped')
        self.assertTrue((restarted.workspace(key)/'hello.txt').exists())
    async def test_invalid_arguments_and_identifiers(self):
        self.assertEqual((await self.client.post('/computers',json={'computer_id':'../bad','bot_id':'bot'})).status_code,400)
        key=await self.create();await self.client.post(f'/computers/{key}/start')
        self.assertEqual((await self.client.post(f'/computers/{key}/navigate',json={})).status_code,422)
        self.assertEqual((await self.client.post(f'/computers/{key}/navigate',json={'url':'file:///etc/passwd'})).status_code,400)
    async def test_remote_provider_contract_and_restart_reconcile(self):
        client=self.client
        class ConnectedProvider(RemoteComputerProvider):
            async def _request(self,method,route,payload=None,**kwargs):
                response=await client.request(method,route,json=payload)
                response.raise_for_status();return response.json()
        provider=ConnectedProvider(platform='windows',base_url='https://agent',api_key=TOKEN)
        status=await provider.create('bot-test');await provider.start(status.computer_id)
        self.assertEqual((await provider.screenshot(status.computer_id))['data'],'test-jpeg')
        self.assertEqual((await provider.files_list(status.computer_id))['entries'],[])
        self.assertTrue((await provider.send_input(status.computer_id,{'type':'keypress','key':'Enter'}))['accepted'])
        restarted=ConnectedProvider(platform='windows',base_url='https://agent',api_key=TOKEN)
        recovered=await restarted.reconcile('bot-test');self.assertEqual(recovered.state,'running');self.assertEqual(recovered.provider,'windows-agent')
        await restarted.stop(recovered.computer_id);self.assertEqual((await restarted.screenshot(recovered.computer_id))['available'],False)

class WindowsSettingsTests(unittest.TestCase):
    def test_connection_validation_and_encrypted_token_roundtrip(self):
        for url in ['http://remote.example','https://u:pass@agent','https://agent/path','https://agent?token=secret','file:///c:/x']:
            with self.assertRaises(ValidationError):AppSettingsSchema(computer_remote_url=url)
        self.assertEqual(AppSettingsSchema(computer_remote_url='http://127.0.0.1:8765/').computer_remote_url,'http://127.0.0.1:8765')
        with tempfile.TemporaryDirectory() as directory:
            storage=StorageService(Path(directory));storage.save_settings({'computer_remote_url':'https://agent','computer_connection':'windows','computer_remote_token':TOKEN})
            storage.save_settings({'computer_remote_token':''})
            self.assertEqual(storage.get_settings()['computer_remote_token'],TOKEN)
            self.assertEqual(storage.get_public_settings()['computer_remote_token'],'')
            self.assertTrue(storage.get_public_settings()['computer_remote_token_configured'])
            self.assertNotIn(TOKEN,storage.database.path.read_bytes().decode(errors='replace'))

class WindowsDriverTests(unittest.TestCase):
    def test_pointer_validation_and_keyboard_aliases(self):
        from unittest.mock import MagicMock
        gui=MagicMock();gui.size.return_value=(1440,900);gui.KEYBOARD_KEYS=['ctrl','l','enter']
        with patch.dict('sys.modules',{'pyautogui':gui}):
            driver=agent.DesktopDriver()
            driver.input({'type':'keypress','key':'Control+l'});gui.hotkey.assert_called_once_with('ctrl','l')
            driver.input({'type':'click','x':20,'y':30});gui.click.assert_called_once()
            with self.assertRaises(agent.HTTPException):driver.input({'type':'click','x':99999,'y':1})
            with self.assertRaises(agent.HTTPException):driver.input({'type':'key','key':'unsupported'})
            with patch.object(driver,'_unicode_text') as unicode:
                driver.input({'type':'type','text':'Poka مرحبا'});unicode.assert_called_once_with('Poka مرحبا')

class WindowsTerminalTests(unittest.IsolatedAsyncioTestCase):
    async def test_powershell_encoding_cwd_and_output_limit(self):
        import asyncio,base64
        from unittest.mock import AsyncMock
        with tempfile.TemporaryDirectory() as root:
            runtime=agent.WindowsRuntime(root,Driver());runtime.sessions['computer-test']={'state':'running'}
            stdout=asyncio.StreamReader();stdout.feed_data(b'x'*100000);stdout.feed_eof()
            stderr=asyncio.StreamReader();stderr.feed_data(b'warning');stderr.feed_eof()
            process=type('Process',(),{'stdout':stdout,'stderr':stderr,'wait':AsyncMock(return_value=0),'returncode':0})()
            spawn=AsyncMock(return_value=process)
            with patch.object(agent.asyncio,'create_subprocess_exec',spawn):
                result=await runtime.terminal('computer-test','Get-Location')
            args=spawn.call_args.args
            self.assertEqual(args[0],'powershell.exe');self.assertIn('-EncodedCommand',args)
            self.assertIn('Get-Location',base64.b64decode(args[-1]).decode('utf-16-le'))
            self.assertEqual(len(result['stdout']),65536);self.assertEqual(result['stderr'],'warning')
            self.assertEqual(spawn.call_args.kwargs['cwd'],runtime.workspace('computer-test'))
