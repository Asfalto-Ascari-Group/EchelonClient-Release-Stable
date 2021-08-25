const { BrowserWindow, app, ipcMain, autoUpdater, dialog, Notification } = require('electron');
require('update-electron-app')()
const { io } = require('socket.io-client');
const fs = require('fs');
const { getGamePath } = require('steam-game-path');
const unzipper= require('unzipper');
const http = require('http');
const pth = require('path');

require('dotenv').config();

// Define variable connection
const socket = io(`http://34.142.46.24:4644`, {
    reconnection: true,
    reconnectionDelayMax: 6000
});

// File server should be a different port but on the same ip address

// Global variables
var log = console.log.bind(console);
var isPathFound = false;
var gameInstallDir;
var isWindowOn = false;
let notisChoice = false;
const modulesArr = ['flSpec', 'gtSpec', 'cSpec'];
var isServerConnected = false;
var completedModulesArr = [];

// Configure window options
var win;
app.whenReady();

function createWindow() {
    win = new BrowserWindow({
        height: 870,
        width: 1080,
        title: `Project Echelon @${process.env.VERSION}`,
        icon: 'root\\src\\images\\icon.png',
        resizable: false,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false
        }
    });

    win.loadFile('root/index2.html');
};

// When app is ready, create window
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        };
    });
});

// If all windows in this context are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    };
});

// On window load
ipcMain.on('windowLoad', (event, arr) => {

    var data = getGamePath(244210);
    isWindowOn = true;
    notisChoice = arr.notis;

    // If game path is NOT found
    if (!data.game) {
        win.webContents.send('pathStatus', {code: 404, msg: 'Game installation path not found'});
        isPathFound = false;
    }
    // If game path is found
    else if (data.game.path) {
        gameInstallDir = data.game.path;
        win.webContents.send('pathStatus', {code: 200, msg: gameInstallDir});
        isPathFound = true;
    };

    // If server is connected
    if (isServerConnected) {
        win.webContents.send('notification', {title: 'Echelon Connected', content: `Echelon successfully connected to the server`, type: 'good', ms: 6000});
    }
    else if (!isServerConnected) {
        win.webContents.send('notification', {title: 'Echelon Lost Connection', content: `Awaiting server reconnection...`, type: 'bad', ms: 'none'});
    };
});

// User chooses their own game path
ipcMain.on('gamePathMount', () => {

    // Give user choice to browse for assettocorsa directory
    gameInstallDirUser = dialog.showOpenDialogSync(win, {
        title: 'Choose "assettocorsa" file path',
        properties: ['openDirectory']
    });

    // Check chosen game path
    if (gameInstallDirUser == undefined || gameInstallDirUser == 'undefined' || gameInstallDirUser == '') {
        // null -- undefined, dialog closed out
        win.webContents.send('pathStatus', {code: 406, msg: gameInstallDir});
        // Send notification to user
        win.webContents.send('notification', {title: 'Invalid Installation Path', content: `Please enter an installation path`, type: 'bad', ms: 10000});
    }
    else if (gameInstallDirUser[0].includes('assettocorsa') == false) {
        // false
        win.webContents.send('pathStatus', {code: 206, msg: gameInstallDir});
        // Send notification to user
        win.webContents.send('notification', {title: 'Invalid Installation Path', content: `Please enter an installation path that contains the 'assettocorsa' directory`, type: 'bad', ms: 10000});
    }
    else if (gameInstallDirUser[0].includes('assettocorsa')) {
        // true
        win.webContents.send('pathStatus', {code: 200, msg: gameInstallDirUser});
        gameInstallDir = gameInstallDirUser;
    };
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses
});

// Request files in json format from server
ipcMain.on('getCurrent', (event, array) => {
    for (const item of array.arr) {
        socket.emit('getCurrent', {type: item});
    };
});

ipcMain.on('notisChange', async (event, bool) => {
    // Request boolean value for notifications from appStorage
    notisChoice = bool;
});

// Catch response json files from server
socket.on('currentServerResponse', (arr) => {

    let json = arr.json;
    let id = arr.id;
    let counter = 0;

    completedModulesArr.push(id);

    for (let item of json) {

        var req = http.get(item.urlpath, async (res) => {

            // Direct the download stream to unzipper function
            res.pipe(
                unzipper.Extract({path: `${gameInstallDir}/content/${item.type}/`})
            );
        });

        req.on('close', () => {

            let path = `${gameInstallDir}/${item.filename}`;
            win.webContents.send('currentInstallPath', path);

            counter++;
            if (json.length == counter) {
                
                // Check for notification boolean value and act accordingly
                if (notisChoice == true) {
                    const noti = new Notification({
                        title: `${id} has Finished Syncing`,
                        body: 'Your Assetto Corsa content is synchronised',
                        silent: true,
                    }).show();
                };

                // Get and set the new client version
                var clientVersion = JSON.parse(fs.readFileSync(pth.join(__dirname, './content/temp/clientVersion.json')).toString());

                let serverVersion = arr.version[id].version;
                clientVersion[id].version = serverVersion;
                fs.writeFileSync(pth.join(__dirname, './content/temp/clientVersion.json'), JSON.stringify(clientVersion, null, 4));

                // Send install path to renderer
                win.webContents.send('currentInstallPathFinish', `${id} is done..`);
                log(completedModulesArr)
            };
        });
    };
});

// Check version against server module versions
socket.on('versionCheck', (serverArr) => {

    // Get client version
    var clientVersionFile = fs.readFileSync(pth.join(__dirname, './content/temp/clientVersion.json'));
    const clientVersion = JSON.parse(clientVersionFile.toString());
    var array = [];

    for (item of modulesArr) {
        if (serverArr[item].version != clientVersion[item].version) {

            let moduleName = serverArr[item];
            array.push(moduleName.type);

            // Re-Download ALL files in respective module via user choice
            win.webContents.send('notification', {title: 'Racing Series Out of Date', content: `Please sync the following: ${array.join()}`, type: 'bad', ms: 10000});
        };
    };
});

// Watch for server connection event
socket.on('connect', () => {
    log('Connected to Server');
    if (isWindowOn) {
        win.webContents.send('notification', {title: 'Echelon Connected', content: `Echelon successfully connected to the server`, type: 'good', ms: 6000});
    }
    else if (!isWindowOn) {
        isServerConnected = true;
    };
});

// Watch for server connect error
socket.on('connect_error', (err) => {
    log('Server not available, Retrying...');
    if (isWindowOn) {
        win.webContents.send('notification', {title: 'Echelon Lost Connection', content: `Awaiting server reconnection...`, type: 'bad', ms: 'none'});
    }
    else if (!isWindowOn) {
        isServerConnected = false;
    };

});