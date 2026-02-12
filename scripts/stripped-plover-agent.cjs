#!/usr/bin/env node
const net = require("net");
const readline = require("readline");
const { spawn } = require("child_process");
const path = require("path");

const PORT = Number(process.env.STRIPPED_PLOVER_PORT || "4020");
const DB_PATH = process.env.STRIPPED_PLOVER_DB || "/data/stripped-plover.sqlite";
const WORKDIR = process.env.STRIPPED_PLOVER_WORKDIR || "/opt/stripped-plover";
const STRIPPED_PLOVER_ENTRY = process.env.STRIPPED_PLOVER_ENTRY || "dist/index.js";
const SIGKILL_GRACE_PERIOD_MS = 2000;

function writeLine(stream, line, context) {
  if (!stream?.writable) {
    if (context) {
      console.warn(`${context} target not writable; dropping line`);
    }
    return;
  }
  try {
    // Use cork/uncork to batch within the call and immediately flush the newline write.
    stream.cork();
    stream.write(`${line}\n`);
  } catch (err) {
    console.error(`Forwarding error${context ? ` (${context})` : ""}:`, err);
  } finally {
    stream.uncork();
  }
}

function stopChild(child, socketToChild, setKillTimer) {
  socketToChild.close();
  if (child.stdin.writable) {
    try {
      child.stdin.end();
    } catch (err) {
      console.error("Error while closing Stripped Plover stdin:", err);
    }
  }
  try {
    child.kill("SIGINT");
  } catch (err) {
    console.error("SIGINT error while stopping Stripped Plover child:", err);
  }
  if (setKillTimer) {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (err) {
        console.error("SIGKILL error while stopping Stripped Plover child:", err);
      }
    }, SIGKILL_GRACE_PERIOD_MS);
    timer.unref();
    setKillTimer(timer);
  }
}

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.setNoDelay(true);

  const child = spawn("node", [STRIPPED_PLOVER_ENTRY, DB_PATH], {
    cwd: WORKDIR,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const socketToChild = readline.createInterface({ input: socket });
  const childToSocket = readline.createInterface({ input: child.stdout });
  let sigkillTimer;

  socketToChild.on("line", (line) => writeLine(child.stdin, line, "socket->child"));

  socket.on("close", () => {
    stopChild(child, socketToChild, (timer) => {
      sigkillTimer = timer;
    });
  });

  socket.on("error", (err) => {
    console.error("Stripped Plover socket error:", err);
    stopChild(child, socketToChild, (timer) => {
      sigkillTimer = timer;
    });
    childToSocket.close();
    socket.destroy();
  });

  childToSocket.on("line", (line) => writeLine(socket, line, "child->socket"));

  child.on("close", () => {
    if (sigkillTimer) {
      clearTimeout(sigkillTimer);
    }
    childToSocket.close();
    socket.end();
  });

  child.on("error", (err) => {
    console.error("Stripped Plover child error:", err);
    childToSocket.close();
    socketToChild.close();
    socket.destroy();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Stripped Plover agent listening on ${PORT}, forwarding to ${STRIPPED_PLOVER_ENTRY} with DB ${path.basename(DB_PATH)}`
  );
});
