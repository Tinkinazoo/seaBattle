let ws = null;
let myField = [];
let enemyField = [];
let gameStarted = false;
let myTurn = false;
let message = 'Подключение...';
let ships = [];
let currentShip = null;
let orientation = 'horizontal';
let tempShip = null;
let myPlayerId = null;
let reconnectAttempts = 0;
let pingInterval = null;
let debugMode = true;

const BOARD_SIZE = 10;
const COL_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];

// Функция для отладки
function debugLog(...args) {
    if (debugMode) {
        console.log('[DEBUG]', ...args);
    }
}

// Конфигурация кораблей
const shipConfigs = [
    { size: 4, count: 1, placed: 0, name: 'Линкор' },
    { size: 3, count: 2, placed: 0, name: 'Крейсер' },
    { size: 2, count: 3, placed: 0, name: 'Эсминец' },
    { size: 1, count: 4, placed: 0, name: 'Катер' }
];

function initFields() {
    myField = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
    enemyField = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
    ships = JSON.parse(JSON.stringify(shipConfigs));
    currentShip = ships[0];
    debugLog('Поля инициализированы');
}

function getShipCells(x, y, size, orientation) {
    const cells = [];
    for (let i = 0; i < size; i++) {
        if (orientation === 'horizontal') {
            cells.push({ x, y: y + i });
        } else {
            cells.push({ x: x + i, y });
        }
    }
    return cells;
}

function canPlaceShip(x, y, size, orientation) {
    const cells = getShipCells(x, y, size, orientation);
    
    for (const cell of cells) {
        if (cell.x < 0 || cell.x >= BOARD_SIZE || cell.y < 0 || cell.y >= BOARD_SIZE) {
            return false;
        }
    }
    
    for (const cell of cells) {
        if (myField[cell.x][cell.y] === 1) {
            return false;
        }
    }
    
    return true;
}

function renderBoard(field, isEnemy, title = '') {
    let html = `<div class="board" data-is-enemy="${isEnemy}">`;
    if (title) {
        html += `<div style="text-align: center; margin-bottom: 10px; font-weight: bold;">${title}</div>`;
    }
    
    html += '<div class="board-header">';
    html += '<div class="corner-cell"></div>';
    for (let j = 0; j < BOARD_SIZE; j++) {
        html += `<div class="col-label">${COL_LETTERS[j]}</div>`;
    }
    html += '</div>';
    
    for (let i = 0; i < BOARD_SIZE; i++) {
        html += '<div class="board-row">';
        html += `<div class="row-label">${i + 1}</div>`;
        
        for (let j = 0; j < BOARD_SIZE; j++) {
            let className = 'cell';
            let content = '';
            let cellValue = field[i][j];
            
            if (cellValue === 1) {
                className += ' ship';
                content = '⬛';
            } else if (cellValue === 2) {
                className += ' hit';
                content = '💥';
            } else if (cellValue === 3) {
                className += ' miss';
                content = '⚫';
            } else {
                content = '⬜';
            }
            
            let isInTempShip = false;
            if (tempShip && !isEnemy) {
                const cells = getShipCells(tempShip.x, tempShip.y, tempShip.size, tempShip.orientation);
                isInTempShip = cells.some(cell => cell.x === i && cell.y === j);
            }
            
            if (isInTempShip) {
                className += ' selected';
            }
            
            const onclickAttr = `onclick="window.handleCellClick(${i}, ${j}, ${isEnemy})"`;
            html += `<div class="${className}" ${onclickAttr} data-x="${i}" data-y="${j}" data-is-enemy="${isEnemy}">${content}</div>`;
        }
        html += '</div>';
    }
    
    html += '</div>';
    return html;
}

