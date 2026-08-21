const bcrypt = require("bcryptjs");

const password = process.argv[2];
if (!password) {
  console.log("Cara pakai: npm run hash-password -- \"password-kamu\"");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log("\nHash password kamu:\n");
console.log(hash);
console.log("\nSalin baris di atas ke variabel LOGIN_PASSWORD_HASH di docker-compose.yml\n");
