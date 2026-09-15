import express from "npm:express@4";
import { createServer } from "node:http";
import { Server } from "npm:socket.io@4";

const app = express();
const server = createServer(app);

// CORS全許可（Chromebookからの通信を完全許可）
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

// ルーム管理
const rooms = {};

app.get("/", (req, res) => {
  res.send("Minecraft PvP Server is running on Deno Deploy!");
});

function getRoomList() {
  return Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    playerCount: Object.keys(r.players).length
  }));
}

io.on("connection", (socket) => {
  let currentRoomId = null;

  // 部屋一覧取得
  socket.on("getRooms", () => {
    socket.emit("roomList", getRoomList());
  });

  // 部屋作成
  socket.on("createRoom", ({ name, mode }) => {
    const roomId = "room_" + Math.random().toString(36).substring(2, 9);
    rooms[roomId] = {
      id: roomId,
      name: name || "部屋 " + roomId.substring(5),
      mode: mode || "custom",
      players: {},
      blocks: {}
    };
    io.emit("roomList", getRoomList());
    socket.emit("roomCreated", roomId);
  });

  // 部屋参加
  socket.on("joinRoom", ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) return;

    currentRoomId = roomId;
    socket.join(roomId);

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || "Steve",
      x: 0, y: 10, z: 0,
      yaw: 0, pitch: 0,
      hp: 100
    };

    socket.emit("roomJoined", {
      roomInfo: { id: room.id, name: room.name, mode: room.mode },
      myPlayer: room.players[socket.id],
      players: room.players,
      blocks: room.blocks
    });

    socket.to(roomId).emit("playerJoinedRoom", room.players[socket.id]);
    io.emit("roomList", getRoomList());
  });

  // 位置の同期
  socket.on("move", (pos) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.players[socket.id]) {
      Object.assign(room.players[socket.id], pos);
      socket.to(currentRoomId).emit("playerMoved", { id: socket.id, ...pos });
    }
  });

  // ブロック設置
  socket.on("placeBlock", (block) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const key = `${block.x},${block.y},${block.z}`;
    rooms[currentRoomId].blocks[key] = block.color;
    io.to(currentRoomId).emit("blockPlaced", block);
  });

  // ブロック破壊
  socket.on("breakBlock", (pos) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    delete rooms[currentRoomId].blocks[key];
    io.to(currentRoomId).emit("blockBroken", pos);
  });

  // 攻撃などのアクション
  socket.on("action", (act) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("playerAction", { fromId: socket.id, ...act });
  });

  // 退出処理
  function leave() {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    delete room.players[socket.id];
    socket.leave(currentRoomId);
    socket.to(currentRoomId).emit("playerLeftRoom", socket.id);
    if (Object.keys(room.players).length === 0) {
      delete rooms[currentRoomId];
    }
    currentRoomId = null;
    io.emit("roomList", getRoomList());
  }

  socket.on("leaveRoom", leave);
  socket.on("disconnect", leave);
});

// ポート起動（Deno Deploy環境対応）
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
