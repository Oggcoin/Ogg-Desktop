const { app, BrowserWindow, ipcMain, shell, Menu, net, Tray, nativeImage, clipboard } = require('electron')
const path = require('path')

let mainWindow
let tray = null
let isQuitting = false

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../assets/icon.png')
    let icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) return   // no icon asset -> skip tray, app still runs
    icon = icon.resize({ width: 16, height: 16 })
    if (process.platform === 'darwin') icon.setTemplateImage(false)
    tray = new Tray(icon)
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Ogg Desktop', enabled: false },
      { type: 'separator' },
      { label: 'Show wallet', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
    ])
    tray.setToolTip('Ogg Desktop')
    tray.setContextMenu(contextMenu)
    tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } })
  } catch (e) {
    console.error('Tray unavailable:', e.message)
    tray = null
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    backgroundColor: '#f0f0f8',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  Menu.setApplicationMenu(null)

  // Minimize to taskbar (not tray)
  mainWindow.on('minimize', (e) => {
    // Just minimize normally to taskbar - default behaviour
  })

  // Close to tray (only if a tray exists; otherwise quit normally)
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow.hide()
      if (process.platform === 'win32' && tray.displayBalloon) {
        try {
          tray.displayBalloon({
            title: 'Ogg Desktop',
            content: 'Running in background. Right-click tray icon to exit.'
          })
        } catch (e) {}
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') mainWindow.webContents.openDevTools({ mode: 'detach' })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    createTray()
  })
}

app.on('window-all-closed', () => {
  // With a tray we stay alive in the background. Without one, don't linger
  // as a hidden process (except on macOS where staying resident is the norm).
  if (!tray && process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else if (mainWindow) mainWindow.show()
})

ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize())
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window-close', () => {
  if (!mainWindow) return
  if (tray) mainWindow.hide()   // hide to tray
  else mainWindow.close()       // no tray -> real close
})
ipcMain.handle('get-user-data-path', () => app.getPath('userData'))

ipcMain.handle('clipboard-write', (event, text) => {
  try { clipboard.writeText(String(text == null ? '' : text)); return true }
  catch (e) { return false }
})

ipcMain.handle('http-get', async (event, url) => {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url })
    request.setHeader('Accept', 'application/json')
    request.setHeader('User-Agent', 'OggDesktop')
    const timer = setTimeout(() => {
      try { request.abort() } catch (e) {}
      reject(new Error('Request timed out'))
    }, 9000)
    let data = ''
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk.toString() })
      response.on('end', () => { clearTimeout(timer); resolve({ status: response.statusCode, body: data }) })
      response.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    request.on('error', (err) => { clearTimeout(timer); reject(err) })
    request.end()
  })
})

ipcMain.handle('rpc-call', async (event, url, body) => {
  console.log('[RPC]', body.method)
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'POST', url })
    request.setHeader('Content-Type', 'application/json')
    request.setHeader('Accept', 'application/json')
    const timer = setTimeout(() => {
      try { request.abort() } catch (e) {}
      reject(new Error('RPC timed out'))
    }, 12000)
    let data = ''
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk.toString() })
      response.on('end', () => {
        clearTimeout(timer)
        try { resolve(JSON.parse(data)) }
        catch(e) { reject(new Error('Bad JSON: ' + data.slice(0,100))) }
      })
      response.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    request.on('error', (err) => { clearTimeout(timer); console.error('[RPC ERROR]', err.message); reject(err) })
    request.write(JSON.stringify(body))
    request.end()
  })
})