function render() {
    const app = document.getElementById('app');
    if (!app) return;
    
    const allShipsPlaced = ships.every(s => s.placed === s.count);
    const statusDiv = document.getElementById('status');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        statusDiv.innerHTML = '🟢 Соединено';
        statusDiv.style.background = 'rgba(0,255,0,0.3)';
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
        statusDiv.innerHTML = '🟡 Подключение...';
        statusDiv.style.background = 'rgba(255,255,0,0.3)';
    } else {
        statusDiv.innerHTML = '🔴 Нет соединения';
        statusDiv.style.background = 'rgba(255,0,0,0.3)';
    }
    
    let controlsHtml = '';
    if (!allShipsPlaced && !gameStarted) {
        controlsHtml = `
            <div class="controls">
                <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-bottom: 10px;">
                    ${ships.map(ship => `
                        <button 
                            onclick="window.selectShip(${ship.size})"
                            ${ship.placed === ship.count ? 'disabled' : ''}
                            style="background: ${currentShip && currentShip.size === ship.size ? '#00adb5' : '#4a6fa5'}"
                        >
                            ${ship.name} (${ship.placed}/${ship.count})
                        </button>
                    `).join('')}
                </div>
                <div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 10px;">
                    <button onclick="window.setOrientation('horizontal')" style="background: ${orientation === 'horizontal' ? '#00adb5' : '#4a6fa5'}">
                        ➡️ Горизонтально
                    </button>
                    <button onclick="window.setOrientation('vertical')" style="background: ${orientation === 'vertical' ? '#00adb5' : '#4a6fa5'}">
                        ⬇️ Вертикально
                    </button>
                </div>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button onclick="window.placeShip()" ${!tempShip ? 'disabled' : ''}>✅ Подтвердить</button>
                    <button onclick="window.resetGame()" style="background: #e94560">🔄 Сбросить</button>
                </div>
            </div>
        `;
    }
    
    let waitingHtml = '';
    if (allShipsPlaced && !gameStarted && ws && ws.readyState === WebSocket.OPEN) {
        waitingHtml = '<div class="info" style="background: #00adb5;">⏳ Ожидание соперника...</div>';
    }
    
    let gameHtml = '';
    if (gameStarted) {
        const turnText = myTurn ? 'ВАШ ХОД! 🔫' : 'ХОД ПРОТИВНИКА ⏳';
        gameHtml = `
            <div style="margin-top: 20px;">
                <h3>🎯 Поле противника - ${turnText}</h3>
                <div class="board-container">
                    ${renderBoard(enemyField, true, 'Поле противника')}
                </div>
            </div>
        `;
    }
    
    app.innerHTML = `
        <div class="info" style="background: ${gameStarted ? (myTurn ? '#4caf50' : '#ff9800') : '#4a6fa5'}">
            ${message}
        </div>
        ${waitingHtml}
        ${controlsHtml}
        <h3>🚢 Ваше поле</h3>
        <div class="board-container">
            ${renderBoard(myField, false, 'Ваше поле')}
        </div>
        ${gameHtml}
    `;
    
    debugLog('Render completed. gameStarted:', gameStarted, 'myTurn:', myTurn);
}

window.handleCellClick = function(x, y, isEnemy) {
    debugLog(`=== КЛИК ПО КЛЕТКЕ ===`);
    debugLog(`Координаты: x=${x}, y=${y}`);
    debugLog(`isEnemy: ${isEnemy}`);
    debugLog(`gameStarted: ${gameStarted}`);
    debugLog(`myTurn: ${myTurn}`);
    debugLog(`ws state: ${ws ? ws.readyState : 'no ws'}`);
    
    if (isEnemy) {
        if (!gameStarted) {
            message = '❌ Игра еще не началась!';
            render();
            debugLog('Игра не началась');
            return;
        }
        
        if (!myTurn) {
            message = '❌ Сейчас не ваш ход!';
            render();
            debugLog('Не ваш ход');
            return;
        }
        
        const cellValue = enemyField[x][y];
        debugLog(`Значение клетки: ${cellValue}`);
        
        if (cellValue === 2 || cellValue === 3) {
            message = '❌ Сюда уже стреляли!';
            render();
            debugLog('Уже стреляли');
            return;
        }
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            debugLog(`Отправляем выстрел на сервер: (${x},${y})`);
            const shotMessage = JSON.stringify({ type: 'shot', x, y });
            debugLog('Сообщение:', shotMessage);
            ws.send(shotMessage);
            
            myTurn = false;
            message = '🎯 Выстрел отправлен... ожидание результата';
            render();
        } else {
            debugLog('WebSocket не открыт!');
            message = '❌ Ошибка: нет соединения с сервером!';
            render();
        }
    } else {
        debugLog('Клик по своему полю');
        if (!gameStarted && currentShip && currentShip.placed < currentShip.count) {
            if (canPlaceShip(x, y, currentShip.size, orientation)) {
                tempShip = { x, y, size: currentShip.size, orientation: orientation };
                message = `✅ Корабль будет размещен. Нажмите "Подтвердить"`;
                debugLog('Корабль выбран для размещения');
            } else {
                message = '❌ Нельзя ставить здесь!';
                debugLog('Нельзя поставить корабль');
            }
            render();
        }
    }
};

