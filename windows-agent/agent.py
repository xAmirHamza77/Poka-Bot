"""Authenticated Windows interactive desktop runtime for Poka.

Run as the signed-in account via Task Scheduler, never as a session-0 service.
OS-specific imports are lazy so contract tests can run on any platform.
"""
import asyncio
import base64
import ctypes
import getpass
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

CAPABILITIES = ['browser', 'terminal', 'files', 'screenshot', 'input']

class CreateRequest(BaseModel):
    computer_id: str = Field(min_length=1, max_length=128)
    bot_id: str = Field(min_length=1, max_length=128)
    width: int = Field(default=1280, ge=320, le=7680)
    height: int = Field(default=720, ge=240, le=4320)
    fps: int = Field(default=10, ge=1, le=30)

class NavigateRequest(BaseModel):
    url: str = Field(max_length=2048)

class TerminalRequest(BaseModel):
    command: str = Field(min_length=1, max_length=4000)

class FilesRequest(BaseModel):
    path: str = Field(default='/workspace', max_length=512)

class InputRequest(BaseModel):
    event: dict

def desktop_available():
    if sys.platform != 'win32':
        return False
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.OpenInputDesktop.restype = ctypes.c_void_p
    handle = user32.OpenInputDesktop(0, False, 0x0100)  # DESKTOP_SWITCHDESKTOP
    if not handle:
        return False
    try:
        user32.SwitchDesktop.argtypes = [ctypes.c_void_p]
        return bool(user32.SwitchDesktop(handle))
    finally:
        user32.CloseDesktop.argtypes = [ctypes.c_void_p]
        user32.CloseDesktop(handle)

