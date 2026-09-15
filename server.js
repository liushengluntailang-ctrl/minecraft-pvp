// Deno Deploy公式 ネイティブWebSocketサーバー
const clients = new Map(); // ws -> { id, roomId, name, x, y, z, yaw, pitch, hp }
const rooms = {}; // roomId -> { id, name, mode, blocks: {} }

function getRoomList() {
  return Object.values(rooms).map(r => {
    let count = 0;
    for (const [_, c] of clients) {
      if (c.roomId === r.id) count++;
    }
    return { id: r.id, name: r.name, mode: r.mode, playerCount: count };
  });
}

function broadcast(roomId, message, senderWs = null) {
  const data = JSON.stringify(message);
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && ws !== senderWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function broadcastAll(message) {
  const data = JSON.stringify(message);
  for (const [ws, _] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

Deno.serve((req) => {
  // WebSocketアップグレードリクエストの処理
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      const id = "p_" + Math.random().toString(36).substring(2, 9);
      clients.set(socket, { id, roomId: null, name: "Steve", x: 0, y: 10, z: 0, yaw: 0, pitch: 0, hp: 100 });
      // 接続時にIDと部屋一覧を送る
      socket.send(JSON.stringify({ type: "init", id, rooms: getRoomList() }));
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const me = clients.get(socket);
        if (!me) return;

        if (msg.type === "getRooms") {
          socket.send(JSON.stringify({ type: "roomList", rooms: getRoomList() }));
        }

        if (msg.type === "createRoom") {
          const roomId = "room_" + Math.random().toString(36).substring(2, 9);
          rooms[roomId] = {
            id: roomId,
            name: msg.name || "部屋 " + roomId.substring(5),
            mode: msg.mode || "custom",
            blocks: {}
          };
          socket.send(JSON.stringify({ type: "roomCreated", roomId }));
          broadcastAll({ type: "roomList", rooms: getRoomList() });
        }

        if (msg.type === "joinRoom") {
          const room = rooms[msg.roomId];
          if (!room) return;
          me.roomId = msg.roomId;
          me.name = msg.playerName || "Steve";

          // 部屋の他プレイヤー一覧
          const players = {};
          for (const [_, c] of clients) {
            if (c.roomId === me.roomId) {
              players[c.id] = { id: c.id, name: c.name, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch };
            }
          }

          socket.send(JSON.stringify({
            type: "roomJoined",
            roomInfo: { id: room.id, name: room.name, mode: room.mode },
            myPlayer: me,
            players: players,
            blocks: room.blocks
          }));

          broadcast(me.roomId, { type: "playerJoinedRoom", player: me }, socket);
          broadcastAll({ type: "roomList", rooms: getRoomList() });
        }

        if (msg.type === "move") {
          if (!me.roomId) return;
          Object.assign(me, msg.pos);
          broadcast(me.roomId, { type: "playerMoved", id: me.id, ...msg.pos }, socket);
        }

        if (msg.type === "placeBlock") {
          if (!me.roomId || !rooms[me.roomId]) return;
          const key = `${msg.block.x},${msg.block.y},${msg.block.z}`;
          rooms[me.roomId].blocks[key] = msg.block.color;
          broadcast(me.roomId, { type: "blockPlaced", block: msg.block });
        }

        if (msg.type === "breakBlock") {
          if (!me.roomId || !rooms[me.roomId]) return;
          const key = `${msg.pos.x},${msg.pos.y},${msg.pos.z}`;
          delete rooms[me.roomId].blocks[key];
          broadcast(me.roomId, { type: "blockBroken", pos: msg.pos });
        }

        if (msg.type === "action") {
          if (!me.roomId) return;
          broadcast(me.roomId, { type: "playerAction", fromId: me.id, ...msg.act });
        }

        if (msg.type === "leaveRoom") {
          const prevRoom = me.roomId;
          me.roomId = null;
          broadcast(prevRoom, { type: "playerLeftRoom", id: me.id });
          broadcastAll({ type: "roomList", rooms: getRoomList() });
        }
      } catch (err) {
        console.error(err);
      }
    };

    socket.onclose = () => {
      const me = clients.get(socket);
      if (me && me.roomId) {
        broadcast(me.roomId, { type: "playerLeftRoom", id: me.id });
      }
      clients.delete(socket);
      broadcastAll({ type: "roomList", rooms: getRoomList() });
    };

    return response;
  }

  // 通常のWebアクセス確認用
  return new Response("Minecraft PvP Server is running on Deno Deploy Native!", {
    headers: { "Access-Control-Allow-Origin": "*" }
  });
});
