import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { TrainerDatabase } from "./database.mjs";

const [, , command, username] = process.argv;
const databasePath = process.env.V7_TRAINER_DB ?? "./data/trainer.sqlite3";
const database = new TrainerDatabase(databasePath);

async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = "";
    for await (const chunk of process.stdin) value += chunk;
    return value.replace(/\r?\n$/, "");
  }
  const terminal = createInterface({ input, output });
  const value = await terminal.question(
    "Mật khẩu mới (sẽ hiển thị khi nhập): ",
  );
  terminal.close();
  return value;
}

try {
  if (command === "create") {
    if (!username)
      throw new Error("Cách dùng: npm run user:add -- <tên-tài-khoản>");
    await database.createUser(username, await readPassword());
    console.log(`Đã tạo tài khoản ${username}.`);
  } else if (command === "disable") {
    if (!username)
      throw new Error("Cách dùng: npm run user:disable -- <tên-tài-khoản>");
    database.disableUser(username);
    console.log(`Đã vô hiệu hóa tài khoản ${username}.`);
  } else if (command === "list") {
    console.table(database.listUsers());
  } else {
    throw new Error("Lệnh hợp lệ: create, disable, list.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  database.close();
}