function selectShip(size) {
    currentShip = ships.find(s => s.size === size);
    if (currentShip && currentShip.placed < currentShip.count) {
        tempShip = null;
        message = `Выбран ${currentShip.name}. Нажмите на клетку для размещения`;
        render();
    }
}

function setOrientation(newOrientation) {
    orientation = newOrientation;
    message = `Ориентация: ${orientation === 'horizontal' ? 'горизонтально' : 'вертикально'}`;
    render();
}

function placeShip() {
    if (!tempShip || !currentShip) return;
    
    debugLog('Размещение корабля:', tempShip);
    const cells = getShipCells(tempShip.x, tempShip.y, tempShip.size, tempShip.orientation);
    
    for (const cell of cells) {
        myField[cell.x][cell.y] = 1;
    }
    
    currentShip.placed++;
    debugLog(`Корабль размещен. Осталось разместить: ${ships.filter(s => s.placed < s.count).length}`);
    
    const nextShip = ships.find(s => s.placed < s.count);
    if (nextShip) {
        currentShip = nextShip;
        message = `Разместите ${nextShip.name} (${nextShip.placed + 1}/${nextShip.count})`;
        tempShip = null;
    } else {
        message = 'Все корабли размещены! Ищем соперника...';
        if (ws && ws.readyState === WebSocket.OPEN) {
            debugLog('Отправляем готовность на сервер');
            ws.send(JSON.stringify({ type: 'ready', field: myField }));
        } else {
            debugLog('WebSocket не открыт!');
            message = 'Ошибка: нет соединения с сервером!';
        }
        tempShip = null;
    }
    
    render();
}

function resetGame() {
    if (ws) ws.close();
    setTimeout(() => location.reload(), 100);
}

