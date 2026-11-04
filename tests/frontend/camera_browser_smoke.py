"""Exercise the real scanner component with two synthetic browser video streams.

Run from the repo root with backend/venv/Scripts/python.exe while Vite is on 5173.
The generated sheet and captured photo are synthetic; output stays in ignored .local/.
"""
import base64
import io
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from tests.checkbox_fixtures import checkbox_sheet

OUTPUT = ROOT / '.local' / 'camera-audit'
OUTPUT.mkdir(parents=True, exist_ok=True)
fixture, _ = checkbox_sheet()
buffer = io.BytesIO()
fixture.save(buffer, 'JPEG', quality=95)
data_url = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')

mock_media = """
(() => {
  const image = new Image();
  image.src = __IMAGE__;
  const state = { requests: [], stops: [], photos: [], devices: [
    { kind: 'videoinput', deviceId: 'desk-a', label: 'Synthetic Desk Camera' },
    { kind: 'videoinput', deviceId: 'desk-b', label: 'Synthetic Side Camera' }
  ], errorName: '' };
  window.__cameraTest = state;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    enumerateDevices: async () => state.devices,
    addEventListener: () => {}, removeEventListener: () => {},
    getUserMedia: async (constraints) => {
      if (state.errorName) throw new DOMException('Synthetic failure', state.errorName);
      const id = constraints.video?.deviceId?.exact || 'desk-a';
      state.requests.push(id);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      const draw = () => {
        context.drawImage(image, 0, 0);
        context.fillStyle = id === 'desk-a' ? '#af3a3a' : '#2f63ad';
        context.fillRect(0, 0, 80, 40);
      };
      draw();
      const timer = setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      const track = stream.getVideoTracks()[0];
      Object.defineProperty(track, 'label', { value: id === 'desk-a' ? 'Synthetic Desk Camera' : 'Synthetic Side Camera' });
      Object.defineProperty(track, 'getSettings', { value: () => ({ deviceId: id }) });
      const originalStop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); state.stops.push(id); originalStop(); };
      return stream;
    }
  }});
  const query = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (descriptor) => descriptor.name === 'camera'
    ? Promise.resolve({ state: 'granted', onchange: null }) : query(descriptor);
})();
""".replace('__IMAGE__', json.dumps(data_url))

mount = """async () => {
  const React = await import('/node_modules/.vite/deps/react.js');
  const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
  const { CameraCapture } = await import('/src/features/documentExtraction/CameraCapture.tsx');
  document.querySelector('#root').style.display = 'none';
  const container = document.createElement('main');
  container.id = 'camera-smoke';
  document.body.appendChild(container);
  window.__mountCamera = () => {
    const root = (ReactDOM.createRoot || ReactDOM.default.createRoot)(container);
    window.__cameraRoot = root;
    root.render((React.createElement || React.default.createElement)(CameraCapture, {
      isExtracting: false,
      onUsePhoto: file => { window.__cameraFile = file; window.__cameraTest.photos.push({ type: file.type, size: file.size }); }
    }));
  };
  window.__mountCamera();
} """

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    )
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script(script=mock_media)
    page.goto('http://127.0.0.1:5173/login')
    page.wait_for_load_state('networkidle')
    page.evaluate(mount)
    page.get_by_text('2 cameras detected.').wait_for()
    selector = page.get_by_label('Camera to preview')
    assert selector.locator('option').count() == 3
    assert not page.get_by_role('button', name='Capture photo').count()

    page.get_by_role('button', name='Start camera preview').click()
    page.get_by_text('Active camera: Synthetic Desk Camera', exact=False).wait_for(timeout=15000)
    assert page.get_by_role('button', name='Capture photo').is_enabled()
    assert page.locator('video').evaluate('(video) => video.readyState >= 2 && video.videoWidth > 0')
    page.screenshot(path=str(OUTPUT / 'active-camera.png'))

    selector.select_option('desk-b')
    page.get_by_text('Active camera: Synthetic Side Camera', exact=False).wait_for(timeout=15000)
    assert page.evaluate("window.__cameraTest.stops.includes('desk-a')")
    assert page.evaluate("window.__cameraTest.requests.at(-1) === 'desk-b'")
    page.get_by_role('button', name='Capture photo').click()
    page.get_by_role('button', name='Use photo for OCR').wait_for()
    assert page.evaluate("window.__cameraTest.stops.includes('desk-b')")
    page.get_by_role('button', name='Use photo for OCR').click()
    page.wait_for_function('!!window.__cameraFile')
    assert page.evaluate("window.__cameraFile.type === 'image/jpeg' && window.__cameraFile.size > 10000")
    data = bytes(page.evaluate('async () => Array.from(new Uint8Array(await window.__cameraFile.arrayBuffer()))'))
    (OUTPUT / 'captured-synthetic.jpg').write_bytes(data)

    page.get_by_role('button', name='Retake photo').click()
    page.get_by_text('Active camera: Synthetic Side Camera', exact=False).wait_for(timeout=15000)
    page.evaluate('window.__cameraRoot.unmount()')
    assert page.evaluate("window.__cameraTest.stops.filter(id => id === 'desk-b').length >= 2")
    page.evaluate('window.__mountCamera()')
    page.get_by_role('button', name='Start camera preview').click()
    page.get_by_text('Active camera: Synthetic Desk Camera', exact=False).wait_for(timeout=15000)
    page.get_by_role('button', name='Stop camera').click()

    page.evaluate("window.__cameraTest.errorName = 'NotAllowedError'")
    page.get_by_role('button', name='Start camera preview').click()
    page.get_by_role('alert').get_by_text('Camera access is blocked', exact=False).wait_for()
    page.evaluate("window.__cameraTest.errorName = 'NotReadableError'")
    page.get_by_role('button', name='Start camera preview').click()
    page.get_by_role('alert').get_by_text('The camera is busy', exact=False).wait_for()
    page.evaluate("window.__cameraTest.errorName = ''; window.__cameraTest.devices = []")
    page.get_by_role('button', name='Refresh camera list').click()
    page.get_by_text('No cameras detected.', exact=False).wait_for()
    page.evaluate("window.__cameraTest.devices = [{kind:'videoinput',deviceId:'',label:''}]")
    page.get_by_role('button', name='Refresh camera list').click()
    page.get_by_text('Camera names appear after browser permission is granted.', exact=False).wait_for()
    unidentified = page.locator('option[value="unidentified-0"]')
    assert unidentified.count() == 1
    assert unidentified.get_attribute('disabled') is not None

    print(json.dumps({
        'switch_released_previous': True,
        'captured_jpeg_bytes': len(data),
        'reopen_and_close_released_stream': True,
        'permission_busy_no_device_messages': True,
        'unidentified_camera_listed': True,
        'requests': page.evaluate('window.__cameraTest.requests'),
    }))
    browser.close()
