const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HTTP_PORT = 3000;
const WS_PORT = 3001;

const httpServer = http.createServer((req, res) => {
    console.log(`HTTP: ${req.method} ${req.url}`);
    
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);
    
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.jpg':
            contentType = 'image/jpg';
            break;
    }
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ port: WS_PORT });

let waitingPlayers = [];
let activeGames = new Map();

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    
    return ips;
}

function createGame(player1, player2) {
    const gameId = Date.now().toString();
    player1.gameId = gameId;
    player2.gameId = gameId;
    activeGames.set(gameId, {
        id: gameId,
        players: [player1, player2],
        currentTurn: gameId % 2 == 0 ? player1.id : player2.id,
        turnHistory: []
    });
    
    console.log(`\n🎮 Новая игра создана! ID: ${gameId}`);
    console.log(`   Игрок ${player1.id.slice(-6)} vs Игрок ${player2.id.slice(-6)}`);
    console.log(`   Первый ход: Игрок ${player1.id.slice(-6)}\n`);
    
    player1.ws.send(JSON.stringify({
        type: 'start',
        opponentId: player2.id,
        yourTurn: true,
        message: 'Игра началась! Ваш ход!'
    }));
    
    player2.ws.send(JSON.stringify({
        type: 'start',
        opponentId: player1.id,
        yourTurn: false,
        message: 'Игра началась! Ход противника'
    }));
    
    return gameId;
}

const COL_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];