function handleServerMessage(data) {
    debugLog('=== ПОЛУЧЕНО СООБЩЕНИЕ ОТ СЕРВЕРА ===');
    debugLog('Тип:', data.type);
    debugLog('Данные:', data);
    
    switch (data.type) {
        case 'init':
            myPlayerId = data.id;
            message = data.message || '✅ Подключено! Расставляйте корабли';
            render();
            break;
            
        case 'waiting':
            message = data.message || '⏳ Ожидание соперника...';
            render();
            break;
            
        case 'start':
            debugLog('!!! ИГРА НАЧАЛАСЬ !!!');
            gameStarted = true;
            myTurn = data.yourTurn;
            message = data.yourTurn ? '🎯 Ваш ход! Стреляйте по полю противника!' : '⏳ Ход противника. Ждите...';
            debugLog(`gameStarted=${gameStarted}, myTurn=${myTurn}`);
            render();
            break;
            
        case 'shot':
            debugLog(`Получен выстрел от соперника: hit=${data.hit}, x=${data.x}, y=${data.y}`);
            debugLog(`До изменения myField[${data.x}][${data.y}] = ${myField[data.x][data.y]}`);
            
            if (data.hit) {
                myField[data.x][data.y] = 2;
                message = data.message || `💥 Попадание в ${COL_LETTERS[data.y]}${data.x + 1}!`;
                debugLog(`Попадание! Обновлено поле: myField[${data.x}][${data.y}] = ${myField[data.x][data.y]}`);
                myTurn = false;
            } else {
                myField[data.x][data.y] = 3;
                message = data.message || `⚫ Промах по ${COL_LETTERS[data.y]}${data.x + 1}!`;
                debugLog(`Промах! Обновлено поле: myField[${data.x}][${data.y}] = ${myField[data.x][data.y]}`);
                myTurn = true;
            }
            render();
            break;
            
        case 'shotResult':
            debugLog(`Результат вашего выстрела: hit=${data.hit}, nextTurn=${data.nextTurn}`);
            debugLog(`До изменения enemyField[${data.x}][${data.y}] = ${enemyField[data.x][data.y]}`);
            
            if (data.hit) {
                enemyField[data.x][data.y] = 2;
                debugLog(`Попадание! Обновлено поле противника: enemyField[${data.x}][${data.y}] = ${enemyField[data.x][data.y]}`);
                myTurn = true;
                message = data.message || '💥 Попадание! Стреляйте еще!';
            } else {
                enemyField[data.x][data.y] = 3;
                debugLog(`Промах! Обновлено поле противника: enemyField[${data.x}][${data.y}] = ${enemyField[data.x][data.y]}`);
                myTurn = false;
                message = data.message || '⚫ Промах! Ход противника';
            }
            
            debugLog(`После обработки: myTurn=${myTurn}`);
            debugLog(`enemyField[${data.x}][${data.y}] теперь = ${enemyField[data.x][data.y]}`);
            render();
            break;
            
        case 'gameOver':
            debugLog('!!! ИГРА ОКОНЧЕНА !!!');
            gameStarted = false;
            message = data.message || (data.result === 'win' ? '🏆 ПОБЕДА! 🎉' : '💔 ПОРАЖЕНИЕ!');
            render();
            setTimeout(() => {
                if (confirm('Игра окончена! Начать новую?')) {
                    resetGame();
                }
            }, 1000);
            break;
            
        case 'opponentDisconnected':
            message = data.message || '❌ Противник отключился. Обновите страницу';
            gameStarted = false;
            render();
            break;
            
        case 'error':
            message = `❌ ${data.message}`;
            render();
            break;
            
        case 'pong':
            debugLog('Получен pong от сервера');
            break;
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const wsUrl = `${protocol}//${host}:3001`;
    
    debugLog('Подключение к WebSocket:', wsUrl);
    message = `Подключение к серверу...`;
    render();
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        debugLog('✅ WebSocket подключен успешно!');
        message = '✅ Подключено! Расставляйте корабли';
        reconnectAttempts = 0;
        render();
        
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
                debugLog('Отправлен ping');
            }
        }, 20000);
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        } catch (e) {
            debugLog('Ошибка парсинга сообщения:', e, event.data);
        }
    };
    
    ws.onerror = (error) => {
        debugLog('WebSocket ошибка:', error);
        message = '❌ Ошибка подключения к серверу';
        render();
    };
    
    ws.onclose = () => {
        debugLog('WebSocket соединение закрыто');
        if (pingInterval) clearInterval(pingInterval);
        
        if (!gameStarted && reconnectAttempts < 3) {
            reconnectAttempts++;
            message = `Соединение потеряно. Переподключение ${reconnectAttempts}/3...`;
            render();
            setTimeout(() => connectWebSocket(), 2000);
        } else if (!gameStarted) {
            message = '❌ Соединение потеряно. Обновите страницу';
            render();
        }
    };
}

window.selectShip = selectShip;
window.setOrientation = setOrientation;
window.placeShip = placeShip;
window.resetGame = resetGame;
window.handleCellClick = handleCellClick;

window.cellClick = function(x, y, isEnemy) {
    handleCellClick(x, y, isEnemy);
};

debugLog('Запуск клиента...');
initFields();
connectWebSocket();