class DesktopDriver:
    def ready(self):
        return desktop_available()

    def size(self):
        import pyautogui
        return tuple(pyautogui.size())

    def screenshot(self):
        import pyautogui
        frame = pyautogui.screenshot()
        output = io.BytesIO(); frame.convert('RGB').save(output, format='JPEG', quality=75)
        return frame.width, frame.height, base64.b64encode(output.getvalue()).decode()

    def input(self, event):
        import pyautogui as gui
        kind = event.get('type')
        width, height = gui.size()
        if kind in {'click', 'double_click', 'move', 'mouse_move', 'scroll', 'drag'}:
            x, y = event.get('x', width // 2), event.get('y', height // 2)
            if not isinstance(x, (int,float)) or not isinstance(y, (int,float)) or not (0 <= x < width and 0 <= y < height):
                raise HTTPException(400, 'Pointer coordinates must be inside the desktop.')
            gui.moveTo(int(x), int(y))
            if kind in {'click','double_click'}:
                button = event.get('button', 'left')
                if button not in {'left','right','middle'}:raise HTTPException(400, 'Invalid mouse button.')
                gui.click(clicks=2 if kind == 'double_click' else 1, interval=.1, button=button)
            elif kind == 'drag':
                to_x,to_y=event.get('to_x'),event.get('to_y')
                if not isinstance(to_x,(int,float)) or not isinstance(to_y,(int,float)) or not (0<=to_x<width and 0<=to_y<height):raise HTTPException(400,'Drag target must be inside the desktop.')
                gui.dragTo(int(to_x),int(to_y),duration=.3,button='left')
            elif kind == 'scroll':
                delta = event.get('delta_y', event.get('delta', 0))
                if not isinstance(delta,(int,float)) or abs(delta)>100:raise HTTPException(400, 'Scroll amount must be between -100 and 100.')
                gui.scroll(int(delta))
        elif kind in {'text','type'}:
            text = event.get('text', '')
            if not isinstance(text,str) or len(text)>4000:raise HTTPException(400,'Text must be at most 4000 characters.')
            # Unicode text through SendInput; does not overwrite the user's clipboard.
            self._unicode_text(text)
        elif kind in {'key','key_press','keypress','hotkey'}:
            keys = event.get('keys') or [event.get('key', '')]
            if isinstance(keys,str):keys=keys.split('+')
            if isinstance(keys,list) and len(keys)==1 and isinstance(keys[0],str) and '+' in keys[0]:keys=keys[0].split('+')
            aliases={'Control':'ctrl','CTRL':'ctrl','Alt':'alt','Shift':'shift','Enter':'enter','Escape':'esc','Backspace':'backspace','Tab':'tab','Meta':'win','ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left','ArrowRight':'right'}
            if not isinstance(keys,list) or len(keys)>8 or any(not isinstance(key,str) for key in keys):raise HTTPException(400,'Invalid keyboard input.')
            keys=[aliases.get(key,key.lower()) for key in keys]
            if not keys or any(key not in gui.KEYBOARD_KEYS for key in keys):raise HTTPException(400,'Unsupported key.')
            gui.hotkey(*keys) if len(keys)>1 else gui.press(keys[0])
        else:raise HTTPException(400,'Supported inputs: click, double_click, move, scroll, text, key, hotkey.')
        return {'accepted':True,'type':kind}

    @staticmethod
    def _unicode_text(text):
        from ctypes import wintypes
        class KEYBDINPUT(ctypes.Structure):
            _fields_=[('wVk',wintypes.WORD),('wScan',wintypes.WORD),('dwFlags',wintypes.DWORD),('time',wintypes.DWORD),('dwExtraInfo',ctypes.c_size_t)]
        class MOUSEINPUT(ctypes.Structure):
            _fields_=[('dx',wintypes.LONG),('dy',wintypes.LONG),('mouseData',wintypes.DWORD),('dwFlags',wintypes.DWORD),('time',wintypes.DWORD),('dwExtraInfo',ctypes.c_size_t)]
        class UNION(ctypes.Union):
            _fields_=[('ki',KEYBDINPUT),('mi',MOUSEINPUT)]
        class INPUT(ctypes.Structure):
            _fields_=[('type',wintypes.DWORD),('u',UNION)]
        send = ctypes.WinDLL('user32',use_last_error=True).SendInput
        send.argtypes=[wintypes.UINT,ctypes.POINTER(INPUT),ctypes.c_int]
        encoded=text.encode('utf-16-le')
        for index in range(0,len(encoded),2):
            unit=int.from_bytes(encoded[index:index+2],'little')
            events=(INPUT*2)(INPUT(type=1,u=UNION(ki=KEYBDINPUT(wScan=unit,dwFlags=4))), INPUT(type=1,u=UNION(ki=KEYBDINPUT(wScan=unit,dwFlags=6))))
            if send(2,events,ctypes.sizeof(INPUT))!=2:raise HTTPException(409,'Windows rejected keyboard input. Check the desktop session and app permissions.')

class WindowsRuntime:
    def __init__(self, root, driver=None):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.driver=driver or DesktopDriver();self.sessions={};self.contexts={};self.playwright=None;self.lock=asyncio.Lock()
        self.state_file=self.root/'sessions.json'
        if self.state_file.exists():
            for key,value in json.loads(self.state_file.read_text()).items():
                if re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',key):
                    value['state']='stopped';self.sessions[key]=value

    def persist(self):
        temp=self.state_file.with_suffix('.tmp');temp.write_text(json.dumps(self.sessions),encoding='utf-8');temp.replace(self.state_file)

    def session(self, key, active=False, gui=False):
        if key not in self.sessions:raise HTTPException(404,'Computer not found.')
        record=self.sessions[key]
        if active and record['state']!='running':raise HTTPException(409,'Start or resume the computer first.')
        if gui and not self.driver.ready():raise HTTPException(409,'Windows desktop is locked or unavailable. Sign in and unlock the agent account desktop.')
        return record

    def workspace(self,key):
        workspace=self.root/'workspaces'/hashlib.sha256(key.encode()).hexdigest()[:24]
        workspace.mkdir(parents=True,exist_ok=True);return workspace.resolve()

    def status(self,key):
        record=dict(self.session(key));record['desktop_available']=self.driver.ready();record['health']='healthy' if record['desktop_available'] else 'unhealthy'
        record['provider']='windows-agent';record['capabilities']=CAPABILITIES
        if record['desktop_available']:record['width'],record['height']=self.driver.size()
        return record

    async def close_browser(self,key):
        context=self.contexts.pop(key,None)
        if context:await context.close()

    async def navigate(self,key,url):
        self.session(key,active=True,gui=True)
        parsed=urlsplit(url)
        if parsed.scheme not in {'http','https'} or not parsed.hostname or parsed.username or parsed.password:raise HTTPException(400,'Enter an HTTP(S) URL without embedded credentials.')
        if self.playwright is None:
            from playwright.async_api import async_playwright
            self.playwright=await async_playwright().start()
        if key not in self.contexts:
            self.contexts[key]=await self.playwright.chromium.launch_persistent_context(str(self.workspace(key)/'browser'),headless=False,no_viewport=True,args=['--start-maximized'])
        context=self.contexts[key];page=context.pages[0] if context.pages else await context.new_page()
        await page.goto(url,wait_until='domcontentloaded',timeout=30000);await page.bring_to_front()
        self.sessions[key]['url']=page.url;self.persist();return {'url':page.url,'title':await page.title()}

    async def terminal(self,key,command):
        self.session(key,active=True)
        encoded=base64.b64encode(("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); " + command).encode('utf-16-le')).decode()
        process=await asyncio.create_subprocess_exec('powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded,cwd=self.workspace(key),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        async def read_limited(stream):
            result=bytearray()
            while chunk := await stream.read(8192):
                if len(result)<65536:result.extend(chunk[:65536-len(result)])
            return bytes(result)
        out_task=asyncio.create_task(read_limited(process.stdout));err_task=asyncio.create_task(read_limited(process.stderr))
        try:
            await asyncio.wait_for(process.wait(),30)
            stdout,stderr=await asyncio.gather(out_task,err_task)
        except asyncio.TimeoutError:
            killer=await asyncio.create_subprocess_exec('taskkill','/PID',str(process.pid),'/T','/F',stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
            await killer.wait();await process.wait();await asyncio.gather(out_task,err_task)
            raise HTTPException(408,'PowerShell command exceeded 30 seconds.')

        return {'exit_code':process.returncode,'stdout':stdout.decode('utf-8',errors='replace')[:65536],'stderr':stderr.decode('utf-8',errors='replace')[:65536],'cwd':str(self.workspace(key))}

    def files(self,key,raw):
        self.session(key,active=True);workspace=self.workspace(key)
        if raw=='/workspace':target=workspace
        elif raw.startswith('/workspace/'):target=workspace/raw[len('/workspace/'):]
        else:target=Path(raw)
        target=target.resolve()
        if not target.is_relative_to(workspace):raise HTTPException(400,'Choose a path inside this computer workspace.')
        if not target.is_dir():raise HTTPException(404,'Directory not found.')
        entries=[]
        for item in sorted(target.iterdir(),key=lambda p:p.name.lower())[:500]:
            if not item.resolve().is_relative_to(workspace):continue
            entries.append({'name':item.name,'path':str(item),'type':'directory' if item.is_dir() else 'file','size':item.stat().st_size if item.is_file() else None})
        return {'path':str(target),'entries':entries}

def create_app(root=None,token=None,driver=None):
    token=token or os.environ.get('POKA_AGENT_TOKEN','')
    if len(token)<32:raise RuntimeError('Set an agent access token of at least 32 characters.')
    os.environ.pop('POKA_AGENT_TOKEN', None)
    runtime=WindowsRuntime(root or os.environ.get('POKA_AGENT_ROOT',Path.home()/'PokaAgent'),driver)
    app=FastAPI(title='Poka Windows Agent',docs_url=None,redoc_url=None,openapi_url=None)
    app.state.runtime=runtime
    @app.middleware('http')
    async def authenticate(request:Request,call_next):
        supplied=request.headers.get('authorization','')
        if not hmac.compare_digest(supplied.encode(),('Bearer '+token).encode()):
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail':'Agent access token required.'},status_code=401)
        return await call_next(request)
    @app.exception_handler(ValidationError)
    async def invalid_input(request,exc):
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail':'Invalid computer action arguments.'},status_code=422)
    @app.exception_handler(Exception)
    async def internal_error(request,exc):
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail':'Windows operation failed. Check the agent session, installed browser, and account permissions.'},status_code=500)
    @app.get('/health')
    async def health():return {'service':'poka-windows-agent','platform':'windows','account':getpass.getuser(),'desktop_available':runtime.driver.ready(),'capabilities':CAPABILITIES,'shared_desktop':True}
    @app.post('/computers')
    async def create(payload:CreateRequest):
        key=payload.computer_id
        if not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',key):raise HTTPException(400,'Invalid computer ID.')
        async with runtime.lock:
            if key not in runtime.sessions:
                runtime.sessions[key]={**payload.model_dump(),'state':'stopped','generation':1}
                runtime.workspace(key);runtime.persist()
        return runtime.status(key)
    @app.get('/computers/{key}/health')
    async def status(key):return runtime.status(key)
    @app.post('/computers/{key}/{operation}')
    async def operation(key,operation,request:Request):
        async with runtime.lock:
            record=runtime.session(key)
            if operation in {'start','pause','stop','reset'}:
                if operation=='start':record['state']='running'
                elif operation=='pause':record['state']='paused'
                else:
                    await runtime.close_browser(key);record['state']='stopped'
                    if operation=='reset':record['generation']+=1;record.pop('url',None)
                runtime.persist();return runtime.status(key)
            if operation=='navigate':
                data=NavigateRequest.model_validate(await request.json());return await runtime.navigate(key,data.url)
            if operation=='terminal':
                data=TerminalRequest.model_validate(await request.json());return await runtime.terminal(key,data.command)
            if operation=='files':
                data=FilesRequest.model_validate(await request.json());return runtime.files(key,data.path)
            if operation=='screenshot':
                runtime.session(key,gui=True)
                if record['state'] not in {'running','paused'}:raise HTTPException(409,'Start the computer before requesting a screenshot.')
                w,h,data=await asyncio.to_thread(runtime.driver.screenshot)
                return {'available':True,'width':w,'height':h,'format':'jpeg','data':data,'frame_id':os.urandom(8).hex()}
            if operation=='input':
                data=InputRequest.model_validate(await request.json());runtime.session(key,active=True,gui=True)
                return await asyncio.to_thread(runtime.driver.input,data.event)
            raise HTTPException(404,'Operation not found.')
    @app.delete('/computers/{key}')
    async def cleanup(key):
        async with runtime.lock:
            runtime.session(key);await runtime.close_browser(key);del runtime.sessions[key];runtime.persist()
        return {'state':'cleaned','workspace_retained':True}
    return app