wss.on('connection', (ws, req) => {
    const playerId = Math.random().toString(36).substr(2, 8);
    const clientIp = req.socket.remoteAddress;
    
    const player = {
        id: playerId,
        ws: ws,
        ready: false,
        field: null,
        gameId: null,
        ip: clientIp,
        connectedAt: new Date()
    };
    
    console.log(`\n✅ Новый игрок подключился:`);
    console.log(`   ID: ${playerId}`);
    console.log(`   IP: ${clientIp}`);
    console.log(`   Время: ${player.connectedAt.toLocaleTimeString()}`);
    console.log(`   Ожидающих игроков: ${waitingPlayers.length}`);
    
    ws.send(JSON.stringify({ 
        type: 'init', 
        id: playerId,
        message: 'Добро пожаловать в Морской бой!'
    }));
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            console.log(`\n📨 Сообщение от ${playerId.slice(-6)}: ${msg.type}`);
            
            if (msg.type === 'ready') {
                player.ready = true;
                player.field = msg.field;
                console.log(`   Корабли размещены!`);
                
                waitingPlayers.push(player);
                console.log(`   Добавлен в очередь. Очередь: ${waitingPlayers.length}`);
                
                if (waitingPlayers.length >= 2) {
                    const player1 = waitingPlayers.shift();
                    const player2 = waitingPlayers.shift();
                    createGame(player1, player2);
                } else {
                    ws.send(JSON.stringify({ 
                        type: 'waiting',
                        message: 'Ожидание соперника...'
                    }));
                    console.log(`   Отправлено ожидание соперника`);
                }
            }
            
            if (msg.type === 'shot') {
                console.log(`   Получен выстрел от ${playerId.slice(-6)}: (${msg.x},${msg.y})`);
                
                const game = activeGames.get(player.gameId);
                
                if (!game) {
                    console.log(`   Ошибка: Игра не найдена для игрока ${playerId.slice(-6)}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Игра не найдена' }));
                    return;
                }
                
                if (game.currentTurn !== player.id) {
                    console.log(`   Ошибка: Сейчас не ваш ход. Текущий ход: ${game.currentTurn.slice(-6)}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Сейчас не ваш ход' }));
                    return;
                }
                
                const opponent = game.players.find(p => p.id !== player.id);
                
                if (!opponent) {
                    console.log(`   Ошибка: Соперник не найден`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Соперник не найден' }));
                    return;
                }
                
                if (msg.x < 0 || msg.x >= 10 || msg.y < 0 || msg.y >= 10) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Неверные координаты' }));
                    return;
                }
                
                const hit = opponent.field[msg.x][msg.y] === 1;
                console.log(`   Выстрел по (${msg.x},${msg.y}) - ${hit ? 'ПОПАДАНИЕ!' : 'ПРОМАХ'}`);
                
                game.turnHistory.push({
                    player: player.id,
                    x: msg.x,
                    y: msg.y,
                    hit: hit,
                    time: new Date().toLocaleTimeString()
                });
                
                if (hit) {
                    opponent.field[msg.x][msg.y] = 0;

                    // check if ship destroyed
                    let bShipDestroyed = false;
                    const rigth = (msg.x == 9) ? msg.x : msg.x+1;
                    const left = (msg.x == 0) ? msg.x : msg.x-1;
                    const top = (msg.y == 0) ? msg.y : msg.y-1;
                    const bottom = (msg.y == 9) ? msg.y : msg.y+1;

                    if (opponent.field[rigth][msg.y] === 0 
                        && opponent.field[msg.x][bottom] === 0 
                        && opponent.field[rigth][bottom] === 0
                        && opponent.field[left][msg.y] === 0 
                        && opponent.field[msg.x][top] === 0 
                        && opponent.field[left][top] === 0
                        && opponent.field[left][bottom] === 0 
                        && opponent.field[rigth][top] === 0) {
                            bShipDestroyed = true;
                    } 

                    player.ws.send(JSON.stringify({
                        type: 'shotResult',
                        hit: true,
                        x: msg.x,
                        y: msg.y,
                        nextTurn: true,
                        message: !bShipDestroyed ? 'Попадание! Стреляйте еще!' : 'Корабль противника потоплен!' 
                    }));                    
                    
                    opponent.ws.send(JSON.stringify({
                        type: 'shot',
                        x: msg.x,
                        y: msg.y,
                        hit: true,
                        message: `По вашему кораблю попали! (${COL_LETTERS[msg.y]}${msg.x + 1})`
                    }));
                    
                    let shipsRemaining = 0;
                    for (let i = 0; i < 10; i++) {
                        for (let j = 0; j < 10; j++) {
                            if (opponent.field[i][j] === 1) {
                                shipsRemaining++;
                            }
                        }
                    }
                    
                    if (shipsRemaining === 0) {
                        console.log(`\n🏆 ИГРА ОКОНЧЕНА! Победитель: ${player.id.slice(-6)}`);
                        console.log(`   Всего ходов: ${game.turnHistory.length}`);
                        
                        player.ws.send(JSON.stringify({ 
                            type: 'gameOver', 
                            result: 'win',
                            message: 'ПОБЕДА! Поздравляем!'
                        }));
                        
                        opponent.ws.send(JSON.stringify({ 
                            type: 'gameOver', 
                            result: 'lose',
                            message: 'Поражение... Попробуйте еще раз!'
                        }));
                        
                        activeGames.delete(game.id);
                    }
                } else {
                    opponent.field[msg.x][msg.y] = 3;
                    
                    player.ws.send(JSON.stringify({
                        type: 'shotResult',
                        hit: false,
                        x: msg.x,
                        y: msg.y,
                        nextTurn: false,
                        message: 'Промах! Ход переходит сопернику'
                    }));
                    
                    opponent.ws.send(JSON.stringify({
                        type: 'shot',
                        x: msg.x,
                        y: msg.y,
                        hit: false,
                        message: `Промах! Ваш ход! (${COL_LETTERS[msg.y]}${msg.x + 1})`
                    }));
                    
                    game.currentTurn = opponent.id;
                    console.log(`   Ход переходит игроку ${opponent.id.slice(-6)}`);
                }
            }
            
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
            
        } catch (err) {
            console.error('❌ Ошибка обработки сообщения:', err);
            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера' }));
        }
    });
    
    ws.on('close', () => {
        console.log(`\n❌ Игрок отключился:`);
        console.log(`   ID: ${player.id.slice(-6)}`);
        console.log(`   IP: ${player.ip}`);
        console.log(`   Был в игре: ${player.gameId ? 'да' : 'нет'}`);
        
        waitingPlayers = waitingPlayers.filter(p => p.id !== player.id);
        
        if (player.gameId) {
            const game = activeGames.get(player.gameId);
            if (game) {
                const opponent = game.players.find(p => p.id !== player.id);
                if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
                    opponent.ws.send(JSON.stringify({ 
                        type: 'opponentDisconnected',
                        message: 'Соперник отключился. Обновите страницу для новой игры'
                    }));
                }
                activeGames.delete(player.gameId);
                console.log(`   Игра ${player.gameId} удалена`);
            }
        }
        
        console.log(`   Ожидающих игроков: ${waitingPlayers.length}`);
        console.log(`   Активных игр: ${activeGames.size}`);
    });
    
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(pingInterval);
        }
    }, 30000);
    
    ws.on('pong', () => {});
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚢 МОРСКОЙ БОЙ - СЕРВЕР ЗАПУЩЕН');
    console.log('='.repeat(50));
    console.log(`\n📡 HTTP сервер: http://localhost:${HTTP_PORT}`);
    console.log(`🔌 WebSocket сервер: ws://localhost:${WS_PORT}`);
    console.log('\n📱 ДОСТУП С ДРУГИХ УСТРОЙСТВ:');
    
    const ips = getLocalIPs();
    ips.forEach(ip => {
        console.log(`   http://${ip}:${HTTP_PORT}`);
    });
    
    console.log('\n💡 ИНСТРУКЦИЯ:');
    console.log('   1. Откройте ссылку в браузере (на компьютере или телефоне)');
    console.log('   2. Расставьте корабли');
    console.log('   3. Когда два игрока будут готовы, игра начнется автоматически');
    console.log('\n⚡ СТАТУС:');
    console.log(`   Ожидающих игроков: ${waitingPlayers.length}`);
    console.log(`   Активных игр: ${activeGames.size}`);
    console.log('='.repeat(50) + '\n');
});

process.on('SIGINT', () => {
    console.log('\n\n🛑 Остановка сервера...');
    
    wss.clients.forEach(client => {
        client.close();
    });
    
    httpServer.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

setInterval(() => {
    if (waitingPlayers.length > 0 || activeGames.size > 0) {
        console.log('\n📊 СТАТИСТИКА:');
        console.log(`   Ожидающих игроков: ${waitingPlayers.length}`);
        console.log(`   Активных игр: ${activeGames.size}`);
        console.log(`   Всего подключений: ${wss.clients.size}`);
    }
}, 30000);
